// Pure normalizers for the Ukraine live-wire feed. No I/O, no network.
// Never invent data: link-only headlines, derived GDELT metadata, no bodies.
import { inflateRawSync } from 'node:zlib';

export const UKRAINE_EVENTS_SCHEMA_VERSION = 1;

// Rolling retention per record kind (hours).
export const RETENTION_HOURS = { event: 72, news: 72, assessment: 24 * 14, report: 24 * 14 };
export const MAX_EVENTS = 1500;

// GDELT 2.1 export.CSV column indexes (tab-separated, verified 2026-09-21).
export const GDELT_COLS = {
  GLOBALEVENTID: 0, SQLDATE: 1, Actor1Name: 6, Actor2Name: 16,
  EventCode: 26, EventRootCode: 28, QuadClass: 29, GoldsteinScale: 30,
  NumMentions: 31, NumSources: 32, AvgTone: 34,
  ActionGeo_Type: 51, ActionGeo_FullName: 52, ActionGeo_CountryCode: 53,
  ActionGeo_Lat: 56, ActionGeo_Long: 57, ActionGeo_FeatureID: 58,
  DATEADDED: 59, SOURCEURL: 60,
};
export const GDELT_MIN_COLS = 61;
export const UKRAINE_FIPS = 'UP';

// CAMEO top-level event roots (standard short labels, factual).
export const CAMEO_ROOT_LABELS = {
  '01': 'Public statement', '02': 'Appeal', '03': 'Intent to cooperate',
  '04': 'Consultation', '05': 'Diplomatic cooperation', '06': 'Material cooperation',
  '07': 'Aid provision', '08': 'Yield', '09': 'Investigation', '10': 'Demand',
  '11': 'Disapproval', '12': 'Rejection', '13': 'Threat', '14': 'Protest',
  '15': 'Force posture', '16': 'Reduced relations', '17': 'Coercion',
  '18': 'Assault', '19': 'Fight', '20': 'Unconventional mass violence',
};

/** Map a CAMEO root code to a site event type. Kinetic roots only diverge. */
export function gdeltTypeForRoot(root) {
  if (root === '19') return 'combat';
  if (root === '18' || root === '20') return 'strike';
  return 'other';
}

/** Map a GDELT actor name to a site actor label. Unknown actors pass through title-cased. */
export function gdeltActorLabel(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Unspecified';
  const upper = raw.toUpperCase();
  if (/(^|\s)RUSS(IA|IAN)?(\s|$)/.test(upper) || upper === 'RUS') return 'Russian forces';
  if (upper.includes('UKR') || upper === 'KYIV' || upper === 'KIEV') return 'Ukraine';
  return raw.toLowerCase().replace(/(^|\s|[-/])(\S)/g, (m, p, c) => p + c.toUpperCase());
}

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

/**
 * Normalize one GDELT 2.1 export row (pre-split TSV fields) to a Ukraine event.
 * Returns null when the row is not a located Ukraine conflict event (not an error).
 * Throws only on a malformed row shape (caller treats as a bad line, keeps going).
 */
export function gdeltRowToEvent(fields) {
  if (!Array.isArray(fields)) throw new TypeError('GDELT row must be a fields array');
  if (fields.length < GDELT_MIN_COLS) throw new TypeError(`GDELT row has ${fields.length} cols, need ${GDELT_MIN_COLS}`);
  const c = GDELT_COLS;
  if (fields[c.ActionGeo_CountryCode] !== UKRAINE_FIPS) return null;
  const quad = Number(fields[c.QuadClass]);
  const root = String(fields[c.EventRootCode] || '').padStart(2, '0');
  // Conflict only (verbal + material). QuadClass is authoritative; root is fallback.
  if (Number.isFinite(quad)) {
    if (quad < 3) return null;
  } else if (Number(root) < 10) {
    return null;
  }
  const lat = Number(fields[c.ActionGeo_Lat]);
  const lng = Number(fields[c.ActionGeo_Long]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lonSafe(lng)) > 180) return null;
  const sourceUrl = httpUrl(fields[c.SOURCEURL]);
  if (!sourceUrl) return null;
  const gid = String(fields[c.GLOBALEVENTID] || '').trim();
  if (!gid) return null;
  const isoDate = sqlDateToIso(fields[c.SQLDATE]);
  if (!isoDate) return null;
  const actor1 = gdeltActorLabel(fields[c.Actor1Name]);
  const actor2 = gdeltActorLabel(fields[c.Actor2Name]);
  const rootLabel = CAMEO_ROOT_LABELS[root] || `CAMEO ${fields[c.EventCode]}`;
  const geo = String(fields[c.ActionGeo_FullName] || '').trim() || 'Ukraine';
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
    lng: Math.round(lonSafe(lng) * 1e5) / 1e5,
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
      quadClass: Number.isFinite(quad) ? quad : null,
      goldstein: Number.isFinite(goldstein) ? Math.round(goldstein * 100) / 100 : null,
      tone: Number.isFinite(tone) ? Math.round(tone * 100) / 100 : null,
      mentions, sources,
    },
  };
}

