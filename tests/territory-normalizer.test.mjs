// Territory normalizer tests — no network; hand-built DeepState-shaped fixture.
import assert from 'node:assert/strict';
import {
  CONDITION_FRIENDLY, CONDITION_OCCUPIED, CONDITION_UNKNOWN,
  boundaryFriendlyPolygon, circlePoly, conditionForKey, contentHashFor,
  minVertexDistanceKm, mirrorDaySnapshot, normalizeSnapshot, parseDeepstateName,
  parseSnapshotDatetime, proposalsUnknownPolygons, ringAreaKm2,
  stablePolygonId, validSnapshot,
} from '../scripts/lib/territory.mjs';

// --- name parsing ---
{
  const p = parseDeepstateName('Окуповано /// Occupied /// geoJSON.status.occupied\n');
  assert.equal(p.nameUk, 'Окуповано');
  assert.equal(p.nameEn, 'Occupied');
  assert.equal(p.key, 'geoJSON.status.occupied');
  const multi = parseDeepstateName('Окупована Абхазія.\n///\nOccupied Abkhazia.\n/// geoJSON.territories.abkhazia');
  assert.equal(multi.nameUk, 'Окупована Абхазія.');
  assert.equal(multi.key, 'geoJSON.territories.abkhazia');
  const nokey = parseDeepstateName('328-й полк /// 328th Regiment');
  assert.equal(nokey.key, '');
  assert.equal(conditionForKey('geoJSON.status.occupied'), CONDITION_OCCUPIED);
  assert.equal(conditionForKey('geoJSON.status.dismissed_at {{at:25.03}}'), CONDITION_FRIENDLY);
  assert.equal(conditionForKey('geoJSON.status.unknown'), CONDITION_UNKNOWN);
  assert.equal(conditionForKey('geoJSON.units.regiment.1-tank'), null);
  assert.equal(conditionForKey(''), null);
}

// --- snapshot datetime ("23.09 o 09:38", no year) ---
{
  const now = new Date('2026-09-24T12:00:00.000Z');
  assert.equal(parseSnapshotDatetime('23.09 o 09:38', now).date, '2026-09-23');
  assert.equal(parseSnapshotDatetime('30.12 o 23:59', now).date, '2025-12-30');
  assert.equal(parseSnapshotDatetime('garbage', now).date, null);
}

// --- area sanity: 1°x1° square at the equator ≈ 12,364 km² ---
{
  const ring = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
  const area = ringAreaKm2(ring);
  assert.ok(area > 12000 && area < 12800, `area ${area} out of range`);
  assert.equal(ringAreaKm2([[0, 0]]), 0);
}

// --- stable ids: same class+centroid => same id, movement => new id ---
{
  const a = stablePolygonId('geoJSON.status.occupied', 48.5, 37.7);
  const b = stablePolygonId('geoJSON.status.occupied', 48.501, 37.701);
  const c = stablePolygonId('geoJSON.status.occupied', 49.5, 37.7);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^ds-[0-9a-f]{10}$/);
}

