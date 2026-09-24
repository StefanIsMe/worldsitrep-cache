// Zone-proposal builder tests — no network; hand-built wire fixture.
import assert from 'node:assert/strict';
import { nearestZone, ZONE_CENTERS } from '../scripts/lib/ukraineOblasts.mjs';
import { buildProposals, insideTheatre, isCountryLevelGdelt, placedWithinWindow } from '../scripts/build-zone-proposals.mjs';

// Zone centers mirror the site's zones.json ids (minus the country rollup).
assert.deepEqual(
  ZONE_CENTERS.map((z) => z.zoneId).sort(),
  ['lib-chernihiv', 'lib-kyiv', 'lib-snake', 'lib-sumy', 'occ-crimea', 'occ-donetsk', 'occ-kharkiv', 'occ-kherson', 'occ-luhansk', 'occ-zaporizhzhia'].sort(),
);
assert.equal(nearestZone(47.9, 37.6).zoneId, 'occ-donetsk');
assert.equal(nearestZone(50.4, 30.5).zoneId, 'lib-kyiv');
assert.equal(nearestZone(45.3, 34.5).zoneId, 'occ-crimea');

const NOW = '2026-09-24T07:00:00.000Z';
const day = (n) => new Date(Date.parse(NOW) - n * 86400000).toISOString();
const events = [
  { id: 'd1', isoDate: day(1), lat: 47.9, lng: 37.6, coordsTier: 'approximate', type: 'combat', sourceUrl: 'https://example.com/d1' },
  { id: 'd2', isoDate: day(2), lat: 47.7, lng: 37.4, coordsTier: 'verified', type: 'strike', sourceUrl: 'https://example.com/d2' },
  { id: 'd3', isoDate: day(3), lat: 48.0, lng: 37.8, coordsTier: 'approximate', type: 'combat', sourceUrl: 'https://example.com/d3' },
  { id: 'd4', isoDate: day(1), lat: 47.85, lng: 37.55, coordsTier: 'approximate', type: 'occupied' }, // no sourceUrl -> counted, not sampled
  { id: 'k1', isoDate: day(1), lat: 50.5, lng: 30.3, coordsTier: 'approximate', type: 'strike', sourceUrl: 'https://example.com/k1' },
  { id: 'old', isoDate: day(30), lat: 47.9, lng: 37.6, coordsTier: 'approximate', type: 'combat', sourceUrl: 'https://example.com/old' },
  { id: 'unplaced', isoDate: day(1), coordsTier: 'unplaced', type: 'other', sourceUrl: 'https://example.com/u' },
  { id: 'nonull', isoDate: day(1), lat: null, lng: null, type: 'other' },
];

assert.equal(placedWithinWindow(events, Date.parse(NOW) - 7 * 86400000).length, 5);
const out = buildProposals(events, { collectedAt: NOW });
assert.equal(out.theatreId, 'ukraine');
assert.equal(out.windowDays, 7);
assert.equal(out.proposals.length, 1, 'only Donetsk meets the 3-event threshold');
const donetsk = out.proposals[0];
assert.equal(donetsk.zoneId, 'occ-donetsk');
assert.equal(donetsk.eventCount, 4);
assert.deepEqual(donetsk.kinds, { combat: 2, strike: 1, occupied: 1 });
assert.equal(donetsk.samples.length, 3);
assert.ok(donetsk.samples.every((s) => s.sourceUrl));
assert.equal(donetsk.combatCount, 3, 'combat + strike feed the territory unknown gate');
assert.deepEqual(donetsk.tierCounts, { approximate: 3, verified: 1 });
assert.equal(donetsk.newestIsoDate, day(1));
assert.ok(Math.abs(donetsk.centroid.lat - 47.8625) < 0.001, `centroid lat ${donetsk.centroid.lat}`);
assert.ok(Math.abs(donetsk.centroid.lng - 37.5875) < 0.001, `centroid lng ${donetsk.centroid.lng}`);
assert.ok(donetsk.radiusKm >= 15 && donetsk.radiusKm <= 80, `radius ${donetsk.radiusKm} clamped`);
assert.equal(donetsk.members, undefined, 'member coords stay internal');

const empty = buildProposals([], { collectedAt: NOW });
assert.deepEqual(empty.proposals, []);

// Country-level GDELT rows (country centroid pins) never cluster.
assert.equal(isCountryLevelGdelt({ source: 'GDELT 2.1', gdelt: { geoType: 1 } }), true);
assert.equal(isCountryLevelGdelt({ source: 'GDELT 2.1', gdelt: { geoType: 4 } }), false);
assert.equal(isCountryLevelGdelt({ source: 'GDELT 2.1', coordsNote: 'GDELT 2.1 ActionGeo machine geocode (type 1); verify.' }), true);
assert.equal(isCountryLevelGdelt({ source: 'GDELT 2.1', coordsNote: 'GDELT 2.1 ActionGeo machine geocode (type 4); verify.' }), false);
assert.equal(isCountryLevelGdelt({ source: 'Kyiv Independent', lat: 49, lng: 32 }), false);
const coarseFlood = [
  { id: 'c1', isoDate: day(1), lat: 49, lng: 32, coordsTier: 'approximate', type: 'combat', source: 'GDELT 2.1', gdelt: { geoType: 1 }, sourceUrl: 'https://example.com/c1' },
  { id: 'c2', isoDate: day(1), lat: 49, lng: 32, coordsTier: 'approximate', type: 'combat', source: 'GDELT 2.1', gdelt: { geoType: 1 }, sourceUrl: 'https://example.com/c2' },
  { id: 'c3', isoDate: day(1), lat: 49, lng: 32, coordsTier: 'approximate', type: 'combat', source: 'GDELT 2.1', gdelt: { geoType: 1 }, sourceUrl: 'https://example.com/c3' },
];
const coarseOut = buildProposals(coarseFlood, { collectedAt: NOW });
assert.equal(coarseOut.coarseGdeltDropped, 3);
assert.deepEqual(coarseOut.proposals, [], 'centroid-stacked rows cannot seed a zone');

// Out-of-theatre pins ("Moscow says …" datelines) never cluster.
assert.equal(insideTheatre(55.75, 37.61), false);
assert.equal(insideTheatre(48.5, 37.7), true);
assert.equal(insideTheatre(51.7, 35.2), true, 'cross-border incursion belt stays in');
const moscowFlood = [0, 1, 2].map((i) => ({
  id: `m${i}`, isoDate: day(1), lat: 55.75, lng: 37.61, coordsTier: 'approximate',
  type: 'combat', source: 'Example Wire', sourceUrl: `https://example.com/m${i}`,
}));
const moscowOut = buildProposals(moscowFlood, { collectedAt: NOW });
assert.equal(moscowOut.outsideTheatreDropped, 3);
assert.deepEqual(moscowOut.proposals, [], 'Moscow datelines cannot seed a Sumy zone');

console.log('zone proposals tests passed');
