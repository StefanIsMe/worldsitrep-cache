import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UKRAINE_EVENTS_SCHEMA_VERSION, applyGeocodeToItem, extractOsmCandidates,
  extractZipSingleFile, gdeltActorLabel, gdeltRowToEvent, gdeltTypeForRoot, gdeltExportUrl, gdeltGapWindows,
  gdeltWindowDates, geocodeText, googleNewsSources, iswPostToEvent, mergeLiveEvents,
  reliefwebDocToEvent, removeGeocode, rssItemToEvent, stripForGeocode, validateOsmResult,
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

// --- GDELT gap windows (self-healing lookback after skipped schedules) ---
{
  const gap = gdeltGapWindows('2026-09-22T00:15:06.206Z', new Date('2026-09-22T04:19:00.000Z'));
  assert.equal(gap.length, 16, 'every slot after the previous run, newest first');
  assert.equal(gdeltExportUrl(gap[0]), 'https://data.gdeltproject.org/gdeltv2/20260922041500.export.CSV.zip');
  assert.equal(gdeltExportUrl(gap[gap.length - 1]), 'https://data.gdeltproject.org/gdeltv2/20260922003000.export.CSV.zip');
  const clamped = gdeltGapWindows('2026-09-01T00:00:00.000Z', new Date('2026-09-22T04:19:00.000Z'));
  assert.equal(clamped.length, 48, 'lookback clamps to 48 windows (12h)');
  const fresh = gdeltGapWindows('2026-09-22T04:10:00.000Z', new Date('2026-09-22T04:19:00.000Z'));
  assert.equal(fresh.length, 5, 'recent previous run keeps the 5-window overlap minimum');
  assert.equal(gdeltGapWindows('garbage', new Date('2026-09-22T04:19:00.000Z')).length, 5, 'bad timestamp falls back to the overlap minimum');
  assert.equal(gdeltGapWindows('2026-09-23T00:00:00.000Z', new Date('2026-09-22T04:19:00.000Z')).length, 5, 'future timestamp falls back to the overlap minimum');
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
  const status = JSON.parse(readFileSync(join(tmp, 'ukraine-events', 'status.json'), 'utf8'));
  assert.equal(status.checkedAt, '2026-09-21T06:00:00.000Z', 'status.json records every run');
  assert.equal(status.collectedAt, '2026-09-21T06:00:00.000Z');
  assert.equal(status.changed, true);
  const dayIndex = JSON.parse(readFileSync(join(tmp, 'ukraine-events', 'index.json'), 'utf8'));
  const dayNames = Object.keys(dayIndex.days);
  assert.ok(dayNames.length >= 1, 'day-segment index is written');
  let dayTotal = 0;
  for (const day of dayNames) {
    const parts = day.split('-');
    const seg = JSON.parse(readFileSync(join(tmp, 'ukraine-events', 'days', parts[0], parts[1], parts[2] + '.json'), 'utf8'));
    assert.ok(seg.events.every((e) => String(e.isoDate).startsWith(day)), 'day file ' + day + ' holds only that UTC date');
    assert.equal(seg.count, seg.events.length);
    assert.equal(dayIndex.days[day].count, seg.events.length);
    dayTotal += seg.events.length;
  }
  assert.equal(dayTotal, result.feed.count, 'day segments partition the merged set');
  assert.equal(result.feed.theatre, 'ukraine');
  assert.ok(result.feed.count >= 6, `expected >=6 events, got ${result.feed.count}`);
  assert.ok(!('deepstate' in result.feed), 'no DeepState status poll (API access denied)');
  assert.ok(result.feed.sources.every((s) => s.id && s.status));
  for (const e of result.feed.events) {
    assert.ok(e.id && e.isoDate && e.description && e.sourceUrl, 'live record carries id/date/description/source');
    assert.ok(!('body' in e) && !('content' in e), 'link-only across all kinds');
  }
  const again = await collect({ inputPath: 'tests/fixtures/ukraine-events.fixture.json', output: join(tmp, 'ukraine-events'), collectedAt: '2026-09-21T07:00:00.000Z' });
  assert.equal(again.changed, false, 'identical rerun writes nothing');
}

// --- Headline geocoding: gazetteer ---
{
  const kyiv = geocodeText('Russia launched drones at Kyiv overnight');
  assert.equal(kyiv.label, 'Kyiv');
  assert.ok(Math.abs(kyiv.lat - 50.45) < 1e-9 && Math.abs(kyiv.lng - 30.52) < 1e-9);
  assert.equal(kyiv.level, 'city');
  assert.equal(geocodeText('Strikes on Kiev continue').label, 'Kyiv', 'variant spelling resolves');
  const region = geocodeText('Fighting across the Kharkiv region intensifies');
  assert.equal(region.label, 'Kharkiv region');
  assert.equal(region.level, 'region');
  assert.equal(geocodeText('Nova Kakhovka dam update').label, 'Nova Kakhovka', 'longest name wins');
  assert.equal(geocodeText('Offensive in the Donbas grinds on').level, 'region');
  assert.equal(geocodeText('Moscow hit with mass drone strikes').label, 'Moscow');
  assert.equal(geocodeText('People consume more news during war'), null, 'word boundaries guard substrings');
  assert.equal(geocodeText('Mastercard for travelling, Visa for shopping'), null, 'placeless text stays null');
  assert.equal(geocodeText('Russian Offensive Campaign Assessment, September 20, 2026'), null, 'assessments carry no place');
  assert.equal(geocodeText(''), null);
}

