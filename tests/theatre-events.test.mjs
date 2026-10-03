import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  THEATRE_EVENTS_SCHEMA_VERSION, createGeocoder, feedTitleKept,
  gdeltActorLabelFor, gdeltRowToEventFor, validateOsmResultFor,
} from '../scripts/lib/theatreEvents.mjs';
import { THEATRE_IDS, THEATRES, getTheatre } from '../scripts/lib/theatreConfigs.mjs';
import { collect } from '../scripts/collect-theatre-events.mjs';

const fixture = JSON.parse(readFileSync('tests/fixtures/theatre-events.fixture.json', 'utf8'));
const gdelt = (i) => fixture.gdeltRows[i].split('\t');
const cfg = (id) => getTheatre(id);
const gdeltOpts = (id) => ({ ...cfg(id).gdelt, actorMap: cfg(id).actorMap });

// --- Config validity: every theatre is fully specified ---
assert.deepEqual([...THEATRE_IDS].sort(), ['arctic', 'france', 'gaza', 'houthis', 'iran', 'korea', 'myanmar', 'sahel', 'taiwan', 'us-election']);
for (const id of THEATRE_IDS) {
  const c = cfg(id);
  assert.equal(c.dir, `${id}-events`, `${id}: warehouse dir`);
  assert.ok(Array.isArray(c.gdelt.fips) || Array.isArray(c.gdelt.bbox), `${id}: gdelt selector`);
  if (c.gdelt.bbox) {
    const [minLat, minLng, maxLat, maxLng] = c.gdelt.bbox;
    assert.ok(minLat < maxLat && Math.abs(minLat) <= 90 && Math.abs(maxLat) <= 90, `${id}: sane gdelt bbox`);
    assert.ok(Math.abs(minLng) <= 180 && Math.abs(maxLng) <= 180, `${id}: sane gdelt bbox lng`);
  }
  assert.ok(c.actorMap.length >= 3, `${id}: actor map`);
  for (const [pattern] of c.actorMap) new RegExp(pattern, 'i'); // throws on bad regex
  assert.ok(c.rssFeeds.length >= 3, `${id}: >=3 rss feeds`);
  const feedIds = new Set();
  for (const f of c.rssFeeds) {
    assert.ok(f.id && !feedIds.has(f.id), `${id}: unique feed id ${f.id}`);
    feedIds.add(f.id);
    assert.ok(String(f.url).startsWith('https://'), `${id}: feed ${f.id} is https`);
    assert.equal(f.theatre, id, `${id}: feed ${f.id} tagged`);
    if (f.match) for (const pattern of f.match) new RegExp(pattern, 'i'); // relevance patterns compile
    // Query-scoped feeds may carry an optional match safety net (us-election
    // GNews does: Trump queries drift into foreign stories). Absent = unfiltered.
  }
  assert.ok(c.osm.countryCodes.length >= 1, `${id}: osm countries`);
  assert.ok(c.gazetteer.length >= 10, `${id}: gazetteer depth`);
  const [minLat, minLng, maxLat, maxLng] = c.osm.bbox;
  for (const g of c.gazetteer) {
    assert.ok(g.names.length >= 1 && g.label && Number.isFinite(g.lat) && Number.isFinite(g.lng), `${id}: gazetteer entry shape`);
    assert.ok(g.lat >= minLat && g.lat <= maxLat, `${id}: ${g.label} lat inside osm bbox`);
    const inLng = minLng <= maxLng ? (g.lng >= minLng && g.lng <= maxLng) : (g.lng >= minLng || g.lng <= maxLng);
    assert.ok(inLng, `${id}: ${g.label} lng inside osm bbox`);
  }
}
assert.throws(() => getTheatre('ukraine'), /unknown theatre/, 'ukraine keeps its own collector');
assert.equal(getTheatre('us-election').gdelt.disabled, true, 'us-election is RSS-only');
assert.throws(() => getTheatre('atlantis'), /unknown theatre/);
assert.equal(THEATRE_EVENTS_SCHEMA_VERSION, 1, 'envelope-compatible with ukraine-events v1');

