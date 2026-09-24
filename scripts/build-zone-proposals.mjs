#!/usr/bin/env node
// Zone-proposal builder — runs after the Ukraine live-wire collector (same
// workflow). Clusters recent PLACED wire events by oblast and emits
// `zone-proposals/latest.json` for two consumers: the site's zone-popup
// warning line (advisory only — Stefan promotes curated zones by hand) and
// the territory collector's UNKNOWN class (proposals with enough combat /
// strike signal auto-surface as labelled-unverified contested circles).
//
// Usage: node scripts/build-zone-proposals.mjs [--events=path] [--output=path]
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearestZone } from './lib/ukraineOblasts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WINDOW_DAYS = 7;
const MIN_EVENTS = 3; // below this, noise — not worth a review prompt.
const MAX_SAMPLES = 3;

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

export function placedWithinWindow(events, sinceMs) {
  return (Array.isArray(events) ? events : []).filter((e) => {
    if (!e || typeof e !== 'object') return false;
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) return false;
    if (e.coordsTier === 'unplaced') return false;
    const t = Date.parse(e.isoDate || e.date || '');
    return Number.isFinite(t) && t >= sinceMs;
  });
}

// GDELT ActionGeo geoType 1 = country-level: the row sits on the country
// centroid (49,32 for Ukraine) no matter where the fighting was. Grouping
// those rows would paint whatever zone owns the centroid as "active", so
// they are dropped from clustering (counted, never silently vanished).
// geoType rides on event.gdelt.geoType in fresh snapshots; older snapshots
// only carry it inside coordsNote ("... geocode (type N); ...").
export function isCountryLevelGdelt(event) {
  if (event?.source !== 'GDELT 2.1') return false;
  const direct = Number(event?.gdelt?.geoType);
  if (Number.isFinite(direct)) return direct === 1;
  const noted = String(event?.coordsNote || '').match(/geocode \(type (\d+)\)/);
  return noted ? Number(noted[1]) === 1 : false;
}

// Theatre bbox (generous margins: cross-border incursions count, Moscow
// datelines do not). Headline geocoding pins "Moscow says …" stories on
// Moscow; clustering those into Sumy would fake a northern front.
export const THEATRE_BBOX = { minLat: 43.5, maxLat: 53.0, minLng: 20.5, maxLng: 41.5 };

export function insideTheatre(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= THEATRE_BBOX.minLat && lat <= THEATRE_BBOX.maxLat
    && lng >= THEATRE_BBOX.minLng && lng <= THEATRE_BBOX.maxLng;
}

const COMBAT_TYPES = new Set(['combat', 'strike', 'attack', 'shelling', 'battle', 'clash']);
const MIN_RADIUS_KM = 15; // below this the circle pretends to a precision the wire lacks.
const MAX_RADIUS_KM = 80; // above this the circle stops meaning "this fight".

const KM_PER_DEG = 111.32;

function spreadKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * KM_PER_DEG;
  const dLng = (lng2 - lng1) * KM_PER_DEG * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLng);
}

export function buildProposals(events, { collectedAt = new Date().toISOString() } = {}) {
  const sinceMs = Date.parse(collectedAt) - WINDOW_DAYS * 86400000;
  const groups = new Map();
  let coarseGdeltDropped = 0;
  let outsideTheatreDropped = 0;
  for (const event of placedWithinWindow(events, sinceMs)) {
    if (isCountryLevelGdelt(event)) { coarseGdeltDropped += 1; continue; }
    if (!insideTheatre(event.lat, event.lng)) { outsideTheatreDropped += 1; continue; }
    const zone = nearestZone(event.lat, event.lng);
    if (!zone) continue;
    if (!groups.has(zone.zoneId)) {
      groups.set(zone.zoneId, {
        zoneId: zone.zoneId,
        region: zone.region,
        center: { lat: zone.lat, lng: zone.lng },
        eventCount: 0,
        kinds: {},
        tierCounts: {},
        combatCount: 0,
        newestIsoDate: null,
        samples: [],
        members: [],
      });
    }
    const group = groups.get(zone.zoneId);
    group.eventCount += 1;
    const kind = String(event.type || event.kind || 'other').toLowerCase();
    group.kinds[kind] = (group.kinds[kind] || 0) + 1;
    if (COMBAT_TYPES.has(kind)) group.combatCount += 1;
    const tier = String(event.coordsTier || 'approximate');
    group.tierCounts[tier] = (group.tierCounts[tier] || 0) + 1;
    const stamp = event.isoDate || event.date || null;
    if (stamp && (!group.newestIsoDate || Date.parse(stamp) > Date.parse(group.newestIsoDate))) {
      group.newestIsoDate = stamp;
    }
    group.members.push([event.lat, event.lng]);
    if (group.samples.length < MAX_SAMPLES && event.sourceUrl) {
      group.samples.push({ id: String(event.id), isoDate: event.isoDate || event.date || null, sourceUrl: event.sourceUrl });
    }
  }
  const proposals = [...groups.values()]
    .filter((g) => g.eventCount >= MIN_EVENTS)
    .map((g) => {
      // Event centroid + mean spread: the circle follows the reporting, not
      // the oblast pin. `center` stays the zone pin for the site popup.
      let sumLat = 0;
      let sumLng = 0;
      for (const [la, ln] of g.members) { sumLat += la; sumLng += ln; }
      const centroid = {
        lat: Math.round((sumLat / g.members.length) * 10000) / 10000,
        lng: Math.round((sumLng / g.members.length) * 10000) / 10000,
      };
      let spread = 0;
      for (const [la, ln] of g.members) spread += spreadKm(centroid.lat, centroid.lng, la, ln);
      const radiusKm = Math.round(Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, spread / g.members.length)) * 10) / 10;
      const { members, ...rest } = g;
      return { ...rest, centroid, radiusKm };
    })
    .sort((a, b) => b.eventCount - a.eventCount);
  return {
    schemaVersion: 1,
    theatreId: 'ukraine',
    collectedAt,
    windowDays: WINDOW_DAYS,
    minEvents: MIN_EVENTS,
    source: 'ukraine-events live wire (placed records only)',
    coarseGdeltDropped,
    outsideTheatreDropped,
    proposals,
  };
}

async function atomicJsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function main() {
  const eventsPath = resolve(option('events', resolve(ROOT, 'ukraine-events/latest.json')));
  const outputPath = resolve(option('output', resolve(ROOT, 'zone-proposals/latest.json')));
  const collectedAt = new Date().toISOString();
  let envelope;
  try {
    envelope = JSON.parse(await readFile(eventsPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      await atomicJsonWrite(outputPath, {
        schemaVersion: 1, theatreId: 'ukraine', collectedAt, windowDays: WINDOW_DAYS,
        minEvents: MIN_EVENTS, source: 'ukraine-events live wire (placed records only)',
        proposals: [], note: 'no live-wire snapshot yet',
      });
      console.log('zone-proposals: no live-wire snapshot; wrote empty proposals');
      return;
    }
    throw error;
  }
  const proposals = buildProposals(envelope.events || [], { collectedAt });
  await atomicJsonWrite(outputPath, proposals);
  console.log(`zone-proposals: ${proposals.proposals.length} zones from wire`);
}

try {
  await main();
} catch (error) {
  console.error(`build-zone-proposals: ${error.message}`);
  process.exitCode = 1;
}
