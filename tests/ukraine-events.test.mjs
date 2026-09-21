import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UKRAINE_EVENTS_SCHEMA_VERSION, deepstateStatusToMeta, extractZipSingleFile,
  gdeltActorLabel, gdeltRowToEvent, gdeltTypeForRoot, gdeltExportUrl, gdeltWindowDates,
  googleNewsSources, iswPostToEvent, mergeLiveEvents, reliefwebDocToEvent, rssItemToEvent,
} from '../scripts/lib/ukraineEvents.mjs';
import { collect } from '../scripts/collect-ukraine-events.mjs';

const fixture = JSON.parse(readFileSync('tests/fixtures/ukraine-events.fixture.json', 'utf8'));

// --- GDELT row mapping (real sampled rows) ---
const combat = gdeltRowToEvent(fixture.gdeltRows[0].split('\t'));
assert.equal(combat.id, 'gdelt-1324023888');
assert.equal(combat.kind, 'event');
assert.equal(combat.type, 'combat');
assert.equal(combat.actor, 'Russian forces');
assert.equal(combat.coordsTier, 'approximate');
assert.equal(combat.date, '2026-09-21');
assert.ok(Math.abs(combat.lat - 50.4333) < 1e-9);
assert.ok(combat.sourceUrl.startsWith('https://'));
assert.ok(!('body' in combat) && !('content' in combat), 'derived metadata only: no article body');

const verbal = gdeltRowToEvent(fixture.gdeltRows[1].split('\t'));
assert.equal(verbal.type, 'other'); // CAMEO 11 disapprove — kept, non-kinetic
assert.equal(verbal.action, 'Disapproval (GDELT 112)');

assert.equal(gdeltRowToEvent(fixture.gdeltRows[2].split('\t')), null, 'QuadClass 1 cooperation is dropped');
assert.equal(gdeltRowToEvent(fixture.gdeltRows[3].split('\t')), null, 'non-Ukraine row is dropped');
assert.throws(() => gdeltRowToEvent(['a', 'b']), /cols/);

const badGeo = fixture.gdeltRows[0].split('\t');
badGeo[56] = 'not-a-number';
assert.equal(gdeltRowToEvent(badGeo), null, 'unparseable coords are dropped, never invented');
const badDate = fixture.gdeltRows[0].split('\t');
badDate[1] = 'nope';
assert.equal(gdeltRowToEvent(badDate), null, 'undated rows are dropped');

// --- CAMEO type + actor maps ---
assert.equal(gdeltTypeForRoot('19'), 'combat');
assert.equal(gdeltTypeForRoot('18'), 'strike');
assert.equal(gdeltTypeForRoot('20'), 'strike');
assert.equal(gdeltTypeForRoot('14'), 'other');
assert.equal(gdeltActorLabel('RUSSIA'), 'Russian forces');
assert.equal(gdeltActorLabel('KYIV'), 'Ukraine');
assert.equal(gdeltActorLabel(''), 'Unspecified');
assert.equal(gdeltActorLabel('VLADIMIR PUTIN'), 'Vladimir Putin');

// --- RSS ---
const rss = rssItemToEvent(fixture.rss[0].item, '2026-09-21T00:00:00.000Z');
assert.equal(rss.kind, 'news');
assert.equal(rss.coordsTier, 'unplaced');
assert.ok(!('lat' in rss) && !('lng' in rss), 'headlines never gain coordinates');
assert.equal(rssItemToEvent(fixture.rss[1].item, '2026-09-21T00:00:00.000Z'), null, 'dateless items are dropped');
assert.equal(rssItemToEvent({ url: 'notaurl', title: 'x', publishedAt: '2026-09-20T00:00:00Z' }), null);

const outlets = googleNewsSources(fixture.rss[2].xml);
assert.equal(outlets.get('https://news.google.com/rss/articles/fixture1'), 'Example Outlet');

// --- ISW ---
const wp = iswPostToEvent(fixture.isw[0]);
assert.equal(wp.kind, 'assessment');
assert.equal(wp.date, '2026-09-20');
const searchHit = iswPostToEvent(fixture.isw[1]);
assert.equal(searchHit.date, '2026-09-19');
assert.equal(searchHit.dateNote, 'date parsed from assessment title');
assert.equal(iswPostToEvent({ title: 'Undated post', link: 'https://understandingwar.org/x' }), null);