// --- GDELT per-theatre filtering (fixture rows 0..9) ---
{
  const tw = gdeltRowToEventFor(gdelt(0), gdeltOpts('taiwan'));
  assert.equal(tw.id, 'gdelt-2000000001');
  assert.equal(tw.actor, 'China');
  assert.equal(tw.type, 'other'); // root 15 posture — kept, non-kinetic
  assert.equal(gdeltRowToEventFor(gdelt(0), gdeltOpts('gaza')), null, 'TW row is not gaza');
  assert.equal(gdeltRowToEventFor(gdelt(9), gdeltOpts('taiwan')), null, 'QuadClass 1 cooperation is dropped');

  const gaza = gdeltRowToEventFor(gdelt(1), gdeltOpts('gaza'));
  assert.equal(gaza.type, 'combat');
  assert.equal(gaza.actor, 'Israel');
  const iran = gdeltRowToEventFor(gdelt(2), gdeltOpts('iran'));
  assert.equal(iran.action, 'Threat (GDELT 138)');
  assert.equal(gdeltRowToEventFor(gdelt(2), gdeltOpts('gaza')), null, 'IR row is not gaza');
  const ml = gdeltRowToEventFor(gdelt(3), gdeltOpts('sahel'));
  assert.equal(ml.actor, 'Mali');
  const uv = gdeltRowToEventFor(gdelt(4), gdeltOpts('sahel'));
  assert.equal(uv.type, 'strike');
  assert.equal(uv.actor, 'Burkina Faso');
  const kn = gdeltRowToEventFor(gdelt(5), gdeltOpts('korea'));
  assert.equal(kn.actor, 'North Korea');
  assert.equal(gdeltRowToEventFor(gdelt(5), gdeltOpts('taiwan')), null, 'KN row is not taiwan');

  // Arctic matches by polar bbox, not FIPS.
  const svalbard = gdeltRowToEventFor(gdelt(6), gdeltOpts('arctic'));
  assert.equal(svalbard.locationStr, 'Svalbard, Norway');
  assert.equal(gdeltRowToEventFor(gdelt(0), gdeltOpts('arctic')), null, 'Taipei is outside the polar bbox');

  // US wire is RSS-only (gdelt.disabled): GDELT rows carry no headline text,
  // so FIPS US + roots 13-17 admitted ~100/hr domestic noise rows for this
  // subject-matter topic. Disabled drops every row after the shape check.
  assert.equal(gdeltRowToEventFor(gdelt(7), gdeltOpts('us-election')), null, 'us-election GDELT is disabled');
  assert.equal(gdeltRowToEventFor(gdelt(8), gdeltOpts('us-election')), null, 'assault root is not policy volatility');
  assert.throws(() => gdeltRowToEventFor(['a', 'b'], gdeltOpts('us-election')), /cols/, 'disabled still rejects malformed rows');
  const mm = gdeltRowToEventFor(gdelt(12), gdeltOpts('myanmar'));
  assert.equal(mm.actor, 'Myanmar junta');
  assert.equal(mm.locationStr, 'Sagaing, Myanmar');
  assert.equal(gdeltRowToEventFor(gdelt(12), gdeltOpts('gaza')), null, 'BM row is not gaza');
  assert.equal(gdeltRowToEventFor(gdelt(0), gdeltOpts('myanmar')), null, 'TW row is not myanmar');
  const fr = gdeltRowToEventFor(gdelt(14), gdeltOpts('france'));
  assert.equal(fr.actor, 'Student unions');
  assert.equal(fr.locationStr, 'Paris, France');
  assert.equal(gdeltRowToEventFor(gdelt(14), gdeltOpts('gaza')), null, 'FR row is not gaza');
  assert.equal(gdeltRowToEventFor(gdelt(0), gdeltOpts('france')), null, 'TW row is not france');
  assert.throws(() => gdeltRowToEventFor(['a', 'b'], gdeltOpts('gaza')), /cols/);
  assert.equal(gdeltRowToEventFor(gdelt(0), {}), null, 'no selector matches nothing');
}