function lonSafe(v) { return v; }

/** Normalize one parsed RSS item (see collect-news parseRssItems) to an unplaced news event. */
export function rssItemToEvent(item, collectedAt) {
  const url = httpUrl(item?.url);
  const title = String(item?.title || '').trim();
  if (!url || !title) return null;
  const t = item?.publishedAt ? Date.parse(item.publishedAt) : NaN;
  if (!Number.isFinite(t)) return null; // dateless items cannot sort honestly — drop
  const isoDate = new Date(t).toISOString();
  const publisher = String(item?.publisher || 'News').trim() || 'News';
  return {
    id: `news-${simpleHash(url)}`,
    kind: 'news',
    date: isoDate.slice(0, 10),
    isoDate,
    description: `${title} (${publisher}, ${isoDate.slice(0, 10)}. Headline + link only.)`.slice(0, 500),
    type: 'other',
    action: 'News report',
    actor: publisher,
    axis: 'Other',
    tags: [publisher, 'headline'],
    coordsTier: 'unplaced',
    locationStr: publisher,
    source: publisher,
    sourceUrl: url,
  };
}

/** Map Google News RSS <source> outlet names by item link (Google News only). */
export function googleNewsSources(xml) {
  const out = new Map();
  const blocks = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const link = /<link>([\s\S]*?)<\/link>/i.exec(b)?.[1]?.trim();
    const src = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(b)?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    if (link && src) out.set(link, src);
  }
  return out;
}

/** Normalize one ISW WordPress post (wp/v2/posts _fields) or search hit to an assessment event. */
export function iswPostToEvent(post) {
  const url = httpUrl(post?.link || post?.url);
  const title = stripTags(post?.title?.rendered ?? post?.title ?? '');
  if (!url || !title) return null;
  let isoDate = null;
  let dateNote;
  const raw = post?.date ? Date.parse(String(post.date).replace(/([+-]\d{2}):?(\d{2})$/, '$1$2')) : NaN;
  if (Number.isFinite(raw)) {
    isoDate = new Date(raw).toISOString();
  } else {
    // Fallback: the assessment date is part of ISW's own title ("... September 20, 2026").
    const m = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i.exec(title);
    if (m) {
      const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
      const iso = `${m[3]}-${months[m[1].toLowerCase()]}-${String(m[2]).padStart(2, '0')}T00:00:00.000Z`;
      if (Number.isFinite(Date.parse(iso))) {
        isoDate = iso;
        dateNote = 'date parsed from assessment title';
      }
    }
  }
  if (!isoDate) return null;
  return {
    id: `isw-${post?.id ?? simpleHash(url)}`,
    kind: 'assessment',
    date: isoDate.slice(0, 10),
    isoDate,
    ...(dateNote ? { dateNote } : {}),
    description: `${title} (ISW assessment, link + date only — read the full analysis at source.)`.slice(0, 500),
    type: 'other',
    action: 'Strategic assessment',
    actor: 'ISW',
    axis: 'Other',
    tags: ['ISW', 'assessment'],
    coordsTier: 'unplaced',
    locationStr: 'ISW',
    source: 'Institute for the Study of War',
    sourceUrl: url,
  };
}