// --- OSM candidate extraction ---
{
  assert.deepEqual(extractOsmCandidates('clashes near Pokrovsk continue'), ['Pokrovsk']);
  assert.deepEqual(extractOsmCandidates('Explosions in Kryvyi Rih and strikes near Nikopol'), ['Kryvyi Rih', 'Nikopol']);
  assert.deepEqual(extractOsmCandidates('Strikes in Russia draw condemnation'), [], 'countries are blocked');
  assert.deepEqual(extractOsmCandidates('War in Ukraine enters a new phase'), [], 'countries are blocked');
  assert.deepEqual(extractOsmCandidates('Drones hit the airfield'), [], 'lowercase nouns are not candidates');
  assert.deepEqual(extractOsmCandidates('Build storage sites in Hungary amid fears'), [], 'countries are blocked');
  assert.deepEqual(extractOsmCandidates('Leaders to meet in New York for talks'), [], 'faraway capitals are blocked');
  assert.deepEqual(extractOsmCandidates('Man attacked on Sept 20 dies'), [], 'months are not candidates');
}

// --- OSM result validation ---
{
  const city = { lat: '49.0', lon: '37.8', class: 'place', type: 'town', address: { country_code: 'ua' }, display_name: 'Lyman, Donetsk Oblast, Ukraine' };
  const ok = validateOsmResult(city);
  assert.equal(ok.country, 'ua');
  assert.ok(Math.abs(ok.lat - 49.0) < 1e-9);
  assert.equal(validateOsmResult({ ...city, address: { country_code: 'ru' } }).country, 'ru');
  assert.equal(validateOsmResult({ lat: '60.0', lon: '100.0', class: 'boundary', type: 'country', address: { country_code: 'ru' }, display_name: 'Russia' }), null, 'country centroids rejected');
  assert.equal(validateOsmResult({ lat: '56.0', lon: '92.0', class: 'place', type: 'city', address: { country_code: 'ru' }, display_name: 'Krasnoyarsk, Russia' }), null, 'Siberia rejected');
  assert.equal(validateOsmResult({ lat: '38.9', lon: '-77.0', class: 'place', type: 'city', address: { country_code: 'us' }, display_name: 'Washington, USA' }), null, 'non-theatre countries rejected');
  assert.equal(validateOsmResult({ lat: '50.45', lon: '30.52', class: 'amenity', type: 'embassy', address: { country_code: 'ua' }, display_name: 'Embassy of Hungary Kyiv' }), null, 'embassies are not places');
  assert.equal(validateOsmResult({ lat: 'x', lon: 'y', address: {} }), null);
  assert.equal(validateOsmResult(null), null);
}

// --- applyGeocodeToItem ---
{
  const base = { id: 'n1', kind: 'news', description: 'x', tags: ['a'], coordsTier: 'unplaced', locationStr: 'Some Outlet', source: 'Some Outlet', sourceUrl: 'https://example.com/x' };
  const placed = applyGeocodeToItem(base, { lat: 49.99, lng: 36.23, level: 'city', label: 'Kharkiv', method: 'gazetteer' }, 'Kharkiv');
  assert.equal(placed.coordsTier, 'approximate');
  assert.ok(placed.coordsNote.includes('Kharkiv'));
  assert.equal(placed.locationStr, 'Kharkiv');
  assert.ok(placed.tags.includes('headline-geocoded'));
  const osm = applyGeocodeToItem(base, { lat: 49, lng: 37.8, display: 'Lyman, Donetsk Oblast', country: 'ua', method: 'osm' }, 'Lyman');
  assert.ok(osm.coordsNote.includes('OpenStreetMap'));
  assert.equal(applyGeocodeToItem(base, null, 'nowhere'), base, 'null geo returns the item untouched');
}