// --- full normalization ---
const payload = {
  id: 1790149115,
  datetime: '23.09 o 09:38',
  map: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[37.7991966, 48.702877, 0], [37.78, 48.69, 0], [37.79, 48.68, 0], [37.7991966, 48.702877, 0]]] },
        properties: { name: 'Окуповано /// Occupied /// geoJSON.status.occupied', styleUrl: '#poly-A52714-1200-77-nodesc' },
      },
      {
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: [[[[30.1, 50.1, 0], [30.2, 50.1, 0], [30.2, 50.2, 0], [30.1, 50.1, 0]]], [[[31.1, 51.1, 0], [31.2, 51.1, 0], [31.2, 51.2, 0], [31.1, 51.1, 0]]]] },
        properties: { name: 'Звільнено /// Liberated /// geoJSON.status.dismissed', styleUrl: '#poly-0F9D58-1200-77-nodesc' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [37.5, 48.5, 0] },
        properties: { name: '1-й танковий полк ///1st tank regiment /// geoJSON.units.regiment.1-tank' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [37.6, 48.6, 0] },
        properties: { name: 'Напрямок удару /// Direction of attack /// geoJSON.status.attack_direction' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [20.5, 54.7, 0] },
        properties: { name: 'Київ /// Kyiv /// geoJSON.territories.kyiv' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[21.0, 54.0, 0], [21.5, 54.0, 0], [21.5, 54.5, 0], [21.0, 54.0, 0]]] },
        properties: { name: 'Тимчасово окупована східна Пруссія. /// East Prussia is temporarily occupied. /// geoJSON.territories.prussia', styleUrl: '#poly-A52714-1200-77-nodesc' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [28.0, 53.0, 0] },
        properties: { name: '328-й полк /// 328th Regiment' },
      },
      {
        type: 'Feature', // corrupt ring: out-of-range coord => skipped, run survives
        geometry: { type: 'Polygon', coordinates: [[[999, 48.7, 0], [37.78, 48.69, 0], [37.79, 48.68, 0], [999, 48.7, 0]]] },
        properties: { name: 'Статус невідомий /// Unknown status /// geoJSON.status.unknown' },
      },
    ],
  },
};

const snap = normalizeSnapshot(payload, { collectedAt: '2026-09-24T07:13:00.000Z' });
assert.equal(snap.schemaVersion, 1);
assert.equal(snap.theatreId, 'ukraine');
assert.equal(snap.snapshotId, 1790149115);
assert.match(snap.snapshotDate, /^\d{4}-09-23$/, 'day/month from stamp, year inferred');
assert.equal(snap.detailedPolygons.length, 3, 'occupied + 2 liberated parts');
assert.equal(snap.detailedPolygons[0].condition, CONDITION_OCCUPIED);
assert.equal(snap.detailedPolygons[0].nameEn, 'Occupied');
assert.deepEqual(snap.detailedPolygons[0].poly[0], [48.70288, 37.7992], 'coords flipped to [lat,lng], rounded 5dp');
assert.equal(snap.detailedPolygons[1].condition, CONDITION_FRIENDLY);
assert.match(snap.detailedPolygons[1].id, /-p0$/);
assert.match(snap.detailedPolygons[2].id, /-p1$/);
assert.equal(snap.extraFeatures.length, 1, 'prussia polygon kept as extra; kyiv point not');
assert.equal(snap.extraFeatures[0].geom.type, 'Polygon');
assert.deepEqual(snap.extraFeatures[0].geom.coordinates[0][0], [21, 54]);
assert.equal(snap.census.units, 2, 'keyed unit + nokey point');
assert.equal(snap.census.attackDirections, 1);
assert.equal(snap.census.territoryExtras, 1);
assert.equal(snap.census.skippedRings, 1);
assert.ok(validSnapshot(snap));

// --- mirror backfill days ---
{
  const day = mirrorDaySnapshot('2024-07-08', [
    [[[35.2, 45.5, 0], [35.3, 45.4, 0], [35.3, 45.5, 0], [35.2, 45.5, 0]]],
    [[[37.0, 48.0, 0], [37.1, 48.0, 0], [37.1, 48.1, 0], [37.0, 48.0, 0]]],
  ], { collectedAt: '2026-09-24T08:00:00.000Z', backfill: true });
  assert.equal(day.snapshotId, 20240708);
  assert.equal(day.snapshotDate, '2024-07-08');
  assert.equal(day.partial, true);
  assert.equal(day.upstreamUrl, 'https://deepstatemap.live/en');
  assert.equal(day.detailedPolygons.length, 2);
  assert.ok(day.detailedPolygons.every((d) => d.condition === CONDITION_OCCUPIED && d.backfill === true));
  const fresh = mirrorDaySnapshot('2026-09-24', [
    [[[35.2, 45.5, 0], [35.3, 45.4, 0], [35.3, 45.5, 0], [35.2, 45.5, 0]]],
  ], { collectedAt: '2026-09-24T08:00:00.000Z' });
  assert.ok(fresh.detailedPolygons.every((d) => d.backfill === undefined), 'live mirror days are not backfill-flagged');
  assert.deepEqual(day.detailedPolygons[0].poly[0], [45.5, 35.2]);
  assert.match(day.detailedPolygons[0].id, /^ds-[0-9a-f]{10}-p0$/);
  assert.ok(validSnapshot(day), 'backfill days validate like live snapshots');
  assert.throws(() => mirrorDaySnapshot('not-a-date', []), /territory snapshot invalid/);
  assert.throws(() => mirrorDaySnapshot('2024-07-08', []), /territory snapshot invalid/);
}

