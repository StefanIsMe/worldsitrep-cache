import assert from 'node:assert/strict';
import {
  ALL_CELLS, LAT_BANDS, LON_BANDS, bboxFor, cellFor, cellsForBbox,
  shardOpenSky, shardVessels,
} from '../scripts/lib/geoShard.mjs';

assert.equal(LAT_BANDS, 4);
assert.equal(LON_BANDS, 4);
assert.equal(ALL_CELLS.length, 16);
assert.deepEqual(ALL_CELLS.slice(0, 4), ['0-0', '0-1', '0-2', '0-3']);

// --- cellFor: assignment + edges + invalid ---
assert.equal(cellFor(50.45, 30.52), '3-2', 'Kyiv');
assert.equal(cellFor(0, 0), '2-2', 'null island');
assert.equal(cellFor(-89.9, -179.9), '0-0');
assert.equal(cellFor(90, 180), '3-3', 'top edges inclusive');
assert.equal(cellFor(-90, -180), '0-0');
assert.equal(cellFor(48.85, 2.35), '3-2', 'Paris shares the Europe cell');
assert.equal(cellFor(40.7, -74), '2-1', 'New York');
assert.equal(cellFor(-33.8, 151.2), '1-3', 'Sydney');
assert.equal(cellFor(NaN, 0), null);
assert.equal(cellFor(0, NaN), null);
assert.equal(cellFor(91, 0), null);
assert.equal(cellFor(0, 181), null);
assert.equal(cellFor('50', '30'), null, 'strings are not coordinates');

// --- bboxFor round-trip ---
assert.deepEqual(bboxFor('2-1'), [[0, -90], [45, 0]]);
assert.deepEqual(bboxFor('0-0'), [[-90, -180], [-45, -90]]);
assert.throws(() => bboxFor('4-0'), /bad shard cell/);
assert.throws(() => bboxFor('x'), /bad shard cell/);
for (const cell of ALL_CELLS) {
  const [[a, b], [c, d]] = bboxFor(cell);
  assert.equal(cellFor((a + c) / 2, (b + d) / 2), cell, `center of ${cell} maps back`);
}

// --- cellsForBbox: viewport selection + dateline wrap ---
assert.deepEqual(cellsForBbox(44, 22, 52, 40), ['2-2', '3-2'], 'Ukraine viewport straddles the 45N parallel');
assert.deepEqual(cellsForBbox(-10, -100, 10, 100), ['1-0', '1-1', '1-2', '1-3', '2-0', '2-1', '2-2', '2-3'], 'equatorial band');
assert.deepEqual(cellsForBbox(30, 170, 40, -170), ['2-0', '2-3'], 'dateline wrap covers both sides');
assert.deepEqual(cellsForBbox(-90, -180, 90, 180), ALL_CELLS, 'whole planet selects everything');

// --- shardOpenSky: states + tracks follow the hex ---
{
  const states = [
    ['abc123', 'X', 'c', 1, 2, 30.5, 50.4], // Kyiv -> 3-2
    ['def456', 'Y', 'c', 1, 2, -74, 40.7], // NYC -> 2-1
    ['bad999', 'Z', 'c', 1, 2, 999, 999], // invalid -> dropped
  ];
  const tracks = {
    abc123: [{ lat: 50.4, lng: 30.5, observedAt: '2026-09-22T00:00:00.000Z' }],
    ghost: [{ lat: -33.8, lng: 151.2, observedAt: '2026-09-22T00:00:00.000Z' }], // no state: follows last point -> 1-3
    nowhere: [{ lat: NaN, lng: 0, observedAt: '2026-09-22T00:00:00.000Z' }], // dropped
  };
  const m = shardOpenSky(states, tracks);
  assert.equal(m.get('3-2').states.length, 1);
  assert.ok(m.get('3-2').tracks.abc123, 'track follows its hex');
  assert.equal(m.get('2-1').states.length, 1);
  assert.ok(m.get('1-3').tracks.ghost, 'stateless track follows its last point');
  assert.equal([...m.values()].reduce((n, s) => n + s.states.length, 0), 2);
}

// --- shardVessels ---
{
  const vessels = [
    { mmsi: '1', lat: 59.9, lng: 28.5 }, // Baltic -> 3-2
    { mmsi: '2', lat: 59.9, lng: 28.5 },
    { mmsi: '3', lat: null, lng: 0 }, // dropped
  ];
  const m = shardVessels(vessels);
  assert.equal(m.get('3-2').length, 2);
  assert.equal(m.size, 1);
}

console.log('geo shard tests passed');