// --- Fixture end-to-end: geocoded news lands on the map, residue stays honest ---
{
  const tmp = mkdtempSync(join(tmpdir(), 'wsr-ukraine-geo-'));
  const result = await collect({ inputPath: 'tests/fixtures/ukraine-events.fixture.json', output: join(tmp, 'ukraine-events'), collectedAt: '2026-09-21T06:00:00.000Z' });
  const kharkiv = result.feed.events.find((e) => e.description.includes('Kharkiv overnight'));
  assert.ok(kharkiv.lat && kharkiv.lng, 'gazetteer-matched headline gains coords');
  assert.equal(kharkiv.coordsTier, 'approximate');
  assert.equal(kharkiv.locationStr, 'Kharkiv');
  const kherson = result.feed.events.find((e) => e.description.includes('winter aid in Kherson'));
  assert.ok(kherson.lat && kherson.lng, 'reliefweb report with a city gains coords');
  const sumy = result.feed.events.find((e) => e.description.includes('blasts reported in Sumy'));
  assert.equal(sumy.locationStr, 'Sumy', 'headline place wins over the Kyiv Independent citation suffix');
  assert.ok(Math.abs(sumy.lat - 50.91) < 1e-9);
  const card = result.feed.events.find((e) => e.description.includes('Mastercard'));
  assert.equal(card.coordsTier, 'unplaced');
  assert.ok(!('lat' in card) && !('lng' in card), 'placeless headlines stay feed-only');
  const outlet = result.feed.events.find((e) => e.description.includes("Kyiv Independent's reporting"));
  assert.equal(outlet.coordsTier, 'unplaced');
  assert.ok(!('lat' in outlet), 'outlet names in headlines are not places');
  const assessments = result.feed.events.filter((e) => e.kind === 'assessment');
  assert.ok(assessments.length > 0 && assessments.every((e) => e.coordsTier === 'unplaced'), 'theatre-wide assessments stay unplaced');
}

// --- Capital locative rule (capitals double as actor metonyms) ---
{
  assert.equal(geocodeText(stripForGeocode('The Moscow army captured most of the village')), null, 'Moscow army is an actor');
  assert.equal(geocodeText(stripForGeocode('Moscow occupiers west of Toshkivka hold on')), null, 'Moscow occupiers are actors');
  assert.equal(geocodeText(stripForGeocode("Moscow's occupying forces recorded near Svyatohirsk")).label, 'Sviatohirsk', 'actor ignored, real place wins');
  assert.equal(geocodeText(stripForGeocode('Moscow says Kyiv did it')), null, 'bare capitals without locative context stay null');
  assert.equal(geocodeText(stripForGeocode('Moscow warns of escalation')), null);
  assert.equal(geocodeText(stripForGeocode("Kyiv's forces liberated the town")), null);
  assert.equal(geocodeText(stripForGeocode('Moscow says Kharkiv was hit')).label, 'Kharkiv', 'real place still wins');
  assert.equal(geocodeText(stripForGeocode('Kyiv says Kharkiv was hit')).label, 'Kharkiv');
  assert.equal(geocodeText(stripForGeocode('Hundreds of drones target Moscow')).label, 'Moscow', 'verb-object target places');
  assert.equal(geocodeText(stripForGeocode('Moscow hit with mass drone strikes')).label, 'Moscow', 'passive target places');
  assert.equal(geocodeText(stripForGeocode('Explosions rock Kyiv overnight')).label, 'Kyiv', 'rock/shake verbs place');
  assert.equal(geocodeText(stripForGeocode('Strikes on Kiev continue')).label, 'Kyiv', 'prepositional variant places');
  assert.equal(geocodeText(stripForGeocode('Air defences work over Kyiv region')).label, 'Kyiv region', 'region phrases bypass the capital rule');
}

// --- removeGeocode + re-validation of carried-over items ---
{
  const bad = {
    id: 'n9', kind: 'news', date: '2026-09-20', isoDate: '2026-09-20T00:00:00.000Z',
    description: 'The Moscow army captured the village (Outlet, 2026-09-20. Headline + link only.)',
    lat: 55.76, lng: 37.62, coordsTier: 'approximate', coordsNote: 'Headline gazetteer match: "Moscow" (city); verify via source article.',
    locationStr: 'Moscow', source: 'Outlet', sourceUrl: 'https://example.com/n9', tags: ['Outlet', 'headline-geocoded'],
  };
  const fixed = removeGeocode(bad);
  assert.equal(fixed.coordsTier, 'unplaced');
  assert.ok(!('lat' in fixed) && !('coordsNote' in fixed));
  assert.equal(fixed.locationStr, 'Outlet', 'publisher restored as location label');
  assert.ok(!fixed.tags.includes('headline-geocoded'));

  // End-to-end: a misplaced carried-over item is healed on the next run.
  const tmp = mkdtempSync(join(tmpdir(), 'wsr-ukraine-heal-'));
  const prevDir = join(tmp, 'ukraine-events');
  mkdirSync(prevDir, { recursive: true });
  writeFileSync(join(prevDir, 'latest.json'), JSON.stringify({ schemaVersion: 1, events: [bad] }));
  const result = await collect({ inputPath: 'tests/fixtures/ukraine-events.fixture.json', output: prevDir, collectedAt: '2026-09-21T06:00:00.000Z' });
  const healed = result.feed.events.find((e) => e.id === 'n9');
  assert.equal(healed.coordsTier, 'unplaced', 'carried-over Moscow-army dot is removed');
  assert.ok(!('lat' in healed));
}

console.log('ukraine events normalizer and collector tests passed');