// --- day index (tmpdir, no network) ---
{
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { buildDayIndex, listSnapshotDays } = await import('../scripts/lib/territoryIndex.mjs');
  const root = mkdtempSync(join(tmpdir(), 'wsr-terr-idx-'));
  assert.deepEqual(await listSnapshotDays(join(root, 'days')), []);
  mkdirSync(join(root, 'days', '2024', '07'), { recursive: true });
  mkdirSync(join(root, 'days', '2026', '09'), { recursive: true });
  writeFileSync(join(root, 'days', '2024', '07', '08.json'), '{}');
  writeFileSync(join(root, 'days', '2026', '09', '23.json'), '{}');
  writeFileSync(join(root, 'days', '2026', '09', 'notes.txt'), 'ignored');
  const idx = await buildDayIndex(join(root, 'days'), { updatedAt: '2026-09-24T08:00:00.000Z' });
  assert.deepEqual(idx.days, ['2024-07-08', '2026-09-23']);
  assert.equal(idx.coverage.count, 2);
}

// --- derived friendly underlay (open boundary) ---
{
  const fc = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[30.123456, 50.654321], [31.111111, 50.111111], [30.111111, 50.111111], [30.123456, 50.654321]]] },
      properties: {},
    }],
  };
  const friendly = boundaryFriendlyPolygon(fc, { pinnedAt: '2026-09-24T07:30:00.000Z' });
  assert.equal(friendly.id, 'ds-boundary-ukraine');
  assert.equal(friendly.condition, CONDITION_FRIENDLY);
  assert.equal(friendly.src, 'boundary-derived');
  assert.equal(friendly.asOf, '2026-09-24');
  assert.deepEqual(friendly.poly[0], [50.6543, 30.1235], 'flipped to [lat,lng], rounded 4dp');
  assert.ok(friendly.areaKm2 > 0 && friendly.areaApproximate === true);
  assert.equal(boundaryFriendlyPolygon(null), null);
  assert.equal(boundaryFriendlyPolygon({ features: [] }), null);
  assert.equal(boundaryFriendlyPolygon({ features: [{ geometry: { type: 'Point', coordinates: [1, 2] } }] }), null);
}

