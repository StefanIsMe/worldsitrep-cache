// Ukraine territory normalizer — pure functions, no I/O.
// Three-class merge, all automated (no hand-drawn lines):
//  (1) OCCUPIED (assessed): public-mirror per-day occupied-territory
//      MultiPolygons, fetched by scripts/collect-territory.mjs. Direct
//      DeepStateMap.live fetching was removed (API access denied Sep 2026 —
//      see the cache README source policy); a full history-snapshot envelope
//      `{ id, datetime, map: { features[] } }` can still be replayed
//      MANUALLY via --input.
//  (2) FRIENDLY (derived): the open Ukraine ADM0 boundary (geoBoundaries /
//      OpenStreetMap, ODbL) rendered as an underlay — territory inside the
//      boundary that is not in the occupied set reads as Ukrainian-held.
//  (3) UNKNOWN (derived): recent combat-reporting clusters from the live
//      wire's zone proposals, rendered as labelled-unverified circles.
// Output: the slim World SITREP territory snapshot consumed by the site.
// Only geoJSON.status.* POLYGONS become territory polygons. Unit markers,
// attack directions, airfields and other points are counted, never stored.
import { createHash } from 'node:crypto';

export const TERRITORY_SCHEMA_VERSION = 1;
export const DEEPSTATE_SOURCE_URL = 'https://deepstatemap.live/en';
export const DEEPSTATE_LICENSE_URL = 'https://deepstatemap.live/license-en.html';

// Site-facing condition strings — must match the curated territory.json
// vocabulary consumed by FocusedLayers (`condition.includes(...)`).
export const CONDITION_OCCUPIED = 'Occupied (Russian)';
export const CONDITION_FRIENDLY = 'Liberated / Friendly (Ukrainian)';
export const CONDITION_UNKNOWN = 'Contested / Unknown';

const STATUS_KEY_RE = /geoJSON\.status\.(occupied|dismissed|unknown)/;

function fail(message) {
  throw new Error(`territory snapshot invalid: ${message}`);
}

/** Split "UK /// EN /// geoJSON.key" names (tolerates newlines/NBSP). */
export function parseDeepstateName(raw) {
  const text = String(raw ?? '').replace(/\u00a0/g, ' ');
  const parts = text.split('///').map((s) => s.trim()).filter(Boolean);
  const keyMatch = text.match(/geoJSON\.[A-Za-z0-9_.{}: -]+/);
  const key = keyMatch ? keyMatch[0].replace(/\s+/g, '') : '';
  if (parts.length >= 3) return { nameUk: parts[0], nameEn: parts[1], key };
  if (parts.length === 2) {
    return key && parts[1].includes(key)
      ? { nameUk: parts[0], nameEn: '', key }
      : { nameUk: parts[0], nameEn: parts[1].replace(key, '').trim(), key };
  }
  return { nameUk: parts[0] || '', nameEn: '', key };
}

/** Map a geoJSON.status.* key to a site condition, or null when not territory. */
export function conditionForKey(key) {
  if (!key) return null;
  if (key.includes('geoJSON.status.occupied')) return CONDITION_OCCUPIED;
  if (key.includes('geoJSON.status.dismissed')) return CONDITION_FRIENDLY;
  if (key.includes('geoJSON.status.unknown')) return CONDITION_UNKNOWN;
  return null;
}

/**
 * Parse DeepState's snapshot stamp ("23.09 o 09:38", day.month, no year).
 * Year is inferred from `now`: months ahead of now belong to last year.
 * Returns `{ date: 'YYYY-MM-DD', raw }`.
 */