// --- Actor maps ---
{
  assert.equal(gdeltActorLabelFor('TAIPEI', cfg('taiwan').actorMap), 'Taiwan');
  assert.equal(gdeltActorLabelFor('HAMAS', cfg('gaza').actorMap), 'Palestinians');
  assert.equal(gdeltActorLabelFor('IRGC', cfg('iran').actorMap), 'Iran');
  assert.equal(gdeltActorLabelFor('JNIM', cfg('sahel').actorMap), 'Jihadist groups');
  assert.equal(gdeltActorLabelFor('KIM JONG UN', cfg('korea').actorMap), 'North Korea');
  assert.equal(gdeltActorLabelFor('MOSCOW', cfg('arctic').actorMap), 'Russia');
  assert.equal(gdeltActorLabelFor('TRUMP', cfg('us-election').actorMap), 'Trump administration');
  assert.equal(gdeltActorLabelFor('HOUTHIS', cfg('houthis').actorMap), 'Houthis');
  assert.equal(gdeltActorLabelFor('TATMADAW', cfg('myanmar').actorMap), 'Myanmar junta');
  assert.equal(gdeltActorLabelFor('ARAKAN ARMY', cfg('myanmar').actorMap), 'Ethnic armed groups');
  assert.equal(gdeltActorLabelFor('LECORNU', cfg('france').actorMap), 'Government');
  assert.equal(gdeltActorLabelFor('LFI', cfg('france').actorMap), 'Left bloc');
  assert.equal(gdeltActorLabelFor('VLADIMIR PUTIN', cfg('sahel').actorMap), 'Vladimir Putin', 'unknown actors pass through title-cased');
  assert.equal(gdeltActorLabelFor('', cfg('gaza').actorMap), 'Unspecified');
}

