#!/usr/bin/env node
// Freshness gate for the watchdog workflow (and local runs).
// Reads every latest.json snapshot, reports ages, and exports which collector
// groups are stale via $GITHUB_OUTPUT. Exit 0 always: staleness is a routing
// signal, not an error.
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Thresholds sit well inside the site's own stale limits so the watchdog
// heals snapshots before visitors see a stale flag.
export const GROUPS = {
  ukraine: { maxAgeMin: 75, snapshots: ['ukraine-events/latest.json'] },
  theatres: {
    maxAgeMin: 100,
    snapshots: [
      'taiwan-events/latest.json', 'gaza-events/latest.json', 'iran-events/latest.json',
      'sahel-events/latest.json', 'korea-events/latest.json', 'arctic-events/latest.json',
      'us-election-events/latest.json',
    ],
  },
  cache: { maxAgeMin: 100, snapshots: ['markets-data/latest.json', 'hazards-data/latest.json', 'events-data/latest.json', 'news-data/latest.json'] },
  traffic: { maxAgeMin: 75, snapshots: ['commercial-data/latest.json', 'maritime-data/latest.json'] },
  daily: { maxAgeMin: 30 * 60, snapshots: ['taiwan-data/latest.json', 'arctic-data/latest.json'] },
  territory: { maxAgeMin: 30 * 60, snapshots: ['territory-daily/latest.json'] },
};
// NOTE: global-vessel-data is key-gated (AISSTREAM_API_KEY); its absence is
// expected on keyless setups and never counts as stale. The traffic step
// still attempts it opportunistically whenever traffic is stale.

export async function snapshotAgeMin(root, rel, nowMs = Date.now()) {
  try {
    const raw = JSON.parse(await readFile(resolve(root, rel), 'utf8'));
    let t = Date.parse(raw?.collectedAt);
    if (!Number.isFinite(t) && typeof raw?.time === 'number') {
      // OpenSky-shaped snapshots (commercial-data) carry unix `time`, not collectedAt.
      t = raw.time > 1e12 ? raw.time : raw.time * 1000;
    }
    if (!Number.isFinite(t)) return { rel, ageMin: null, state: 'unparseable' };
    return { rel, ageMin: (nowMs - t) / 60000, state: 'ok' };
  } catch (error) {
    if (error?.code === 'ENOENT') return { rel, ageMin: null, state: 'missing' };
    return { rel, ageMin: null, state: 'unreadable' };
  }
}

export async function checkFreshness(root = ROOT, nowMs = Date.now()) {
  const report = {};
  for (const [group, spec] of Object.entries(GROUPS)) {
    const snapshots = [];
    for (const rel of spec.snapshots) {
      snapshots.push(await snapshotAgeMin(root, rel, nowMs));
    }
    const stale = snapshots.some((s) => s.state !== 'ok' || s.ageMin > spec.maxAgeMin);
    report[group] = { stale, maxAgeMin: spec.maxAgeMin, snapshots };
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const report = await checkFreshness();
  const staleGroups = Object.entries(report).filter(([, r]) => r.stale).map(([g]) => g);
  for (const [group, r] of Object.entries(report)) {
    const detail = r.snapshots.map((s) => `${s.rel}=${s.state === 'ok' ? s.ageMin.toFixed(0) + 'm' : s.state}`).join(' ');
    console.log(`${r.stale ? 'STALE ' : 'fresh '} ${group} (>${r.maxAgeMin}m): ${detail}`);
  }
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const lines = Object.keys(GROUPS).map((g) => `stale_${g}=${staleGroups.includes(g) ? 'true' : 'false'}`).join('\n')
      + `\nfresh=${staleGroups.length === 0 ? 'true' : 'false'}\n`;
    await appendFile(out, lines, 'utf8');
  } else {
    console.log(staleGroups.length === 0 ? 'all fresh' : `stale groups: ${staleGroups.join(',')}`);
  }
}
