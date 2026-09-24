#!/usr/bin/env node
// Territory collector — scheduled GitHub Actions (worldsitrep-cache).
// ZERO direct DeepStateMap.live calls: API access was denied (Sep 2026).
// Three-class merge, all automated (no hand-drawn lines):
//  - OCCUPIED (assessed): the public cyterat mirror's per-day GeoJSON
//    (GitHub raw, ~03:00 UTC), normalized to site snapshots.
//  - FRIENDLY (derived): the pinned open Ukraine ADM0 boundary
//    (data/territory/boundary-ukraine.geojson, geoBoundaries / OSM, ODbL),
//    auto-refreshed when older than BOUNDARY_MAX_AGE_DAYS.
//  - UNKNOWN (derived): combat-reporting clusters from the live wire's
//    zone-proposals/latest.json, auto-surfaced as unverified circles.
// Every snapshot keeps per-polygon `src` provenance plus per-class census
// (count + as-of date + source). If DeepState asks us to stop, the mirror
// leg is disabled the same day — the derived legs keep running.
// Manual path: --input=file replays a user-supplied payload locally without
// network (a mirror per-day GeoJSON with --date, or a history-snapshot
// envelope). Nothing here scrapes HTML or touches a bot wall.
//
// Local validation: node scripts/collect-territory.mjs
//   --input=day.geojson --date=2026-09-23 --output-dir=$TMP/terr
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOUNDARY_LICENSE_URL, BOUNDARY_ODBL_URL, BOUNDARY_SOURCE,
  DEEPSTATE_LICENSE_URL, NEWS_DERIVED_SOURCE,
  boundaryFriendlyPolygon, contentHashFor, mirrorDaySnapshot,
  normalizeSnapshot, proposalsUnknownPolygons, validSnapshot,
} from './lib/territory.mjs';
import { buildDayIndex } from './lib/territoryIndex.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR_DAY_URL = (yyyymmdd) => `https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_${yyyymmdd}.geojson`;
const GEOBOUNDARIES_API = 'https://www.geoboundaries.org/api/current/gbOpen/UKR/ADM0';
const CASCADE_DAYS = 3; // today, yesterday, day-before (mirror gaps happen).
const BOUNDARY_MAX_AGE_DAYS = 180; // country borders barely move; refresh rarely.
const DEFAULT_TIMEOUT_MS = 25_000;
const UA = 'WorldSITREP-cache-collector/1.0 (+https://worldsitrep.com)';

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