// --- Relevance gate: general-news native feeds stay on-theatre ---
{
  const tt = cfg('taiwan').rssFeeds.find((f) => f.id === 'taipei-times').match;
  assert.equal(feedTitleKept('PLA drills east of Taiwan Strait draw response', tt), true);
  assert.equal(feedTitleKept('How’s your luck during Moon Festival weekend?', tt), false);
  const jp = cfg('gaza').rssFeeds.find((f) => f.id === 'jpost').match;
  assert.equal(feedTitleKept('IDF failed to defend outpost during Oct. 7', jp), true);
  assert.equal(feedTitleKept("Trump's White House press pool ban lifted by judge", jp), false);
  assert.equal(feedTitleKept('AI model discovers enzyme system, Anthropic says', jp), false);
  const kt = cfg('korea').rssFeeds.find((f) => f.id === 'korea-times').match;
  assert.equal(feedTitleKept('Missiles launched near Wonsan, JCS says', kt), true);
  assert.equal(feedTitleKept("Baseball teams end 'laundry war'", kt), false);
  const gc = cfg('houthis').rssFeeds.find((f) => f.id === 'gcaptain').match;
  assert.equal(feedTitleKept('Houthi missile targets tanker in the Red Sea', gc), true);
  assert.equal(feedTitleKept('Container rates rally on transpacific demand', gc), false);
  const bm = cfg('myanmar').rssFeeds.find((f) => f.id === 'bbc-myanmar').match;
  assert.equal(feedTitleKept('Myanmar junta airstrike kills dozens in Rakhine', bm), true);
  assert.equal(feedTitleKept('Pakistan launches deadly air strikes on Afghanistan', bm), false);
  const sa = cfg('sahel').rssFeeds.find((f) => f.id === 'rfi-africa').match;
  assert.equal(feedTitleKept('Niger signs uranium deal in Niamey', sa), true);
  assert.equal(feedTitleKept('Nigeria wins AFCON qualifier in Lagos', sa), false);
  assert.equal(feedTitleKept('Army retakes Djibo after ambush', sa), true);
  assert.equal(feedTitleKept('Djibouti hosts Red Sea shipping summit', sa), false);
  const us = cfg('us-election').rssFeeds.find((f) => f.id === 'npr-politics').match;
  assert.equal(feedTitleKept('Trump rally draws thousands in Milwaukee', us), true);
  assert.equal(feedTitleKept('Senators debate liability for rogue AI agents', us), true);
  assert.equal(feedTitleKept('Study finds toddlers need more outdoor play', us), false);
  assert.equal(feedTitleKept('Patriots win preseason opener in overtime', us), false, 'bounded RIOT skips patriot');
  assert.equal(feedTitleKept('Mike Johnson backs voluntary regulation on AI safety', us), true);
  const bbc = cfg('gaza').rssFeeds.find((f) => f.id === 'bbc-me').match;
  assert.equal(feedTitleKept('Israeli settlers attack West Bank village', bbc), true);
  assert.equal(feedTitleKept('Iran court upholds lashes sentence for singer', bbc), false);
  const aa = cfg('sahel').rssFeeds.find((f) => f.id === 'aa-niger').match;
  assert.equal(feedTitleKept('Junta strips exiled critics of nationality', aa), true);
  assert.equal(feedTitleKept('Niger hold off Lesotho in Afcon qualifier', aa), false);
  assert.equal(feedTitleKept('Mastercard for travelling, Visa for shopping', aa), false);
  assert.equal(feedTitleKept('Lone Star seek to bounce back against Mali in AFCON qualifying clash', aa), false, 'CLASH compounds skip sports');
  assert.equal(feedTitleKept('Burkina Faso launches first gold refinery', aa), true);
  assert.equal(feedTitleKept('Heavy gunshots, explosions in Niger capital', aa), true);
  const rci = cfg('arctic').rssFeeds.find((f) => f.id === 'rci-arctic').match;
  assert.equal(feedTitleKept('New Greenland military bases expand NATO footprint', rci), true);
  assert.equal(feedTitleKept('Fat Bear Week returns to Alaska', rci), false);
  const ug = cfg('us-election').rssFeeds.find((f) => f.id === 'gnews-election').match;
  assert.equal(feedTitleKept('Latest Senate Polls: Midterm Elections 2026', ug), true);
  assert.equal(feedTitleKept('Taiwan invasion unlikely before 2028, experts say', ug), false, 'GNews safety net drops query drift');
  const fr24 = cfg('france').rssFeeds.find((f) => f.id === 'france24-en').match;
  assert.equal(feedTitleKept('Students and police clash as France struggles to quell school protests', fr24), true);
  assert.equal(feedTitleKept('Argentine leader Milei on mission to beef up economy during Paris visit', fr24), false, 'bare PARIS is not protest news');
  assert.equal(feedTitleKept('Somali pirates killed oil tanker crew before rescue', cfg('sahel').rssFeeds.find((f) => f.id === 'rfi-africa').match), false, 'bounded MALI skips Somali');
  assert.equal(feedTitleKept('Anything at all', undefined), true, 'unfiltered feeds keep everything');
  assert.equal(feedTitleKept('Anything at all', []), true);
  assert.equal(feedTitleKept('IDF strikes Rafah', ['[bad']), false, 'bad pattern never matches');
}

