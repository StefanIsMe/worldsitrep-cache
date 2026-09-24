// Shared normalizers for the per-theatre live-wire feeds (taiwan, gaza, iran,
// sahel, korea, arctic, us-election). Parameterized twin of ukraineEvents.mjs:
// same envelope schema (v1), same retention/merge/geocode semantics, driven by
// per-theatre configs in theatreConfigs.mjs. Pure: no I/O, no network.
// Never invent data: link-only headlines, derived GDELT metadata, no bodies.
import {
  CAMEO_ROOT_LABELS,
  GDELT_COLS,
  GDELT_MIN_COLS,
  MAX_EVENTS,
  RETENTION_HOURS,
  UKRAINE_EVENTS_SCHEMA_VERSION,
  applyGeocodeToItem,
  extractOsmCandidates,
  extractZipSingleFile,
  gdeltExportUrl,
  gdeltGapWindows,
  gdeltTypeForRoot,
  gdeltWindowDates,
  googleNewsSources,
  mergeLiveEvents,
  reliefwebDocToEvent,
  removeGeocode,
  rssItemToEvent,
  simpleHash,
  stripTags,
} from './ukraineEvents.mjs';

export {
  CAMEO_ROOT_LABELS,
  GDELT_COLS,
  GDELT_MIN_COLS,
  MAX_EVENTS,
  RETENTION_HOURS,
  applyGeocodeToItem,
  extractOsmCandidates,
  extractZipSingleFile,
  gdeltExportUrl,
  gdeltGapWindows,
  gdeltTypeForRoot,
  gdeltWindowDates,
  googleNewsSources,
  mergeLiveEvents,
  reliefwebDocToEvent,
  removeGeocode,
  rssItemToEvent,
  simpleHash,
  stripTags,
};

// Same envelope version as ukraine-events: the site reads every theatre feed
// with one code path.
export const THEATRE_EVENTS_SCHEMA_VERSION = UKRAINE_EVENTS_SCHEMA_VERSION;

function sqlDateToIso(sqlDate) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(sqlDate || ''));
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

function dateAddedToIso(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(stamp || ''));
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

function httpUrl(value) {
  const u = String(value || '').trim();
  return /^https?:\/\/\S+$/.test(u) ? u : null;
}

function inBbox(lat, lng, bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false;
  const [minLat, minLng, maxLat, maxLng] = bbox;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < minLat || lat > maxLat) return false;
  if (minLng <= maxLng) return lng >= minLng && lng <= maxLng;
  return lng >= minLng || lng <= maxLng; // antimeridian wrap
}

/** Map a GDELT actor name via a theatre actor map. Unknown actors pass through title-cased. */
export function gdeltActorLabelFor(name, actorMap = []) {
  const raw = String(name || '').trim();
  if (!raw) return 'Unspecified';
  const upper = raw.toUpperCase();
  for (const [pattern, label] of actorMap) {
    try {
      if (new RegExp(pattern, 'i').test(upper)) return label;
    } catch { /* bad pattern never blocks a row */ }
  }
  return raw.toLowerCase().replace(/(^|\s|[-/])(\S)/g, (m, p, c) => p + c.toUpperCase());
}

/**
 * Relevance gate for general-news native feeds (home papers carry sports,
 * culture, and world news alongside theatre coverage). Returns true when
 * the feed has no `match` patterns or any pattern matches the title
 * (case-insensitive). Query-scoped Google News feeds carry no patterns.
 */
export function feedTitleKept(title, match) {
  if (!Array.isArray(match) || match.length === 0) return true;
  const t = String(title || '');
  for (const pattern of match) {
    try {
      if (new RegExp(pattern, 'i').test(t)) return true;
    } catch { /* bad pattern never blocks a row */ }
  }
  return false;
}

/**
 * Normalize one GDELT 2.1 export row (pre-split TSV fields) to a theatre event.
 * opts: { fips?: string[] (ActionGeo country match), bbox?: [minLat,minLng,maxLat,maxLng],
 *         roots?: string[] (allowed CAMEO roots), actorMap?, defaultGeo? }
 * Returns null when the row is not a located in-theatre conflict event (not an error).
 * Throws only on a malformed row shape.
 */