async function fetchJson(url, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': UA } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${label} request timed out after ${timeoutMs} ms`);
    if (error.message.startsWith(label)) throw error;
    throw new Error(`${label} request failed: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

async function atomicJsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value) + '\n', 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function existingJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function utcDay(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Fetch the newest available mirror day (cascades over gaps). */
async function fetchMirrorDay() {
  let lastError = null;
  for (let back = 0; back < CASCADE_DAYS; back++) {
    const dateStr = utcDay(-back);
    const url = MIRROR_DAY_URL(dateStr.replaceAll('-', ''));
    try {
      const payload = await fetchJson(url, DEFAULT_TIMEOUT_MS, `mirror ${dateStr}`);
      if (!payload) continue; // 404 gap — try the previous day.
      const feature = payload.features?.[0];
      const coords = feature?.geometry?.coordinates;
      if (feature?.geometry?.type !== 'MultiPolygon' || !coords) {
        throw new Error(`mirror ${dateStr}: expected a MultiPolygon feature`);
      }
      return { dateStr, coords, url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('mirror returned no usable day');
}

/**
 * Refresh the pinned boundary when the meta pin is older than
 * BOUNDARY_MAX_AGE_DAYS. Resolve the current simplified download via the
 * geoBoundaries API (commit-pinned raw URLs rot), validate the payload by
 * building the friendly polygon, then write file + meta atomically.
 * Never throws: refresh failures degrade to the pinned copy with a note.
 */
async function maybeRefreshBoundary(boundaryPath, boundaryMetaPath, checkedAt, notes) {
  let meta = await existingJson(boundaryMetaPath).catch(() => null);
  const pinnedMs = Date.parse(meta?.pinnedAt || '');
  const ageDays = Number.isFinite(pinnedMs) ? (Date.parse(checkedAt) - pinnedMs) / 86400000 : Infinity;
  const pinned = await existingJson(boundaryPath).catch(() => null);
  if (ageDays <= BOUNDARY_MAX_AGE_DAYS && pinned) return { boundary: pinned, meta };
  try {
    const info = await fetchJson(GEOBOUNDARIES_API, DEFAULT_TIMEOUT_MS, 'geoBoundaries API');
    const downloadUrl = info?.simplifiedGeometryGeoJSON;
    if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('https://')) {
      throw new Error('geoBoundaries API returned no simplified download URL');
    }
    const payload = await fetchJson(downloadUrl, DEFAULT_TIMEOUT_MS, 'geoBoundaries download');
    const probe = boundaryFriendlyPolygon(payload, { pinnedAt: checkedAt });
    if (!probe) throw new Error('downloaded boundary has no usable ring');
    await atomicJsonWrite(boundaryPath, payload);
    meta = {
      pinnedAt: checkedAt,
      source: BOUNDARY_SOURCE,
      apiUrl: GEOBOUNDARIES_API,
      downloadUrl,
      licenseUrl: BOUNDARY_LICENSE_URL,
      odblUrl: BOUNDARY_ODBL_URL,
      vertices: probe.vertices,
      boundaryYearRepresented: info?.boundaryYearRepresented ?? null,
    };
    await atomicJsonWrite(boundaryMetaPath, meta);
    notes.push(`boundary refreshed (${probe.vertices} vertices)`);
    return { boundary: payload, meta };
  } catch (error) {
    notes.push(`boundary refresh failed, pinned copy kept: ${error.message}`.slice(0, 200));
    return { boundary: pinned, meta };
  }
}

async function main() {
  const outputDir = resolve(option('output-dir', resolve(ROOT, 'territory-daily')));
  const boundaryPath = resolve(option('boundary', resolve(ROOT, 'data/territory/boundary-ukraine.geojson')));
  const boundaryMetaPath = resolve(option('boundary-meta', resolve(ROOT, 'data/territory/boundary-meta.json')));
  const proposalsPath = resolve(option('proposals', resolve(ROOT, 'zone-proposals/latest.json')));
  const latestPath = resolve(outputDir, 'latest.json');
  const statusPath = resolve(outputDir, 'status.json');
  const checkedAt = new Date().toISOString();
  const notes = [];

  const fail = async (message) => {
    const prior = await existingJson(statusPath).catch(() => null);
    await atomicJsonWrite(statusPath, {
      checkedAt,
      ok: false,
      error: String(message).slice(0, 500),
      licenseUrl: DEEPSTATE_LICENSE_URL,
      priorSnapshotId: prior?.snapshotId ?? null,
    });
    throw new Error(message);
  };

  let occupied;
  let mode;
  let mirrorUrl = null;
  const inputFile = option('input');
  if (inputFile) {
    let payload;
    try {
      payload = JSON.parse(await readFile(resolve(inputFile), 'utf8'));
    } catch (error) {
      await fail(`--input file unreadable: ${error.message}`);
    }
    if (payload?.map?.features) {
      // Manual history-envelope replay (user-supplied file, no network).
      try {
        const snap = normalizeSnapshot(payload, { collectedAt: checkedAt });
        await atomicJsonWrite(latestPath, snap);
        await atomicJsonWrite(resolve(outputDir, 'index.json'), await buildDayIndex(resolve(outputDir, 'days')));
        await atomicJsonWrite(statusPath, {
          checkedAt, ok: true, unchanged: false, mode: 'manual-replay',
          snapshotId: snap.snapshotId, snapshotDate: snap.snapshotDate,
          collectedAt: checkedAt, featuresCount: snap.featuresCount,
          licenseUrl: DEEPSTATE_LICENSE_URL,
        });
        console.log(`territory: manual replay snapshot ${snap.snapshotId} (${snap.featuresCount} polys)`);
        return;
      } catch (error) {
        await fail(error.message);
      }
    }
    const dateStr = option('date');
    const feature = payload?.features?.[0];
    const coords = feature?.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates : null;
    if (!dateStr || !coords) await fail('--input mirror replay needs a dated MultiPolygon file plus --date=YYYY-MM-DD');
    try {
      occupied = mirrorDaySnapshot(dateStr, coords, { sourceUrl: `file://${resolve(inputFile)}`, collectedAt: checkedAt });
    } catch (error) {
      await fail(error.message);
    }
    mode = 'manual-replay';
  } else {
    let fetched;
    try {
      fetched = await fetchMirrorDay();
    } catch (error) {
      await fail(error.message);
    }
    try {
      occupied = mirrorDaySnapshot(fetched.dateStr, fetched.coords, { sourceUrl: fetched.url, collectedAt: checkedAt });
    } catch (error) {
      await fail(error.message);
    }
    mirrorUrl = fetched.url;
    mode = 'mirror';
  }

  // Derived legs: friendly underlay + news-driven unknown circles.
  const { boundary, meta: boundaryMeta } = inputFile
    ? { boundary: await existingJson(boundaryPath).catch(() => null), meta: await existingJson(boundaryMetaPath).catch(() => null) }
    : await maybeRefreshBoundary(boundaryPath, boundaryMetaPath, checkedAt, notes);
  const friendly = boundary
    ? boundaryFriendlyPolygon(boundary, { pinnedAt: boundaryMeta?.pinnedAt || null })
    : null;
  if (!friendly) notes.push('friendly underlay missing — boundary file unusable or absent');
  const proposalsDoc = await existingJson(proposalsPath).catch(() => null);
  if (!proposalsDoc) notes.push('zone proposals missing — unknown class empty this run');
  const { polygons: unknown, gated: unknownGated } = proposalsUnknownPolygons(proposalsDoc, {
    nearRings: occupied.detailedPolygons.map((d) => d.poly),
  });
  if (unknownGated) notes.push(`${unknownGated} proposal(s) gated: combat reporting too far from the contact line`);
  // Draw order bottom-to-top: friendly underlay, unknown circles, occupied.
  const detailedPolygons = [...(friendly ? [friendly] : []), ...unknown, ...occupied.detailedPolygons];
  const contentHash = contentHashFor(detailedPolygons);
  const unknownAsOf = unknown.map((d) => d.asOf).filter(Boolean).sort().at(-1) || null;
  const snapshot = {
    ...occupied,
    detailedPolygons,
    featuresCount: detailedPolygons.length,
    contentHash,
    partial: !friendly,
    ...(notes.length ? { note: notes.join(' | ') } : { note: undefined }),
    census: {
      ...occupied.census,
      mode,
      occupied: { count: occupied.detailedPolygons.length, asOf: occupied.snapshotDate, src: 'mirror', url: mirrorUrl || occupied.sourceUrl },
      friendly: friendly
        ? { count: 1, asOf: friendly.asOf, src: 'boundary-derived', source: BOUNDARY_SOURCE, licenseUrl: BOUNDARY_LICENSE_URL }
        : { count: 0, asOf: null, src: 'boundary-derived', note: 'boundary unusable this run' },
      unknown: {
        count: unknown.length, asOf: unknownAsOf, src: 'news-derived',
        source: NEWS_DERIVED_SOURCE, proposalsCollectedAt: proposalsDoc?.collectedAt || null,
        gatedOut: unknownGated, coarseGdeltDropped: proposalsDoc?.coarseGdeltDropped ?? null,
      },
    },
  };
  if (snapshot.note === undefined) delete snapshot.note;
  if (!validSnapshot(snapshot)) await fail('merged snapshot failed validation');

  const prior = await existingJson(latestPath).catch(() => null);
  const priorValid = prior && validSnapshot(prior);
  if (priorValid && prior.snapshotId === snapshot.snapshotId && prior.contentHash === snapshot.contentHash) {
    await atomicJsonWrite(statusPath, {
      checkedAt, ok: true, unchanged: true, mode,
      snapshotId: snapshot.snapshotId, snapshotDate: snapshot.snapshotDate,
      collectedAt: prior.collectedAt, featuresCount: snapshot.featuresCount,
      contentHash, mirrorUrl, licenseUrl: DEEPSTATE_LICENSE_URL,
    });
    console.log(`territory: unchanged snapshot ${snapshot.snapshotId} (heartbeat only)`);
    return;
  }

  await atomicJsonWrite(latestPath, snapshot);
  const day = snapshot.snapshotDate;
  const dayPath = resolve(outputDir, 'days', day.slice(0, 4), day.slice(5, 7), `${day.slice(8, 10)}.json`);
  const priorDay = await existingJson(dayPath).catch(() => null);
  const seen = Array.isArray(priorDay?.snapshots) ? priorDay.snapshots : [];
  if (!seen.some((s) => s?.snapshotId === snapshot.snapshotId && (s?.contentHash || null) === contentHash)) {
    seen.push({ snapshotId: snapshot.snapshotId, collectedAt: checkedAt, contentHash });
  }
  await atomicJsonWrite(dayPath, { ...snapshot, snapshots: seen });
  await atomicJsonWrite(resolve(outputDir, 'index.json'), await buildDayIndex(resolve(outputDir, 'days')));
  await atomicJsonWrite(statusPath, {
    checkedAt, ok: true, unchanged: false, mode,
    snapshotId: snapshot.snapshotId, snapshotDate: snapshot.snapshotDate,
    collectedAt: checkedAt, featuresCount: snapshot.featuresCount,
    contentHash, mirrorUrl,
    friendly: snapshot.census.friendly, unknown: snapshot.census.unknown,
    notes,
    licenseUrl: DEEPSTATE_LICENSE_URL,
  });
  console.log(`territory: snapshot ${snapshot.snapshotId} (${occupied.featuresCount} occupied + ${friendly ? 1 : 0} friendly + ${unknown.length} unknown)`);
}

try {
  await main();
} catch (error) {
  console.error(`collect-territory: ${error.message}`);
  process.exitCode = 1;
}