// --- Gazetteers: hits, variants, region phrases, capital rule ---
{
  const tw = createGeocoder(cfg('taiwan').gazetteer, { outlets: cfg('taiwan').outletsToStrip });
  assert.equal(tw.geocodeText('PLA drills east of Taiwan Strait draw response').label, 'Taiwan Strait');
  assert.ok(!tw.stripForGeocode('pushback against Taipei Times reporting').includes('Taipei'), 'outlet name stripped');
  assert.equal(tw.geocodeText(tw.stripForGeocode('minister pushes back against Taipei Times reporting')), null, 'outlet names are not places');

  const gaza = createGeocoder(cfg('gaza').gazetteer, { outlets: cfg('gaza').outletsToStrip });
  assert.equal(gaza.geocodeText('blasts reported in Rafah overnight').label, 'Rafah');
  assert.equal(gaza.geocodeText('aid convoy reaches Khan Younis').label, 'Khan Younis');
  assert.equal(gaza.geocodeText('fighting across the Hebron region spreads').label, 'Hebron region');

  const iran = createGeocoder(cfg('iran').gazetteer, {});
  assert.equal(iran.geocodeText('Tehran warns of escalation'), null, 'bare capital is an actor metonym');
  assert.equal(iran.geocodeText('Explosions rock Tehran overnight').label, 'Tehran');
  assert.equal(iran.geocodeText('strikes reported on Natanz facility').label, 'Natanz');

  const sahel = createGeocoder(cfg('sahel').gazetteer, {});
  assert.equal(sahel.geocodeText('clashes near Gao continue').label, 'Gao');
  assert.equal(sahel.geocodeText('Mastercard for travelling, Visa for shopping'), null);

  const korea = createGeocoder(cfg('korea').gazetteer, {});
  assert.equal(korea.geocodeText('missiles launched near Wonsan, JCS says').label, 'Wonsan');
  assert.equal(korea.geocodeText('Seoul says Pyongyang did it'), null, 'bare capitals stay null');

  const arctic = createGeocoder(cfg('arctic').gazetteer, {});
  assert.equal(arctic.geocodeText('exercise planned near Tromsø draws notice').label, 'Tromsø');
  assert.equal(arctic.geocodeText('Transit via the Bering Strait grows').label, 'Bering Strait');

  const us = createGeocoder(cfg('us-election').gazetteer, {});
  assert.equal(us.geocodeText('rally draws thousands in Milwaukee').label, 'Milwaukee');
  assert.equal(us.geocodeText('Washington says recount unlikely'), null, 'bare Washington is an actor');

  const ho = createGeocoder(cfg('houthis').gazetteer, {});
  assert.equal(ho.geocodeText('Explosions rock Sanaa overnight').label, 'Sanaa');
  assert.equal(ho.geocodeText('Sanaa says truce unlikely'), null, 'bare Sanaa is an actor');
  assert.equal(ho.geocodeText('strikes near Hodeidah port reported').label, 'Hodeidah');
  assert.equal(ho.geocodeText('transits resume through Bab el-Mandeb').label, 'Bab el-Mandeb');

  const my = createGeocoder(cfg('myanmar').gazetteer, {});
  assert.equal(my.geocodeText('Explosions rock Mandalay overnight').label, 'Mandalay');
  assert.equal(my.geocodeText('Naypyidaw says truce unlikely'), null, 'bare Naypyidaw is an actor');
  assert.equal(my.geocodeText('clashes near Lashio reported').label, 'Lashio');
  assert.equal(my.geocodeText('fighting across Rakhine State spreads').label, 'Rakhine State');

  const frg = createGeocoder(cfg('france').gazetteer, {});
  assert.equal(frg.geocodeText('Lyon lycées blockaded as student unrest spreads').label, 'Lyon');
  assert.equal(frg.geocodeText('Explosions rock Paris overnight').label, 'Paris');
  assert.equal(frg.geocodeText('Paris says truce unlikely'), null, 'bare Paris is an actor');
}