/** Normalize one ReliefWeb API v2 document (report or disaster) to an unplaced report event. */
export function reliefwebDocToEvent(doc, kind = 'report') {
  const f = doc?.fields || {};
  const alias = String(f.url_alias || '').trim();
  const title = String(f.title || '').trim();
  if (!alias.startsWith('/') || !title) return null;
  const created = f.date?.created ? Date.parse(f.date.created) : NaN;
  if (!Number.isFinite(created)) return null;
  const isoDate = new Date(created).toISOString();
  const orgs = Array.isArray(f.source) ? f.source.map((s) => s?.name).filter(Boolean) : [];
  const org = orgs[0] || 'ReliefWeb';
  return {
    id: `rw-${doc?.id ?? simpleHash(alias)}`,
    kind: 'report',
    date: isoDate.slice(0, 10),
    isoDate,
    description: `${title} (${org}, ${isoDate.slice(0, 10)}. Title + link only.)`.slice(0, 500),
    type: 'other',
    action: kind === 'disaster' ? 'Disaster record' : 'Humanitarian report',
    actor: org,
    axis: 'Other',
    tags: ['ReliefWeb', org],
    coordsTier: 'unplaced',
    locationStr: org,
    source: org,
    sourceUrl: `https://reliefweb.int${alias}`,
  };
}

/**
 * Reduce a DeepState /api/history/last payload to a status signal.
 * Geometry is NEVER stored — snapshot id + feature counts + a link back only.
 */
export function deepstateStatusToMeta(json, fetchedAt) {
  const id = json?.id;
  const features = json?.map?.features;
  if (!Number.isFinite(Number(id)) || !Array.isArray(features)) {
    throw new TypeError('DeepState payload must have a numeric id and map.features array');
  }
  return {
    snapshotId: String(id),
    featureCount: features.length,
    fetchedAt,
    url: 'https://deepstatemap.live/en',
    note: 'Status signal only: no DeepState geometry is stored or republished. Territory updates remain manual exports with attribution.',
  };
}

/**
 * Extract the first file from a ZIP buffer (stored or deflated, no data descriptor,
 * no encryption — the shape GDELT publishes). Throws on anything else.
 */
export function extractZipSingleFile(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip local file header');
  const method = buf.readUInt16LE(8);
  const bitFlag = buf.readUInt16LE(6);
  if (method !== 0 && method !== 8) throw new Error(`unsupported zip method ${method}`);
  if (bitFlag & 0x08) throw new Error('zip data descriptor not supported');
  if (bitFlag & 0x01) throw new Error('encrypted zip not supported');
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const name = buf.slice(30, 30 + nameLen).toString('utf8');
  const dataStart = 30 + nameLen + extraLen;
  const dataEnd = dataStart + compSize;
  if (dataEnd > buf.length) throw new Error('zip truncated');
  const raw = buf.subarray(dataStart, dataEnd);
  if (method === 0) return { name, data: Buffer.from(raw) };
  return { name, data: inflateRawSync(raw) };
}

/** Merge fresh records over the previous snapshot: dedupe (fresh wins), retention, cap, sort. */
export function mergeLiveEvents({ previous = [], fresh = [], now = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(now);
  const byId = new Map();
  const keep = (e) => {
    if (!e || typeof e.id !== 'string' || !e.id) return;
    const t = Date.parse(e.isoDate);
    if (!Number.isFinite(t)) return; // undated records cannot sort honestly — drop
    const hours = RETENTION_HOURS[e.kind] ?? RETENTION_HOURS.event;
    if (nowMs - t > hours * 3600_000) return; // expired
    byId.set(e.id, e);
  };
  for (const e of previous) keep(e);
  for (const e of fresh) keep(e); // fresh wins on id collision
  return [...byId.values()]
    .sort((a, b) => (Date.parse(b.isoDate) - Date.parse(a.isoDate)) || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_EVENTS);
}

/** Floor a date to the UTC 15-minute grid GDELT publishes on, stepping back n windows. */
export function gdeltWindowDates(now = new Date(), n = 5) {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), Math.floor(now.getUTCMinutes() / 15) * 15);
  return Array.from({ length: n }, (_, i) => new Date(base - i * 15 * 60_000));
}

/** Format a GDELT 2.1 export.CSV.zip URL for a window date (UTC). */
export function gdeltExportUrl(d) {
  const p = (v) => String(v).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
  return `https://data.gdeltproject.org/gdeltv2/${stamp}.export.CSV.zip`;
}

export function stripTags(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&#8217;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}

export function simpleHash(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
