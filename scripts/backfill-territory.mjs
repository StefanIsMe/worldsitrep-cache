#!/usr/bin/env node
// One-shot territory backfill — NOT scheduled. Seeds territory-daily/days
// with WEEKLY (Monday) occupied-territory snapshots from the cyterat
// deepstate-map-data mirror, so the site timeline starts 2024-07-08.
// Daily per-day files before the unified gzip's dated span are fetched from
// the mirror repo (throttled); dated rows inside the unified gzip cover the
// recent span. Run locally, review the diff, commit once.
//
// Usage:
//   node scripts/backfill-territory.mjs --mirror-gz=mirror.geojson.gz [--days-dir=territory-daily/days] [--index-out=territory-daily/index.json]
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, promises as fsp } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { mirrorDaySnapshot, validSnapshot } from './lib/territory.mjs';
import { buildDayIndex } from './lib/territoryIndex.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PER_DAY_URL = (yyyymmdd) => `https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_${yyyymmdd}.geojson`;
const FETCH_THROTTLE_MS = 600;
const FIRST_MONDAY = '2024-07-08'; // mirror's first per-day file (a Monday).

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isMonday(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 1;
}

function mondaysBetween(startStr, endExclusiveStr) {
  const out = [];
  const cursor = new Date(`${startStr}T12:00:00Z`);
  const end = Date.parse(`${endExclusiveStr}T12:00:00Z`);
  while (cursor.getTime() < end) {
    if (cursor.getUTCDay() === 1) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
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

async function fetchPerDay(dateStr) {
  const compact = dateStr.replaceAll('-', '');
  const url = PER_DAY_URL(compact);
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'WorldSITREP-cache-collector/1.0 (+https://worldsitrep.com)' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mirror per-day fetch failed: HTTP ${res.status} for ${dateStr}`);
  return { payload: await res.json(), url };
}

async function main() {
  const mirrorGz = option('mirror-gz');
  if (!mirrorGz) throw new Error('--mirror-gz is required (local unified gzip path)');
  const daysDir = resolve(option('days-dir', resolve(ROOT, 'territory-daily/days')));
  const indexOut = resolve(option('index-out', resolve(ROOT, 'territory-daily/index.json')));
  const collectedAt = new Date().toISOString();

  const chunks = [];
  for await (const chunk of createReadStream(resolve(mirrorGz))) chunks.push(chunk);
  const unified = JSON.parse(gunzipSync(Buffer.concat(chunks)).toString('utf8'));
  const datedRows = new Map();
  for (const f of unified.features || []) {
    const d = f?.properties?.date;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) datedRows.set(d, f.geometry);
  }
  const unifiedDates = [...datedRows.keys()].sort();
  console.log(`unified gzip: ${unifiedDates.length} dated rows (${unifiedDates[0]}..${unifiedDates[unifiedDates.length - 1]})`);
  const unifiedStart = unifiedDates[0];

  // Mondays before unified coverage come from per-day files.
  const earlyMondays = mondaysBetween(FIRST_MONDAY, unifiedStart);
  console.log(`fetching ${earlyMondays.length} per-day Mondays before ${unifiedStart}…`);
  let written = 0;
  let skipped = 0;
  for (const dateStr of earlyMondays) {
    const dayPath = resolve(daysDir, dateStr.slice(0, 4), dateStr.slice(5, 7), `${dateStr.slice(8, 10)}.json`);
    try {
      await fsp.access(dayPath);
      skipped += 1; // idempotent reruns never rewrite history.
      continue;
    } catch { /* missing — write it */ }
    const fetched = await fetchPerDay(dateStr).catch((e) => ({ error: e }));
    await sleep(FETCH_THROTTLE_MS);
    if (!fetched || fetched.error || !fetched.payload) {
      console.log(`  gap ${dateStr}: ${fetched?.error?.message || '404'}`);
      skipped += 1;
      continue;
    }
    const feature = (fetched.payload.features || [])[0];
    const coords = feature?.geometry?.coordinates;
    if (!coords) { console.log(`  gap ${dateStr}: no geometry`); skipped += 1; continue; }
    const snap = mirrorDaySnapshot(dateStr, coords, { sourceUrl: fetched.url, collectedAt, backfill: true });
    if (!validSnapshot(snap)) throw new Error(`backfill day failed validation: ${dateStr}`);
    await atomicJsonWrite(dayPath, { ...snap, snapshots: [{ snapshotId: snap.snapshotId, collectedAt }] });
    written += 1;
  }

  // Mondays inside unified coverage come from the gzip rows (no network).
  for (const dateStr of unifiedDates.filter(isMonday)) {
    const dayPath = resolve(daysDir, dateStr.slice(0, 4), dateStr.slice(5, 7), `${dateStr.slice(8, 10)}.json`);
    try {
      await fsp.access(dayPath);
      skipped += 1;
      continue;
    } catch { /* missing — write it */ }
    const geometry = datedRows.get(dateStr);
    const coords = geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
    if (!coords) { console.log(`  gap ${dateStr}: unsupported geometry ${geometry?.type}`); skipped += 1; continue; }
    const snap = mirrorDaySnapshot(dateStr, coords, {
      sourceUrl: 'https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/deepstate-map-data.geojson.gz',
      collectedAt,
      backfill: true,
    });
    if (!validSnapshot(snap)) throw new Error(`backfill day failed validation: ${dateStr}`);
    await atomicJsonWrite(dayPath, { ...snap, snapshots: [{ snapshotId: snap.snapshotId, collectedAt }] });
    written += 1;
  }

  const index = await buildDayIndex(daysDir);
  await atomicJsonWrite(indexOut, index);
  console.log(`backfill: wrote ${written}, skipped ${skipped} (gaps/existing); index covers ${index.coverage.count} days (${index.coverage.first}..${index.coverage.last})`);
}

try {
  await main();
} catch (error) {
  console.error(`backfill-territory: ${error.message}`);
  process.exitCode = 1;
}