// --- OSM validation per theatre ---
{
  const gazaCity = { lat: '31.5', lon: '34.47', class: 'place', type: 'city', address: { country_code: 'ps' }, display_name: 'Gaza, Palestine' };
  assert.equal(validateOsmResultFor(gazaCity, cfg('gaza').osm).country, 'ps');
  assert.equal(validateOsmResultFor({ ...gazaCity, lat: '31.5', lon: '38.0' }, cfg('gaza').osm), null, 'outside the theatre bbox');
  assert.equal(validateOsmResultFor({ ...gazaCity, address: { country_code: 'eg' } }, cfg('gaza').osm), null, 'unlisted country');
  assert.equal(validateOsmResultFor({ ...gazaCity, class: 'amenity', type: 'embassy' }, cfg('gaza').osm), null, 'embassies are not places');
  assert.equal(validateOsmResultFor({ lat: '31.9', lon: '35.2', class: 'boundary', type: 'country', address: { country_code: 'ps' }, display_name: 'Palestine' }, cfg('gaza').osm), null, 'country centroids rejected');
  const niamey = { lat: '13.51', lon: '2.11', class: 'place', type: 'city', address: { country_code: 'ne' }, display_name: 'Niamey, Niger' };
  assert.equal(validateOsmResultFor(niamey, cfg('sahel').osm).country, 'ne');
  assert.equal(validateOsmResultFor(niamey, cfg('gaza').osm), null, 'sahel pin rejected for gaza');
  const nuuk = { lat: '64.18', lon: '-51.72', class: 'place', type: 'town', address: { country_code: 'gl' }, display_name: 'Nuuk, Greenland' };
  assert.equal(validateOsmResultFor(nuuk, cfg('arctic').osm).country, 'gl');
  assert.equal(validateOsmResultFor({ ...nuuk, lat: '40.0', lon: '-51.72' }, cfg('arctic').osm), null, 'sub-polar pin rejected');
  const yangon = { lat: '16.84', lon: '96.17', class: 'place', type: 'city', address: { country_code: 'mm' }, display_name: 'Yangon, Myanmar' };
  assert.equal(validateOsmResultFor(yangon, cfg('myanmar').osm).country, 'mm');
  assert.equal(validateOsmResultFor(yangon, cfg('gaza').osm), null, 'myanmar pin rejected for gaza');
  const paris = { lat: '48.86', lon: '2.35', class: 'place', type: 'city', address: { country_code: 'fr' }, display_name: 'Paris, France' };
  assert.equal(validateOsmResultFor(paris, cfg('france').osm).country, 'fr');
  assert.equal(validateOsmResultFor(paris, cfg('gaza').osm), null, 'france pin rejected for gaza');
  assert.equal(validateOsmResultFor(null, cfg('iran').osm), null);
}

