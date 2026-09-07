// Pure normalizers for worlds itrep-cache. No I/O, no network. Never invent data.

export const MARKETS_SCHEMA_VERSION = 1;
export const HAZARDS_SCHEMA_VERSION = 1;

/** Parse a 0..1 price into a 0..100 probability with one decimal. */
export function toProbability(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1) * 1000) / 10;
}

/** Normalize one Polymarket Gamma event envelope for a theatre. */
export function normalizeGammaEvent(input, theatre) {
  const ev = Array.isArray(input) ? input[0] : input?.events?.[0] || input;
  if (!ev || typeof ev !== "object") throw new TypeError("Gamma response must contain an event object");
  const slug = ev.slug;
  if (!slug) throw new TypeError("Gamma event must have a slug");
  const m = ev.markets?.[0] || ev;
  let price = m.lastTradePrice ?? 0;
  try {
    const op = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;
    if (Array.isArray(op) && op.length > 0) price = parseFloat(op[0]);
  } catch { /* keep lastTradePrice */ }
  const volumeNum = Number(m.volume) || 0;
  return {
    id: String(slug),
    theatre,
    title: String(ev.title || m.question || slug),
    url: "https://polymarket.com/event/" + String(slug),
    volume: volumeNum ? "$" + volumeNum.toLocaleString("en-US") : undefined,
    volumeNum,
    endDate: m.endDate || ev.endDate,
    probability: toProbability(price),
    closed: Boolean(ev.closed || m.closed),
  };
}

/** Drop closed markets, lead with the most liquid live ones. Never empty when input had any. */
export function selectLiveMarkets(markets) {
  const live = markets.filter((m) => !m.closed).sort((a, b) => b.volumeNum - a.volumeNum);
  const kept = live.length > 0 ? live : markets;
  return kept.map(({ closed, volumeNum, ...rest }) => rest);
}

/** Normalize one USGS GeoJSON feature. Throws on missing geometry. */
export function normalizeUsgsFeature(feature) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
    throw new TypeError("USGS feature must have numeric Point coordinates");
  }
  const p = feature.properties || {};
  return {
    id: String(feature.id || p.code || p.ids || "unknown"),
    title: String(p.title || p.place || "earthquake"),
    place: p.place != null ? String(p.place) : null,
    magnitude: p.mag != null && Number.isFinite(Number(p.mag)) ? Number(p.mag) : null,
    time: p.time != null ? new Date(Number(p.time)).toISOString() : null,
    lat: Number(coords[1]),
    lng: Number(coords[0]),
    depthKm: Number.isFinite(Number(coords[2])) ? Number(coords[2]) : null,
    url: p.url != null ? String(p.url) : null,
    tsunami: p.tsunami === 1,
  };
}