// --- ReliefWeb ---
const rw = reliefwebDocToEvent(fixture.reliefweb[0].doc, 'report');
assert.equal(rw.kind, 'report');
assert.equal(rw.source, 'UNICEF');
assert.equal(rw.sourceUrl, 'https://reliefweb.int/report/ukraine/fixture-report');
assert.equal(reliefwebDocToEvent({ fields: { title: 'no alias', date: { created: '2026-09-01T00:00:00+00:00' } } }), null);

// --- DeepState status (metadata only) ---
const ds = deepstateStatusToMeta(fixture.deepstate, '2026-09-21T00:00:00.000Z');
assert.equal(ds.snapshotId, '1789884551');
assert.equal(ds.featureCount, 3);
assert.ok(!('map' in ds) && !('features' in ds) && !('geometry' in ds), 'no DeepState geometry stored');
assert.throws(() => deepstateStatusToMeta({ id: 1 }, '2026-09-21T00:00:00.000Z'), /features/);

// --- ZIP extraction round-trip (hand-built local header + raw deflate) ---
{
  const payload = Buffer.from('a\tb\tc\n1\t2\t3\n', 'utf8');
  const raw = deflateRawSync(payload);
  const name = Buffer.from('test.export.CSV', 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(raw.length, 18);
  header.writeUInt32LE(payload.length, 22);
  header.writeUInt16LE(name.length, 26);
  const out = extractZipSingleFile(Buffer.concat([header, name, raw]));
  assert.equal(out.name, 'test.export.CSV');
  assert.equal(out.data.toString('utf8'), payload.toString('utf8'));
  assert.throws(() => extractZipSingleFile(Buffer.from('nope')), /zip/);
}

// --- GDELT window math ---
{
  const wins = gdeltWindowDates(new Date('2026-09-21T05:37:00Z'), 3);
  assert.equal(wins.length, 3);
  assert.equal(gdeltExportUrl(wins[0]), 'https://data.gdeltproject.org/gdeltv2/20260921053000.export.CSV.zip');
  assert.equal(gdeltExportUrl(wins[2]), 'https://data.gdeltproject.org/gdeltv2/20260921050000.export.CSV.zip');
}

// --- Merge: dedupe, retention, cap, sort ---
{
  const old = { id: 'a', kind: 'event', isoDate: '2026-09-17T00:00:00.000Z' }; // 4d old -> expired (72h)
  const keep = { id: 'b', kind: 'event', isoDate: '2026-09-20T12:00:00.000Z' };
  const oldAssess = { id: 'c', kind: 'assessment', isoDate: '2026-09-10T00:00:00.000Z' }; // 11d -> kept (14d)
  const ancientAssess = { id: 'd', kind: 'assessment', isoDate: '2026-09-01T00:00:00.000Z' }; // expired
  const undated = { id: 'e', kind: 'event', isoDate: 'garbage' };
  const merged = mergeLiveEvents({ previous: [old, keep, oldAssess, ancientAssess, undated], fresh: [{ ...keep, description: 'newer' }], now: '2026-09-21T00:00:00.000Z' });
  assert.deepEqual(merged.map((m) => m.id), ['b', 'c']);
  assert.equal(merged[0].description, 'newer', 'fresh wins on id collision');
}

// --- Fixture end-to-end through collect() ---
{
  const tmp = mkdtempSync(join(tmpdir(), 'wsr-ukraine-'));
  const result = await collect({ inputPath: 'tests/fixtures/ukraine-events.fixture.json', output: join(tmp, 'ukraine-events'), collectedAt: '2026-09-21T06:00:00.000Z' });
  assert.equal(result.changed, true);
  assert.equal(result.feed.schemaVersion, UKRAINE_EVENTS_SCHEMA_VERSION);
  assert.equal(result.feed.theatre, 'ukraine');
  assert.ok(result.feed.count >= 6, `expected >=6 events, got ${result.feed.count}`);
  assert.ok(result.feed.deepstate.snapshotId === '1789884551');
  assert.ok(result.feed.sources.every((s) => s.id && s.status));
  for (const e of result.feed.events) {
    assert.ok(e.id && e.isoDate && e.description && e.sourceUrl, 'live record carries id/date/description/source');
    assert.ok(!('body' in e) && !('content' in e), 'link-only across all kinds');
  }
  const again = await collect({ inputPath: 'tests/fixtures/ukraine-events.fixture.json', output: join(tmp, 'ukraine-events'), collectedAt: '2026-09-21T07:00:00.000Z' });
  assert.equal(again.changed, false, 'identical rerun writes nothing');
}

console.log('ukraine events normalizer and collector tests passed');