export function parseSnapshotDatetime(raw, now = new Date()) {
  const text = String(raw ?? '').trim();
  const match = text.match(/(\d{1,2})\.(\d{1,2})\s*o\s*(\d{1,2}):(\d{2})/);
  if (!match) return { date: null, raw: text };
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = now.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  if (candidate > now.getTime() + 24 * 3600 * 1000) year -= 1;
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${year}-${pad(month)}-${pad(day)}`, raw: text };
}

const round5 = (n) => Math.round(n * 100000) / 100000;

function validLngLat(pair) {
  return Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
    && Math.abs(pair[1]) <= 90 && Math.abs(pair[0]) <= 180;
}

/** Equirectangular ring area in km² (rough, honest — labelled approximate). */
export function ringAreaKm2(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  const R = 6371;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lat1, lng1] = ring[i];
    const [lat2, lng2] = ring[i + 1];
    sum += (lng2 - lng1) * (Math.PI / 180) * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((sum * R * R) / 2);
}

/** Stable polygon id from class key + centroid (index-free across snapshots). */
export function stablePolygonId(key, centroidLat, centroidLng) {
  const digest = createHash('sha1')
    .update(`${key}|${centroidLat.toFixed(2)},${centroidLng.toFixed(2)}`)
    .digest('hex')
    .slice(0, 10);
  return `ds-${digest}`;
}

function flipRing(ring) {
  const out = [];
  for (const pair of ring) {
    if (!validLngLat(pair)) return null;
    out.push([round5(pair[1]), round5(pair[0])]);
  }
  if (out.length < 4) return null;
  return out;
}

function centroidOf(ring) {
  let lat = 0;
  let lng = 0;
  for (const [la, ln] of ring) { lat += la; lng += ln; }
  return [lat / ring.length, lng / ring.length];
}

/**
 * Normalize a `/api/history/last` payload into a site territory snapshot.
 * Throws on envelope/shape violations (fail closed); skips bad rings.
 */
export function normalizeSnapshot(payload, { collectedAt = new Date().toISOString() } = {}) {
  if (!payload || typeof payload !== 'object') fail('envelope is not an object');
  if (!Number.isFinite(payload.id)) fail('missing numeric snapshot id');
  const features = payload.map?.features;
  if (!Array.isArray(features) || features.length === 0) fail('map.features is empty');
  const { date: snapshotDate, raw: snapshotDatetime } = parseSnapshotDatetime(payload.datetime);

  const detailedPolygons = [];
  const extraFeatures = [];
  const census = {
    features: features.length, statusPolygons: 0, territoryExtras: 0,
    units: 0, attackDirections: 0, airfields: 0, otherPoints: 0, unclassified: 0,
    skippedRings: 0,
  };

  for (const feature of features) {
    const props = feature?.properties || {};
    const { nameUk, nameEn, key } = parseDeepstateName(props.name);
    const geometry = feature?.geometry || {};
    const condition = conditionForKey(key);

    if (condition && geometry.type === 'Polygon') {
      const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
      const outer = rings.length ? flipRing(rings[0]) : null;
      if (!outer) { census.skippedRings += 1; continue; }
      const [centLat, centLng] = centroidOf(outer);
      detailedPolygons.push({
        id: stablePolygonId(key, centLat, centLng),
        style: typeof props.styleUrl === 'string' ? props.styleUrl : '',
        nameUk,
        nameEn,
        condition,
        areaKm2: Math.round(ringAreaKm2(outer) * 10) / 10,
        areaApproximate: true,
        poly: outer,
      });
      census.statusPolygons += 1;
      continue;
    }
    if (condition && geometry.type === 'MultiPolygon') {
      const polys = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
      let part = 0;
      for (const poly of polys) {
        const outer = Array.isArray(poly) && poly.length ? flipRing(poly[0]) : null;
        if (!outer) { census.skippedRings += 1; continue; }
        const [centLat, centLng] = centroidOf(outer);
        detailedPolygons.push({
          id: `${stablePolygonId(key, centLat, centLng)}-p${part}`,
          style: typeof props.styleUrl === 'string' ? props.styleUrl : '',
          nameUk,
          nameEn,
          condition,
          areaKm2: Math.round(ringAreaKm2(outer) * 10) / 10,
          areaApproximate: true,
          poly: outer,
        });
        part += 1;
        census.statusPolygons += 1;
      }
      continue;
    }
    // Theatre-wide extras (Kaliningrad, Karelia, Caucasus…): polygon claims
    // outside the core theatre, kept in the site's `geom` shape.
    if (key.includes('geoJSON.territories.') && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
      const coords = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      const rounded = [];
      let bad = false;
      for (const poly of coords || []) {
        const polyOut = [];
        for (const ring of poly || []) {
          const ringOut = [];
          for (const pair of ring || []) {
            if (!validLngLat(pair)) { bad = true; break; }
            ringOut.push([round5(pair[0]), round5(pair[1])]);
          }
          if (bad || ringOut.length < 4) { bad = true; break; }
          polyOut.push(ringOut);
        }
        if (bad) break;
        rounded.push(polyOut);
      }
      if (bad || !rounded.length) { census.skippedRings += 1; continue; }
      extraFeatures.push({
        style: typeof props.styleUrl === 'string' ? props.styleUrl : '',
        name: String(props.name || '').replace(/\s+/g, ' ').trim(),
        geom: geometry.type === 'Polygon'
          ? { type: 'Polygon', coordinates: rounded[0] }
          : { type: 'MultiPolygon', coordinates: rounded },
      });
      census.territoryExtras += 1;
      continue;
    }
    // Census-only classes: counted, never stored.
    if (key.startsWith('geoJSON.units.') || (!key && geometry.type === 'Point')) census.units += 1;
    else if (key.includes('geoJSON.status.attack_direction')) census.attackDirections += 1;
    else if (/geoJSON\.air(field|port|base)/.test(key)) census.airfields += 1;
    else if (geometry.type === 'Point') census.otherPoints += 1;
    else census.unclassified += 1;
  }

  if (!detailedPolygons.length) fail('no status polygons survived normalization');
  return {
    schemaVersion: TERRITORY_SCHEMA_VERSION,
    theatreId: 'ukraine',
    source: 'DeepStateMap.live',
    sourceUrl: DEEPSTATE_SOURCE_URL,
    upstreamUrl: DEEPSTATE_SOURCE_URL,
    licenseUrl: DEEPSTATE_LICENSE_URL,
    snapshotId: payload.id,
    snapshotDatetime,
    snapshotDate,
    collectedAt,
    featuresCount: detailedPolygons.length,
    census,
    detailedPolygons,
    extraFeatures,
  };
}

export const MIRROR_SOURCE = 'cyterat/deepstate-map-data (DeepStateMap.live mirror)';
export const MIRROR_URL = 'https://github.com/cyterat/deepstate-map-data';

/**
 * Build a backfill day snapshot from one mirror MultiPolygon (occupied
 * territory only). Ids reuse the live stable-id scheme so identical geometry
 * keeps identical ids across the backfill/live boundary.
 */
export function mirrorDaySnapshot(dateStr, coordinates, { sourceUrl = MIRROR_URL, collectedAt = new Date().toISOString(), backfill = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) || !Number.isFinite(Date.parse(dateStr))) {
    fail(`bad mirror day date ${JSON.stringify(dateStr)}`);
  }
  const detailedPolygons = [];
  const polys = Array.isArray(coordinates) ? coordinates : [];
  let part = 0;
  for (const poly of polys) {
    const outer = Array.isArray(poly) && poly.length ? flipRing(poly[0]) : null;
    if (!outer) continue;
    const [centLat, centLng] = centroidOf(outer);
    detailedPolygons.push({
      id: `${stablePolygonId('geoJSON.status.occupied', centLat, centLng)}-p${part}`,
      style: '',
      nameUk: 'Окупована територія',
      nameEn: 'Occupied territory',
      condition: CONDITION_OCCUPIED,
      areaKm2: Math.round(ringAreaKm2(outer) * 10) / 10,
      areaApproximate: true,
      src: SRC_MIRROR,
      ...(backfill ? { backfill: true } : {}),
      poly: outer,
    });
    part += 1;
  }
  if (!detailedPolygons.length) fail(`no polygons survived for mirror day ${dateStr}`);
  return {
    schemaVersion: TERRITORY_SCHEMA_VERSION,
    theatreId: 'ukraine',
    source: MIRROR_SOURCE,
    sourceUrl,
    upstreamUrl: DEEPSTATE_SOURCE_URL,
    licenseUrl: DEEPSTATE_LICENSE_URL,
    snapshotId: Number(dateStr.replaceAll('-', '')),
    snapshotDate: dateStr,
    snapshotDatetime: dateStr,
    collectedAt,
    featuresCount: detailedPolygons.length,
    census: { mirrorPolys: detailedPolygons.length, ...(backfill ? { backfill: true } : {}) },
    partial: true,
    note: 'Occupied polygons only — derived classes attach in the collector',
    detailedPolygons,
    extraFeatures: [],
  };
}

export const BOUNDARY_SOURCE = 'geoBoundaries (OpenStreetMap contributors)';
export const BOUNDARY_LICENSE_URL = 'https://www.openstreetmap.org/copyright';
export const BOUNDARY_ODBL_URL = 'https://opendatacommons.org/licenses/odbl/';
export const NEWS_DERIVED_SOURCE = 'World SITREP live wire (combat-reporting clusters)';
export const SRC_MIRROR = 'mirror';
export const SRC_BOUNDARY = 'boundary-derived';
export const SRC_NEWS = 'news-derived';

const round4 = (n) => Math.round(n * 10000) / 10000;

function flipRing4(ring) {
  const out = [];
  for (const pair of ring) {
    if (!validLngLat(pair)) return null;
    out.push([round4(pair[1]), round4(pair[0])]);
  }
  if (out.length < 4) return null;
  return out;
}

/**
 * Build the friendly underlay polygon from an open Ukraine ADM0 boundary
 * FeatureCollection (geoBoundaries simplified). Outer ring only, 4dp
 * (~11 m — plenty for a country fill). Returns null when unusable so the
 * collector can degrade with a note instead of failing the run.
 */
export function boundaryFriendlyPolygon(featureCollection, { pinnedAt = null } = {}) {
  const features = featureCollection?.features;
  if (!Array.isArray(features)) return null;
  for (const feature of features) {
    const geometry = feature?.geometry || {};
    const polys = geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
    if (!Array.isArray(polys)) continue;
    for (const poly of polys) {
      const outer = Array.isArray(poly) && poly.length ? flipRing4(poly[0]) : null;
      if (!outer) continue;
      return {
        id: 'ds-boundary-ukraine',
        style: '',
        nameUk: 'Україна (похідна межа)',
        nameEn: 'Ukraine — Ukrainian-held (boundary-derived)',
        condition: CONDITION_FRIENDLY,
        areaKm2: Math.round(ringAreaKm2(outer) * 10) / 10,
        areaApproximate: true,
        src: SRC_BOUNDARY,
        asOf: typeof pinnedAt === 'string' ? pinnedAt.slice(0, 10) : null,
        vertices: outer.length,
        poly: outer,
      };
    }
  }
  return null;
}

const KM_PER_DEG_LAT = 111.32;

/** Closed circle ring ([lat,lng], 5dp) or null on bad input. */
export function circlePoly(lat, lng, radiusKm, segments = 16) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return null;
  const segs = Math.max(8, Math.min(64, Math.floor(segments) || 16));
  const ring = [];
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < segs; i++) {
    const theta = (2 * Math.PI * i) / segs;
    ring.push([
      round5(lat + (Math.sin(theta) * radiusKm) / KM_PER_DEG_LAT),
      round5(lng + (Math.cos(theta) * radiusKm) / (KM_PER_DEG_LAT * cosLat)),
    ]);
  }
  ring.push([...ring[0]]);
  return ring;
}

export const UNKNOWN_MIN_COMBAT = 2; // fewer combat/strike signals => noise, not contested ground.
export const UNKNOWN_MAX_POLYS = 40;
// Contested means control is uncertain, which only happens near the line of
// contact. Rear-area combat reports (capital air strikes, far-wire news) are
// real violence but not control contests, so proposals farther than this
// from the assessed occupied edge stay out of the class (counted as gated).
export const UNKNOWN_MAX_FRONT_KM = 120;

/** Min equirectangular distance (km) from a point to ring vertices. */
export function minVertexDistanceKm(lat, lng, rings) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Array.isArray(rings)) return Infinity;
  let best = Infinity;
  for (const ring of rings) {
    if (!Array.isArray(ring)) continue;
    for (const point of ring) {
      if (!Array.isArray(point)) continue;
      const [rLat, rLng] = point;
      if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) continue;
      const dLat = (rLat - lat) * KM_PER_DEG_LAT;
      const dLng = (rLng - lng) * KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
      const dist = Math.hypot(dLat, dLng);
      if (dist < best) best = dist;
    }
  }
  return best;
}

/**
 * Promote zone proposals with enough combat/strike signal to unverified
 * unknown-class circles. Never throws on bad rows — skips them. When
 * `nearRings` (occupied [lat,lng] rings) is given, proposals beyond
 * `maxFrontKm` of the contact line are gated out and counted, not drawn.
 * Returns `{ polygons, gated }`.
 */
export function proposalsUnknownPolygons(doc, { minCombat = UNKNOWN_MIN_COMBAT, maxPolys = UNKNOWN_MAX_POLYS, nearRings = null, maxFrontKm = UNKNOWN_MAX_FRONT_KM } = {}) {
  const proposals = doc?.proposals;
  if (!Array.isArray(proposals)) return { polygons: [], gated: 0 };
  const polygons = [];
  let gated = 0;
  for (const proposal of proposals) {
    if (polygons.length >= maxPolys) break;
    if (!proposal || typeof proposal !== 'object') continue;
    const combat = Number(proposal.combatCount);
    if (!Number.isFinite(combat) || combat < minCombat) continue;
    const centroid = proposal.centroid || {};
    const lat = Number(centroid.lat);
    const lng = Number(centroid.lng);
    const radiusKm = Number(proposal.radiusKm);
    const ring = circlePoly(lat, lng, radiusKm);
    if (!ring) continue;
    if (nearRings && minVertexDistanceKm(lat, lng, nearRings) > maxFrontKm) { gated += 1; continue; }
    const region = String(proposal.region || proposal.zoneId || 'contested area');
    polygons.push({
      id: `news-${String(proposal.zoneId || `zone-${polygons.length}`)}`,
      style: '',
      nameUk: region,
      nameEn: `${region} — contested (recent combat reporting, unverified)`,
      condition: CONDITION_UNKNOWN,
      areaKm2: Math.round(Math.PI * radiusKm * radiusKm * 10) / 10,
      areaApproximate: true,
      src: SRC_NEWS,
      asOf: typeof proposal.newestIsoDate === 'string' ? proposal.newestIsoDate.slice(0, 10) : null,
      events: Number(proposal.eventCount) || 0,
      combat,
      poly: ring,
    });
  }
  return { polygons, gated };
}

/** Short stable hash of a polygon set for change detection. */
export function contentHashFor(detailedPolygons) {
  const slim = (Array.isArray(detailedPolygons) ? detailedPolygons : []).map((d) => [d?.id, d?.condition, d?.poly]);
  return createHash('sha1').update(JSON.stringify(slim)).digest('hex').slice(0, 12);
}

/** Validate a stored snapshot before the site (or tests) trusts it. */
export function validSnapshot(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.theatreId !== 'ukraine') return false;
  if (!Number.isFinite(value.snapshotId)) return false;
  if (!Array.isArray(value.detailedPolygons) || !value.detailedPolygons.length) return false;
  return value.detailedPolygons.every((d) => (
    d && typeof d.id === 'string' && typeof d.condition === 'string'
    && /Occupied|Liberated|Friendly|Unknown|Contested/.test(d.condition)
    && Array.isArray(d.poly) && d.poly.length >= 4
    && d.poly.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
      && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)
  ));
}