// --- Fixture end-to-end: --all through collect() ---
{
  const tmp = mkdtempSync(join(tmpdir(), 'wsr-theatres-'));
  const results = await collect({ all: true, inputPath: 'tests/fixtures/theatre-events.fixture.json', root: tmp, collectedAt: '2026-09-21T06:00:00.000Z' });
  assert.deepEqual(Object.keys(results).sort(), [...THEATRE_IDS].sort());
  const expected = { taiwan: 3, gaza: 5, iran: 3, sahel: 4, korea: 2, arctic: 2, 'us-election': 2, houthis: 4, myanmar: 4, france: 4 };
  for (const [id, count] of Object.entries(expected)) {
    const r = results[id];
    assert.equal(r.changed, true, `${id}: first run writes`);
    assert.equal(r.feed.theatre, id);
    assert.equal(r.feed.schemaVersion, 1);
    assert.equal(r.feed.count, count, `${id}: gdelt+rss+reliefweb partition, got ${r.feed.count}`);
    assert.ok(r.feed.sources.every((s) => s.id && s.status), `${id}: source statuses`);
    const status = JSON.parse(readFileSync(join(tmp, `${id}-events`, 'status.json'), 'utf8'));
    assert.equal(status.checkedAt, '2026-09-21T06:00:00.000Z', `${id}: status heartbeat`);
    const index = JSON.parse(readFileSync(join(tmp, `${id}-events`, 'index.json'), 'utf8'));
    const days = Object.keys(index.days);
    assert.ok(days.length >= 2, `${id}: day segments span fixture dates`);
    let total = 0;
    for (const day of days) {
      const [y, m, d] = day.split('-');
      const seg = JSON.parse(readFileSync(join(tmp, `${id}-events`, 'days', y, m, `${d}.json`), 'utf8'));
      assert.ok(seg.events.every((e) => String(e.isoDate).startsWith(day)), `${id}: day file ${day} holds only that date`);
      assert.equal(seg.count, seg.events.length);
      total += seg.events.length;
    }
    assert.equal(total, count, `${id}: day segments partition the merged set`);
    for (const e of r.feed.events) {
      assert.ok(e.id && e.isoDate && e.description && e.sourceUrl, `${id}: record carries id/date/description/source`);
      assert.ok(!('body' in e) && !('content' in e), `${id}: link-only across all kinds`);
    }
  }
  // Geocode outcomes over the merged sets.
  const find = (id, needle) => results[id].feed.events.find((e) => e.description.includes(needle));
  assert.equal(find('gaza', 'Rafah overnight').locationStr, 'Rafah');
  assert.equal(find('gaza', 'Khan Younis').locationStr, 'Khan Younis');
  assert.equal(find('gaza', 'Rafah (Fixture)').locationStr, 'Rafah', 'reliefweb report with a city gains coords');
  assert.equal(find('iran', 'Tehran warns').coordsTier, 'unplaced', 'bare-capital headline stays feed-only');
  assert.equal(find('iran', 'Natanz').locationStr, 'Natanz');
  assert.equal(find('sahel', 'clashes near Gao').locationStr, 'Gao');
  assert.equal(find('sahel', 'Niamey (Fixture)').locationStr, 'Niamey');
  assert.equal(find('sahel', 'Mastercard'), undefined, 'off-topic aa-niger item filtered out');
  assert.equal(find('korea', 'launched near Wonsan').locationStr, 'Wonsan');
  assert.equal(find('arctic', 'Tromsø').locationStr, 'Tromsø');
  assert.equal(find('us-election', 'Milwaukee').locationStr, 'Milwaukee');
  assert.equal(find('us-election', 'Washington says').coordsTier, 'unplaced');
  assert.equal(find('taiwan', 'Taiwan Strait').locationStr, 'Taiwan Strait');
  assert.equal(find('houthis', 'drone boat').locationStr, 'Hodeidah');
  assert.equal(find('houthis', 'Aden (Fixture)').locationStr, 'Red Sea');
  assert.equal(find('houthis', 'Houthis → Israel').locationStr, 'Bab el-Mandeb');
  assert.equal(find('myanmar', 'drone strike').locationStr, 'Mandalay');
  assert.equal(find('myanmar', 'Sagaing, Myanmar').locationStr, 'Sagaing, Myanmar');
  assert.equal(find('myanmar', 'Sittwe (Fixture)').locationStr, 'Rakhine State');
  assert.equal(find('france', 'Lyon lycées').locationStr, 'Lyon');
  assert.equal(find('france', 'Paris, France').locationStr, 'Paris, France');
  assert.equal(find('france', 'Lyon (Fixture)').locationStr, 'Lyon');
  assert.equal(find('france', 'Zidane'), undefined, 'off-topic france24-en item filtered out');
  assert.equal(find('taiwan', 'Taipei Times Taiwan poll').coordsTier, 'unplaced');
  assert.equal(find('gaza', 'IDF strikes Hamas targets').locationStr, 'Rafah', 'filtered-in jpost item geocodes');
  assert.equal(find('gaza', 'press pool ban'), undefined, 'off-topic jpost item filtered out');
  assert.equal(find('korea', 'laundry war'), undefined, 'off-topic korea-times item filtered out');
  assert.equal(find('gaza', 'Egypt convicts'), undefined, 'off-topic bbc-me item filtered out');
  assert.equal(find('us-election', 'toddlers'), undefined, 'off-topic npr-politics item filtered out');
  assert.equal(find('arctic', 'Fat Bear Week'), undefined, 'off-topic rci-arctic item filtered out');
  assert.equal(find('us-election', 'Taiwan invasion'), undefined, 'GNews drift item filtered out');

  const again = await collect({ all: true, inputPath: 'tests/fixtures/theatre-events.fixture.json', root: tmp, collectedAt: '2026-09-21T07:00:00.000Z' });
  for (const id of THEATRE_IDS) assert.equal(again[id].changed, false, `${id}: identical rerun writes nothing`);
}

// --- Single-theatre mode + bad input ---
{
  const tmp = mkdtempSync(join(tmpdir(), 'wsr-theatre-1-'));
  const r = await collect({ theatre: 'korea', inputPath: 'tests/fixtures/theatre-events.fixture.json', root: tmp, collectedAt: '2026-09-21T06:00:00.000Z' });
  assert.deepEqual(Object.keys(r), ['korea']);
  assert.equal(r.korea.feed.count, 2);
  await assert.rejects(() => collect({ theatre: 'atlantis', root: tmp }), /unknown theatre/);
  await assert.rejects(() => collect({ root: tmp }), /--theatre/);
}

console.log('theatre events normalizer, config, and collector tests passed');