// --- circle rings + news-derived unknown ---
{
  const ring = circlePoly(48.5, 37.7, 25);
  assert.equal(ring.length, 17, '16 segments, closed');
  assert.deepEqual(ring[0], ring[16]);
  assert.ok(ring.every((p) => Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180));
  assert.equal(circlePoly(48.5, 37.7, 0), null);
  assert.equal(circlePoly(999, 37.7, 25), null);

  const doc = {
    collectedAt: '2026-09-24T06:00:00.000Z',
    proposals: [
      { zoneId: 'occ-donetsk', region: 'Donetsk Oblast', eventCount: 9, combatCount: 5, centroid: { lat: 48.1, lng: 37.9 }, radiusKm: 30, newestIsoDate: '2026-09-23T10:00:00.000Z' },
      { zoneId: 'lib-kyiv', region: 'Kyiv Oblast', eventCount: 40, combatCount: 1, centroid: { lat: 50.6, lng: 30.2 }, radiusKm: 20, newestIsoDate: '2026-09-23T11:00:00.000Z' },
      { zoneId: 'bad', combatCount: 9 }, // no centroid => skipped, run survives
      null,
    ],
  };
  const { polygons: unknown, gated } = proposalsUnknownPolygons(doc);
  assert.equal(unknown.length, 1, 'combat threshold + valid centroid gate the class');
  assert.equal(gated, 0, 'no contact gate without nearRings');
  assert.equal(unknown[0].id, 'news-occ-donetsk');
  assert.equal(unknown[0].condition, CONDITION_UNKNOWN);
  assert.equal(unknown[0].src, 'news-derived');
  assert.equal(unknown[0].asOf, '2026-09-23');
  assert.equal(unknown[0].combat, 5);
  assert.match(unknown[0].nameEn, /unverified/);
  assert.ok(validSnapshot({ theatreId: 'ukraine', snapshotId: 1, detailedPolygons: unknown }));
  assert.deepEqual(proposalsUnknownPolygons(null), { polygons: [], gated: 0 });
  assert.equal(proposalsUnknownPolygons({}, { minCombat: 99 }).polygons.length, 0);

  // Contact-proximity gate: rear-area reporting is counted, not drawn.
  const frontRing = [[48.0, 37.5], [48.1, 37.6], [48.0, 37.7], [48.0, 37.5]];
  assert.ok(minVertexDistanceKm(48.05, 37.55, [frontRing]) < 10);
  assert.ok(minVertexDistanceKm(50.4, 30.5, [frontRing]) > 120);
  assert.equal(minVertexDistanceKm(48.05, 37.55, []), Infinity);
  const nearOnly = proposalsUnknownPolygons(doc, { nearRings: [frontRing] });
  assert.equal(nearOnly.polygons.length, 1, 'Donetsk centroid sits near the mock front');
  const farDoc = {
    proposals: [{ zoneId: 'lib-kyiv', region: 'Kyiv Oblast', eventCount: 40, combatCount: 9, centroid: { lat: 50.4, lng: 30.5 }, radiusKm: 25, newestIsoDate: '2026-09-23T11:00:00.000Z' }],
  };
  const far = proposalsUnknownPolygons(farDoc, { nearRings: [frontRing] });
  assert.equal(far.polygons.length, 0, 'Kyiv combat reporting is not a control contest');
  assert.equal(far.gated, 1);
}

// --- content hash: stable per geometry, moves on any polygon change ---
{
  const a = [{ id: 'x', condition: CONDITION_OCCUPIED, poly: [[1, 1], [2, 2], [3, 3], [1, 1]] }];
  const b = [{ id: 'x', condition: CONDITION_OCCUPIED, poly: [[1, 1], [2, 2], [3, 3], [1, 1]] }];
  const c = [{ id: 'x', condition: CONDITION_OCCUPIED, poly: [[1, 1], [2, 2], [3, 3.1], [1, 1]] }];
  assert.equal(contentHashFor(a), contentHashFor(b));
  assert.notEqual(contentHashFor(a), contentHashFor(c));
  assert.match(contentHashFor(a), /^[0-9a-f]{12}$/);
}

// --- fail-closed envelopes ---
for (const bad of [null, {}, { id: 'x', map: { features: [] } }, { id: 1, map: { features: [] } }, { id: 1, map: {} }]) {
  assert.throws(() => normalizeSnapshot(bad), /territory snapshot invalid/);
}
assert.equal(validSnapshot(null), false);
assert.equal(validSnapshot({ ...snap, theatreId: 'taiwan' }), false);
assert.equal(validSnapshot({ ...snap, detailedPolygons: [] }), false);

console.log('territory normalizer tests passed');
