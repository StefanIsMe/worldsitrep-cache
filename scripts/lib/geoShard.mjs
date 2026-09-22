// Shared geographic sharding: a fixed 4x4 macro grid (45d lat x 90d lon).
// Pure (no I/O): collectors assign records to cells, the site selects cells
// by viewport. Cell ids are "latIdx-lonIdx", e.g. "2-1". Files live at
// <dataset>/shards/<cell>.json with an index.json carrying bboxes + counts.
export const LAT_BANDS = 4;
export const LON_BANDS = 4;
export const LAT_STEP = 180 / LAT_BANDS; // 45
export const LON_STEP = 360 / LON_BANDS; // 90

export const ALL_CELLS = [];
for (let la = 0; la < LAT_BANDS; la++) {
  for (let lo = 0; lo < LON_BANDS; lo++) ALL_CELLS.push(`${la}-${lo}`);
}

function validLat(lat) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90;
}

function validLng(lng) {
  return Number.isFinite(lng) && Math.abs(lng) <= 180;
}

/** Cell id for a point, or null when the coordinates are unusable. Edges are
 *  inclusive at the top end (lat 90 -> band 3, lng 180 -> band 3). */
export function cellFor(lat, lng) {
  if (!validLat(lat) || !validLng(lng)) return null;
  const la = Math.min(LAT_BANDS - 1, Math.floor((lat + 90) / LAT_STEP));
  const lo = Math.min(LON_BANDS - 1, Math.floor((lng + 180) / LON_STEP));
  return `${la}-${lo}`;
}

/** Bounding box for a cell id: [[minLat, minLng], [maxLat, maxLng]]. */
export function bboxFor(cell) {
  const m = /^([0-3])-([0-3])$/.exec(String(cell || ''));
  if (!m) throw new Error(`bad shard cell: ${cell}`);
  const la = Number(m[1]);
  const lo = Number(m[2]);
  return [[-90 + la * LAT_STEP, -180 + lo * LON_STEP], [-90 + (la + 1) * LAT_STEP, -180 + (lo + 1) * LON_STEP]];
}

/** Every cell overlapping a viewport bbox. Dateline-aware: when minLng is
 *  greater than maxLng the range wraps (e.g. Pacific views). */
export function cellsForBbox(minLat, minLng, maxLat, maxLng) {
  const lo0 = Math.max(-90, Math.min(minLat, maxLat));
  const hi0 = Math.min(90, Math.max(minLat, maxLat));
  const laFrom = Math.max(0, Math.floor((lo0 + 90) / LAT_STEP));
  const laTo = Math.min(LAT_BANDS - 1, Math.floor((Math.min(hi0, 89.999999) + 90) / LAT_STEP));
  const lonRanges = [];
  if (minLng <= maxLng) {
    lonRanges.push([Math.max(-180, minLng), Math.min(180, maxLng)]);
  } else {
    lonRanges.push([Math.max(-180, minLng), 180], [-180, Math.min(180, maxLng)]);
  }
  const out = new Set();
  for (let la = laFrom; la <= laTo; la++) {
    for (const [a, b] of lonRanges) {
      const loFrom = Math.max(0, Math.floor((a + 180) / LON_STEP));
      const loTo = Math.min(LON_BANDS - 1, Math.floor((Math.min(b, 179.999999) + 180) / LON_STEP));
      for (let lo = loFrom; lo <= loTo; lo++) out.add(`${la}-${lo}`);
    }
  }
  return [...out].sort();
}

/** Split OpenSky states (+ per-hex tracks) into cells by position.
 *  Returns a Map cell -> { states, tracks }. Unlocatable rows are dropped. */
export function shardOpenSky(states, tracksByHex = {}) {
  const out = new Map();
  const cellOfHex = new Map();
  const bucket = (cell) => {
    if (!out.has(cell)) out.set(cell, { states: [], tracks: {} });
    return out.get(cell);
  };
  for (const s of states || []) {
    const lng = s[5];
    const lat = s[6];
    const cell = cellFor(lat, lng);
    if (!cell) continue;
    bucket(cell).states.push(s);
    if (typeof s[0] === 'string') cellOfHex.set(s[0].toLowerCase(), cell);
  }
  for (const [hex, points] of Object.entries(tracksByHex || {})) {
    let cell = cellOfHex.get(String(hex).toLowerCase());
    if (!cell && Array.isArray(points) && points.length) {
      const last = points[points.length - 1];
      cell = cellFor(last?.lat, last?.lng);
    }
    if (!cell) continue;
    bucket(cell).tracks[hex] = points;
  }
  return out;
}

/** Split vessel objects ({lat, lng}) into cells. Returns Map cell -> array. */
export function shardVessels(vessels) {
  const out = new Map();
  for (const v of vessels || []) {
    const cell = cellFor(v?.lat, v?.lng);
    if (!cell) continue;
    if (!out.has(cell)) out.set(cell, []);
    out.get(cell).push(v);
  }
  return out;
}