export function gdeltRowToEventFor(fields, opts = {}) {
  if (!Array.isArray(fields)) throw new TypeError('GDELT row must be a fields array');
  if (fields.length < GDELT_MIN_COLS) throw new TypeError(`GDELT row has ${fields.length} cols, need ${GDELT_MIN_COLS}`);
  const c = GDELT_COLS;
  const lat = Number(fields[c.ActionGeo_Lat]);
  const lng = Number(fields[c.ActionGeo_Long]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const fips = Array.isArray(opts.fips) ? opts.fips : null;
  if (fips) {
    if (!fips.includes(fields[c.ActionGeo_CountryCode])) return null;
  } else if (opts.bbox) {
    if (!inBbox(lat, lng, opts.bbox)) return null;
  } else {
    return null; // no theatre selector configured — never match the world
  }
  const quad = Number(fields[c.QuadClass]);
  const root = String(fields[c.EventRootCode] || '').padStart(2, '0');
  if (Array.isArray(opts.roots)) {
    if (!opts.roots.includes(root)) return null;
  } else if (Number.isFinite(quad)) {
    if (quad < 3) return null; // conflict only (verbal + material)
  } else if (Number(root) < 10) {
    return null;
  }
  const sourceUrl = httpUrl(fields[c.SOURCEURL]);
  if (!sourceUrl) return null;
  const gid = String(fields[c.GLOBALEVENTID] || '').trim();
  if (!gid) return null;
  const isoDate = sqlDateToIso(fields[c.SQLDATE]);
  if (!isoDate) return null;
  const actor1 = gdeltActorLabelFor(fields[c.Actor1Name], opts.actorMap);
  const actor2 = gdeltActorLabelFor(fields[c.Actor2Name], opts.actorMap);
  const rootLabel = CAMEO_ROOT_LABELS[root] || `CAMEO ${fields[c.EventCode]}`;
  const geo = String(fields[c.ActionGeo_FullName] || '').trim() || opts.defaultGeo || 'Theatre';
  const mentions = Number(fields[c.NumMentions]) || 0;
  const sources = Number(fields[c.NumSources]) || 0;
  const goldstein = Number(fields[c.GoldsteinScale]);
  const tone = Number(fields[c.AvgTone]);
  return {
    id: `gdelt-${gid}`,
    kind: 'event',
    date: isoDate.slice(0, 10),
    isoDate,
    observedAt: dateAddedToIso(fields[c.DATEADDED]),
    description: `${rootLabel} — ${actor1} → ${actor2} near ${geo}. Machine-coded by GDELT 2.1 (${mentions} mention${mentions === 1 ? '' : 's'}, ${sources} source${sources === 1 ? '' : 's'}); open the source article for details.`.slice(0, 500),
    type: gdeltTypeForRoot(root),
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    action: `${rootLabel} (GDELT ${fields[c.EventCode]})`,
    actor: actor1,
    axis: 'Other',
    tags: ['GDELT 2.1', 'machine-coded', rootLabel],
    coordsTier: 'approximate',
    coordsNote: `GDELT 2.1 ActionGeo machine geocode (type ${fields[c.ActionGeo_Type] || '?'}); verify via source article.`,
    locationStr: geo,
    source: 'GDELT 2.1',
    sourceUrl,
    gdelt: {
      globalEventId: gid,
      eventCode: String(fields[c.EventCode] || ''),
      geoType: Number(fields[c.ActionGeo_Type]) || null,
      quadClass: Number.isFinite(quad) ? quad : null,
      goldstein: Number.isFinite(goldstein) ? Math.round(goldstein * 100) / 100 : null,
      tone: Number.isFinite(tone) ? Math.round(tone * 100) / 100 : null,
      mentions, sources,
    },
  };
}

// ---------------------------------------------------------------------------
// Headline geocoding: gazetteer match first, OSM Nominatim candidates second.
// Same semantics as ukraineEvents, parameterized per theatre.
// ---------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Unicode-aware word boundary: \b is ASCII-only, so names ending in ø/í/é
// (Tromsø, Reykjavík) would never match. \p{L}\p{N}_ approximates \w.
const bound = (inner) => `(?<![\\p{L}\\p{N}_])${inner}(?![\\p{L}\\p{N}_])`;

const LOCATIVE_VERBS = 'target|targeting|targets|hit|hits|hitting|strike|strikes|striking|struck|attack|attacks|attacking|attacked|bomb|bombs|bombing|bombed|shelled|shelling|rock|rocks|rocked|rocking|shake|shakes|shaken|shaking';

function capitalHasLocative(text, names) {
  for (const n of names) {
    const e = bound(escapeRe(n));
    if (new RegExp(`\\b(in|near|at|on|over|against|around|towards?|across)\\s+(the\\s+)?${e}`, 'iu').test(text)) return true;
    if (new RegExp(`${e}\\s+(was\\s+)?(hit|struck|attacked|targeted|bombed|shelled|rocked|shaken)\\b`, 'iu').test(text)) return true;
    if (new RegExp(`\\b(${LOCATIVE_VERBS})\\s+(the\\s+)?${e}`, 'iu').test(text)) return true;
  }
  return false;
}

/**
 * Build a headline geocoder for one theatre gazetteer.
 * gazetteer: [{ names:[canonical,...variants], lat, lng, label, level, capital? }]
 * outlets: outlet names to strip before matching (e.g. "Taipei Times").
 */
export function createGeocoder(gazetteer, { outlets = [] } = {}) {
  const matchers = [];
  for (const entry of gazetteer) {
    for (const name of entry.names) {
      matchers.push({ name, entry, re: new RegExp(bound(escapeRe(name)), 'iu') });
    }
  }
  matchers.sort((a, b) => b.name.length - a.name.length); // longest name first
  const regionRes = [];
  for (const entry of gazetteer.filter((e) => e.level === 'city')) {
    for (const name of entry.names) {
      regionRes.push({ entry, re: new RegExp(bound(escapeRe(name) + '\\s+(oblast|region|province|governorate|state|county|prefecture)'), 'iu') });
    }
  }
  const outletRes = outlets.map((o) => new RegExp(bound(escapeRe(o) + "('s)?"), 'giu'));

  function stripForGeocode(text) {
    let t = String(text || '').replace(/\s*\([^()]*\)\s*/g, ' ');
    for (const re of outletRes) {
      re.lastIndex = 0;
      t = t.replace(re, ' ');
    }
    return t;
  }

  function geocodeText(text) {
    const t = String(text || '');
    if (!t) return null;
    for (const { entry, re } of regionRes) {
      if (re.test(t)) {
        return { lat: entry.lat, lng: entry.lng, name: entry.label, level: 'region', label: `${entry.label} region`, method: 'gazetteer' };
      }
    }
    for (const { name, entry, re } of matchers) {
      if (re.test(t)) {
        if (entry.capital && !capitalHasLocative(t, entry.names)) continue;
        return { lat: entry.lat, lng: entry.lng, name, level: entry.level, label: entry.label, method: 'gazetteer' };
      }
    }
    return null;
  }

  return { geocodeText, stripForGeocode };
}

/**
 * Validate one Nominatim search result (addressdetails=1) for a theatre.
 * opts: { countryCodes: ['ml','bf',...], bbox: [minLat,minLng,maxLat,maxLng] }
 * Accepts place/boundary results inside the allowlist + bbox; rejects country
 * centroids and out-of-theatre pins. Returns a normalized geo or null.
 */
export function validateOsmResultFor(result, { countryCodes = [], bbox = null } = {}) {
  if (!result || typeof result !== 'object') return null;
  const lat = Number(result.lat);
  const lng = Number(result.lon ?? result.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const country = String(result.address?.country_code || '').toLowerCase();
  if (!countryCodes.map((c) => String(c).toLowerCase()).includes(country)) return null;
  const cls = String(result.class || '').toLowerCase();
  if (cls !== 'place' && cls !== 'boundary') return null; // no embassies, shops, or roads
  if (String(result.type || '').toLowerCase() === 'country') return null;
  if (bbox && !inBbox(lat, lng, bbox)) return null;
  const display = String(result.display_name || '').split(',').slice(0, 3).join(',').trim();
  if (!display) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, display, country, method: 'osm' };
}
