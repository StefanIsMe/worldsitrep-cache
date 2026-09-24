import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFreshness, GROUPS, snapshotAgeMin } from '../scripts/check-freshness.mjs';

const NOW = Date.parse('2026-09-22T04:00:00.000Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();

const tmp = mkdtempSync(join(tmpdir(), 'wsr-fresh-'));
const put = (rel, collectedAt) => {
  mkdirSync(join(tmp, rel.split('/')[0]), { recursive: true });
  writeFileSync(join(tmp, rel), JSON.stringify({ collectedAt }));
};
put('ukraine-events/latest.json', ago(200)); // stale (>75m)
put('markets-data/latest.json', ago(10));
put('hazards-data/latest.json', ago(10));
put('events-data/latest.json', ago(10));
put('news-data/latest.json', ago(10));
put('commercial-data/latest.json', ago(10));
// maritime-data/latest.json missing -> traffic stale
put('taiwan-data/latest.json', ago(60));
put('arctic-data/latest.json', 'not-a-date'); // unparseable -> daily stale
put('territory-daily/latest.json', ago(60));
put('taiwan-events/latest.json', ago(10));
put('gaza-events/latest.json', ago(10));
put('iran-events/latest.json', ago(10));
put('sahel-events/latest.json', ago(10));
put('korea-events/latest.json', ago(200)); // stale (>100m)
put('arctic-events/latest.json', ago(10));
put('us-election-events/latest.json', ago(10));

const r = await checkFreshness(tmp, NOW);
assert.equal(r.ukraine.stale, true, 'ukraine past 75m is stale');
assert.equal(r.theatres.stale, true, 'one stale theatre wire stales the group');
assert.equal(r.cache.stale, false, 'cache within 100m is fresh');
assert.equal(r.traffic.stale, true, 'missing snapshot counts as stale');
assert.equal(r.daily.stale, true, 'unparseable collectedAt counts as stale');
assert.equal(r.territory.stale, false, 'territory within 30h is fresh');
assert.deepEqual(Object.keys(GROUPS), ['ukraine', 'theatres', 'cache', 'traffic', 'daily', 'territory']);

const boundary = mkdtempSync(join(tmpdir(), 'wsr-fresh-2-'));
mkdirSync(join(boundary, 'ukraine-events'), { recursive: true });
writeFileSync(join(boundary, 'ukraine-events', 'latest.json'), JSON.stringify({ collectedAt: ago(75) }));
const edge = await snapshotAgeMin(boundary, 'ukraine-events/latest.json', NOW);
assert.equal(edge.state, 'ok');
assert.ok(Math.abs(edge.ageMin - 75) < 1e-9);

const unix = mkdtempSync(join(tmpdir(), 'wsr-fresh-3-'));
mkdirSync(join(unix, 'commercial-data'), { recursive: true });
writeFileSync(join(unix, 'commercial-data', 'latest.json'), JSON.stringify({ time: Math.floor(NOW / 1000) - 30 * 60 }));
const u = await snapshotAgeMin(unix, 'commercial-data/latest.json', NOW);
assert.equal(u.state, 'ok', 'unix time fallback covers OpenSky-shaped snapshots');
assert.ok(Math.abs(u.ageMin - 30) < 1e-6);

console.log('freshness gate tests passed');
