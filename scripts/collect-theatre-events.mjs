#!/usr/bin/env node
// Per-theatre live-wire collector — hourly GitHub Actions (--all) or single
// theatre (--theatre=<id>). Same envelope + retention + warehouse layout as
// the Ukraine collector; configs in scripts/lib/theatreConfigs.mjs.
// Sources per theatre (all keyless except ReliefWeb, free approved appname):
//  1. GDELT 2.1 export CSV (downloaded ONCE per run, partitioned per theatre)
//  2. RSS, link-only (native outlets + Google News queries)
//  3. ReliefWeb API v2 reports+disasters (only when RELIEFWEB_APPNAME is set;
//     skipped for theatres with reliefwebIso3: null)
// Excluded: ACLED (EULA), all HTML scraping (bot-walled — no bypass attempted).
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THEATRE_EVENTS_SCHEMA_VERSION, applyGeocodeToItem, createGeocoder,
  extractOsmCandidates, extractZipSingleFile, feedTitleKept, gdeltExportUrl,
  gdeltGapWindows, gdeltRowToEventFor, googleNewsSources, mergeLiveEvents,
  reliefwebDocToEvent, removeGeocode, rssItemToEvent, validateOsmResultFor,
} from './lib/theatreEvents.mjs';
import { THEATRE_IDS, getTheatre } from './lib/theatreConfigs.mjs';
import { parseRssItems } from './collect-news.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TIMEOUT_MS = 25_000;
const UA = 'WorldSITREP-cache-collector/1.0 (+https://worldsitrep.com)';
const GDELT_WINDOWS = 5;
const GDELT_MAX_WINDOWS = 48; // 12h gap backfill cap (see gdeltGapWindows)
const FEED_DELAY_MS = 2000;
const OSM_BUDGET_PER_THEATRE = 25;
const OSM_THROTTLE_MS = 1100; // Nominatim usage policy: max 1 req/s
const NOMINATIM_UA = 'WorldSITREP-cache-collector/1.0 (contact: stefan@worldsitrep.com)';
const GEOCODE_CACHE_ATTRIBUTION = 'Place lookups © OpenStreetMap contributors (ODbL). Cached to respect the Nominatim usage policy; delete entries to re-query.';
const UNSAFE_CACHE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function option(name, fallback = null) {
  const prefix = '--' + name + '=';
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function flag(name) {
  return process.argv.includes('--' + name);
}

function parseTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('--timeout-ms must be a positive number');
  return timeout;
}

async function fetchBuffer(url, timeoutMs, label, accept = '*/*') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept, 'user-agent': UA } });
    if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${label} request timed out after ${timeoutMs} ms`);
    if (error.message.startsWith(label)) throw error;
    throw new Error(`${label} request failed: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs, label) {
  const buf = await fetchBuffer(url, timeoutMs, label, 'application/json');
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`, { cause: error });
  }
}

async function reliefwebPost(endpoint, appname, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.reliefweb.int/v2/${endpoint}?appname=${encodeURIComponent(appname)}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`ReliefWeb ${endpoint} request failed with HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`ReliefWeb ${endpoint} request timed out after ${timeoutMs} ms`);
    if (error.message.startsWith('ReliefWeb')) throw error;
    throw new Error(`ReliefWeb ${endpoint} request failed: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

async function atomicJsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function existingJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function osmLookup(name, cfg, timeoutMs) {
  // viewbox order: left,top,right,bottom (minLng,maxLat,maxLng,minLat), bounded.
  const [minLat, minLng, maxLat, maxLng] = cfg.osm.bbox;
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1'
    + '&countrycodes=' + cfg.osm.countryCodes.join(',')
    + `&viewbox=${minLng},${maxLat},${maxLng},${minLat}&bounded=1`
    + '&q=' + encodeURIComponent(name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': NOMINATIM_UA, 'accept-language': 'en' } });
    if (!response.ok) throw new Error('Nominatim HTTP ' + response.status);
    const arr = await response.json();
    return validateOsmResultFor(Array.isArray(arr) ? arr[0] : null, cfg.osm);
  } finally {
    clearTimeout(timer);
  }
}

async function loadGeocodeCache(output) {
  try {
    const raw = JSON.parse(await readFile(resolve(output, 'geocode-cache.json'), 'utf8'));
    if (raw && typeof raw.entries === 'object' && raw.entries) return { entries: raw.entries, dirty: false };
  } catch { /* missing or corrupt — start fresh */ }
  return { entries: {}, dirty: false };
}

function cacheHas(cache, key) {
  return !UNSAFE_CACHE_KEYS.has(key) && Object.prototype.hasOwnProperty.call(cache.entries, key);
}

/**
 * Geocode stage: gazetteer for every unlocated item, then OSM candidates for
 * the residue (live runs only, budgeted + cached). Runs over the MERGED set
 * so previously collected items gain coords on later runs, not just fresh ones.
 */
async function geocodeEvents(cfg, geocoder, events, { cache, timeout, osmBudget, useOsm }) {
  let gazetteerHits = 0, osmHits = 0, cacheHits = 0, queries = 0, revalidated = 0, unplaced = 0;
  const out = [];
  for (const e of events) {
    const tagged = (e.tags || []).includes('headline-geocoded');
    const wasGazetteer = tagged && (e.coordsNote || '').includes('gazetteer match');
    if (e.lat != null && e.lng != null && !wasGazetteer) {
      out.push(e);
      continue; // located by GDELT/OSM — stable, never re-derived
    }
    const text = geocoder.stripForGeocode(e.description || '');
    const g = geocoder.geocodeText(text);
    if (g) {
      out.push(applyGeocodeToItem(e, g, g.name));
      if (e.lat == null || e.lng == null) gazetteerHits++;
      else revalidated++;
      continue;
    }
    if (wasGazetteer) {
      out.push(removeGeocode(e));
      unplaced++;
      continue;
    }
    if (!useOsm) {
      out.push(e);
      continue;
    }
    let placed = null;
    for (const cand of extractOsmCandidates(text)) {
      const key = cand.toLowerCase();
      if (UNSAFE_CACHE_KEYS.has(key)) continue;
      if (cacheHas(cache, key)) {
        if (cache.entries[key]) {
          placed = { geo: cache.entries[key], name: cand };
          cacheHits++;
          break;
        }
        continue; // known negative — try the next candidate
      }
      if (queries >= osmBudget) break;
      queries++;
      await sleep(OSM_THROTTLE_MS);
      let hit = null;
      try {
        hit = await osmLookup(cand, cfg, timeout);
      } catch (error) {
        console.error(`osm ${cfg.id} "${cand}": ${error.message} (will retry next run)`);
        break; // transient error: stop here, retry next run (nothing cached)
      }
      cache.entries[key] = hit; // null = resolved negative, never re-queried
      cache.dirty = true;
      if (hit) {
        placed = { geo: hit, name: cand };
        osmHits++;
        break;
      }
    }
    out.push(placed ? applyGeocodeToItem(e, placed.geo, placed.name) : e);
  }
  return { events: out, stats: { gazetteerHits, osmHits, cacheHits, queries, revalidated, removed: unplaced } };
}

function statusOk(id, url, count) { return { id, url, status: 'ok', count }; }
function statusFailed(id, url, error) { return { id, url, status: 'failed', count: 0, error: String(error?.message || error).slice(0, 200) }; }
function statusSkipped(id, url, reason) { return { id, url, status: 'skipped', count: 0, note: reason }; }

/**
 * Shared GDELT fetch: one download for the whole run, partitioned per theatre.
 * sinceIso is the OLDEST previous collectedAt across the run's theatres so
 * every theatre's gap is covered (mergeLiveEvents dedupes by event id).
 */
async function fetchGdeltTexts(timeout, collectedAt, sinceIso = null) {
  const windows = gdeltGapWindows(sinceIso, new Date(collectedAt), GDELT_WINDOWS, GDELT_MAX_WINDOWS);
  console.log('gdelt: ' + windows.length + ' windows (' + gdeltExportUrl(windows[windows.length - 1]) + ' .. ' + gdeltExportUrl(windows[0]) + ')');
  const settled = await Promise.allSettled(windows.map(async (w) => {
    const url = gdeltExportUrl(w);
    const zip = await fetchBuffer(url, timeout, 'GDELT export', 'application/zip');
    const { data } = extractZipSingleFile(zip);
    return { url, text: data.toString('utf8') };
  }));
  const texts = [];
  let okFiles = 0;
  const errors = [];
  for (const s of settled) {
    if (s.status === 'rejected') {
      errors.push(s.reason?.message || String(s.reason));
      continue;
    }
    okFiles++;
    texts.push(s.value);
  }
  if (okFiles === 0) {
    return { texts, ok: false, error: errors[0] || 'all windows failed', windows: windows.length };
  }
  if (errors.length) console.error(`gdelt: ${errors.length}/${settled.length} windows failed; kept ${okFiles}`);
  return { texts, ok: true, error: null, windows: windows.length };
}

function partitionGdelt(cfg, texts) {
  const events = [];
  for (const t of texts) {
    for (const line of t.text.split('\n')) {
      if (!line) continue;
      try {
        const e = gdeltRowToEventFor(line.split('\t'), { ...cfg.gdelt, actorMap: cfg.actorMap });
        if (e) events.push(e);
      } catch (error) {
        console.error(`gdelt ${cfg.id} bad row in ${t.url}: ${error.message}`);
      }
    }
  }
  return events;
}

async function collectRss(cfg, timeout, collectedAt) {
  const events = [];
  const statuses = [];
  for (const feed of cfg.rssFeeds) {
    try {
      const xml = (await fetchBuffer(feed.url, timeout, `RSS ${feed.id}`, 'application/rss+xml, application/xml, text/xml')).toString('utf8');
      const outlets = feed.outletFromSourceTag ? googleNewsSources(xml) : new Map();
      let count = 0;
      let filtered = 0;
      for (const item of parseRssItems(xml, feed)) {
        if (!feed.outletFromSourceTag && !feedTitleKept(item.title, feed.match)) {
          filtered++;
          continue;
        }
        const outlet = outlets.get(item.url);
        const e = rssItemToEvent(outlet ? { ...item, publisher: outlet } : item, collectedAt);
        if (e) {
          events.push(e);
          count++;
        }
      }
      statuses.push({ ...statusOk(feed.id, feed.url, count), filtered });
    } catch (error) {
      console.error(`rss ${cfg.id} ${feed.id}: ${error.message}`);
      statuses.push(statusFailed(feed.id, feed.url, error));
    }
    await sleep(FEED_DELAY_MS);
  }
  return { events, statuses };
}

async function collectReliefweb(cfg, timeout) {
  if (!cfg.reliefwebIso3) {
    return { events: [], status: statusSkipped('reliefweb', 'https://api.reliefweb.int/v2/', 'no single-country filter for this theatre') };
  }
  const appname = process.env.RELIEFWEB_APPNAME;
  if (!appname) {
    console.log(`ReliefWeb ${cfg.id} skipped (RELIEFWEB_APPNAME not set)`);
    return { events: [], status: statusSkipped('reliefweb', 'https://api.reliefweb.int/v2/', 'RELIEFWEB_APPNAME not set') };
  }
  const events = [];
  for (const [endpoint, kind] of [['reports', 'report'], ['disasters', 'disaster']]) {
    try {
      const payload = await reliefwebPost(endpoint, appname, {
        filter: { field: 'primary_country.iso3', value: cfg.reliefwebIso3 },
        limit: 10,
        sort: ['date.created:desc'],
        fields: { include: ['title', 'date.created', 'primary_country.name', 'source.name', 'url_alias'] },
      }, timeout);
      for (const doc of payload?.data || []) {
        const e = reliefwebDocToEvent(doc, kind);
        if (e) events.push(e);
      }
    } catch (error) {
      console.error(`reliefweb ${cfg.id} ${endpoint}: ${error.message}`);
      return { events, status: statusFailed('reliefweb', 'https://api.reliefweb.int/v2/', error) };
    }
    await sleep(FEED_DELAY_MS);
  }
  return { events, status: statusOk('reliefweb', 'https://api.reliefweb.int/v2/', events.length) };
}

// Warehouse day segments: partition the merged set by UTC date. Day files
// only ever gain new ids; index.json recounts touched days. Never pruned.
async function writeDaySegments(output, events) {
  const byDay = new Map();
  for (const e of events) {
    const day = String(e.isoDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  const touched = [];
  for (const [day, list] of byDay) {
    const parts = day.split('-');
    const dir = resolve(output, 'days', parts[0], parts[1]);
    const file = resolve(dir, parts[2] + '.json');
    await mkdir(dir, { recursive: true });
    const prev = await existingJson(file);
    const seen = new Map((prev?.events || []).map((e) => [e.id, e]));
    for (const e of list) seen.set(e.id, e);
    const mergedDay = [...seen.values()].sort((a, b) => (Date.parse(b.isoDate) - Date.parse(a.isoDate)) || (a.id < b.id ? -1 : 1));
    const next = { schemaVersion: THEATRE_EVENTS_SCHEMA_VERSION, date: day, count: mergedDay.length, events: mergedDay };
    const prevCanon = prev ? { schemaVersion: prev.schemaVersion, date: day, count: (prev.events || []).length, events: prev.events || [] } : null;
    if (JSON.stringify(next) !== JSON.stringify(prevCanon)) {
      await atomicJsonWrite(file, next);
    }
    touched.push(day);
  }
  const indexPath = resolve(output, 'index.json');
  const index = (await existingJson(indexPath)) || { schemaVersion: THEATRE_EVENTS_SCHEMA_VERSION, updatedAt: null, days: {} };
  for (const day of touched) {
    const parts = day.split('-');
    const file = await existingJson(resolve(output, 'days', parts[0], parts[1], parts[2] + '.json'));
    const kinds = {};
    for (const e of file.events) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    index.days[day] = { count: file.events.length, kinds };
  }
  index.updatedAt = new Date().toISOString();
  await atomicJsonWrite(indexPath, index);
  return touched;
}

function fixtureSection(fixture, key, theatreId) {
  const section = fixture?.[key];
  if (!section) return [];
  if (Array.isArray(section)) return section; // single-theatre fixture
  return section[theatreId] || [];
}

export async function collectTheatre(cfg, { root, collectedAt, timeoutMs, only, fixture, gdeltTexts, gdeltFailed, gdeltError }) {
  const collectionTime = collectedAt;
  const timeout = parseTimeout(timeoutMs);
  const want = (name) => !only || only === name;
  const output = resolve(root, cfg.dir);
  const fresh = [];
  const sources = [];
  const latest = resolve(output, 'latest.json');
  const previous = await existingJson(latest);
  const geocoder = createGeocoder(cfg.gazetteer, { outlets: cfg.outletsToStrip });

  if (fixture) {
    if (want('gdelt')) {
      let count = 0;
      for (const line of fixture.gdeltRows || []) {
        try {
          const e = gdeltRowToEventFor(line.split('\t'), { ...cfg.gdelt, actorMap: cfg.actorMap });
          if (e) {
            fresh.push(e);
            count++;
          }
        } catch (error) {
          console.error(`gdelt fixture ${cfg.id}: ${error.message}`);
        }
      }
      sources.push(statusOk('gdelt-2.1-export', 'fixture', count));
    }
    if (want('rss')) {
      for (const item of fixtureSection(fixture, 'rss', cfg.id)) {
        const feed = cfg.rssFeeds.find((f) => f.id === item.feed) || cfg.rssFeeds[0];
        const outlets = item.xml && feed.outletFromSourceTag ? googleNewsSources(item.xml) : new Map();
        const parsed = item.xml ? parseRssItems(item.xml, feed) : [item.item];
        for (const p of parsed) {
          if (!feed.outletFromSourceTag && !feedTitleKept(p.title, feed.match)) continue;
          const e = rssItemToEvent(outlets.get(p.url) ? { ...p, publisher: outlets.get(p.url) } : p, collectionTime);
          if (e) fresh.push(e);
        }
      }
      sources.push(statusOk('rss-fixture', 'fixture', fresh.filter((e) => e.kind === 'news').length));
    }
    if (want('reliefweb')) {
      let count = 0;
      for (const d of fixtureSection(fixture, 'reliefweb', cfg.id)) {
        const e = reliefwebDocToEvent(d.doc, d.kind);
        if (e) {
          fresh.push(e);
          count++;
        }
      }
      sources.push(statusOk('reliefweb', 'fixture', count));
    }
  } else {
    if (want('gdelt')) {
      if (gdeltFailed) {
        sources.push(statusFailed('gdelt-2.1-export', 'https://data.gdeltproject.org/gdeltv2/', gdeltError || 'shared fetch failed'));
      } else {
        const events = partitionGdelt(cfg, gdeltTexts);
        fresh.push(...events);
        sources.push(statusOk('gdelt-2.1-export', 'https://data.gdeltproject.org/gdeltv2/', events.length));
      }
    }
    if (want('rss')) {
      const r = await collectRss(cfg, timeout, collectionTime);
      fresh.push(...r.events);
      sources.push(...r.statuses);
    }
    if (want('reliefweb')) {
      const r = await collectReliefweb(cfg, timeout);
      fresh.push(...r.events);
      sources.push(r.status);
    }
  }

  const merged = mergeLiveEvents({ previous: previous?.events || [], fresh, now: collectionTime });
  const cache = fixture ? { entries: {}, dirty: false } : await loadGeocodeCache(output);
  const geo = await geocodeEvents(cfg, geocoder, merged, { cache, timeout, osmBudget: OSM_BUDGET_PER_THEATRE, useOsm: !fixture });
  const events = geo.events;
  const unplaced = events.filter((e) => e.lat == null || e.lng == null).length;
  console.log(`geocode ${cfg.id}: ${geo.stats.gazetteerHits} gazetteer, ${geo.stats.osmHits} osm (+${geo.stats.cacheHits} cached), ${geo.stats.queries} queries, ${geo.stats.revalidated} revalidated, ${geo.stats.removed} removed, ${unplaced} still unplaced`);
  if (!fixture && cache.dirty) {
    await atomicJsonWrite(resolve(output, 'geocode-cache.json'), { _attribution: GEOCODE_CACHE_ATTRIBUTION, entries: cache.entries });
  }
  if (events.length === 0) throw new Error(`no ${cfg.id} events collected (all fetches failed or everything expired)`);
  const touchedDays = await writeDaySegments(output, events);

  const feed = {
    schemaVersion: THEATRE_EVENTS_SCHEMA_VERSION,
    theatre: cfg.id,
    collectedAt: collectionTime,
    sources,
    count: events.length,
    events,
  };
  const changed = !(previous && JSON.stringify(previous.events) === JSON.stringify(feed.events)
    && JSON.stringify(previous.sources) === JSON.stringify(feed.sources));
  const effective = changed ? feed : previous;
  await atomicJsonWrite(resolve(output, 'status.json'), {
    schemaVersion: THEATRE_EVENTS_SCHEMA_VERSION,
    checkedAt: collectionTime,
    collectedAt: effective.collectedAt,
    count: effective.count ?? effective.events.length,
    changed,
    sources: sources.map((s) => ({ id: s.id, status: s.status, count: s.count })),
  });
  if (!changed) {
    return { latest, days: touchedDays, feed: previous, changed: false };
  }
  await atomicJsonWrite(latest, feed);
  return { latest, days: touchedDays, feed, changed: true };
}

export async function collect({ theatre = null, all = false, inputPath, root = ROOT, collectedAt, timeoutMs = DEFAULT_TIMEOUT_MS, only = null } = {}) {
  const collectionTime = collectedAt || new Date().toISOString();
  const ids = all ? [...THEATRE_IDS] : [theatre || ''];
  if (!all && !theatre) throw new Error('pass --theatre=<id> or --all');
  const cfgs = ids.map(getTheatre); // throws on unknown id
  const fixture = inputPath ? JSON.parse(await readFile(resolve(inputPath), 'utf8')) : null;
  const wantGdelt = !only || only === 'gdelt';

  // Shared GDELT download (live mode only): oldest previous collectedAt wins
  // so every theatre's gap is covered.
  let gdeltTexts = [];
  let gdeltFailed = false;
  let gdeltError = null;
  if (!fixture && wantGdelt) {
    let oldest = null;
    for (const cfg of cfgs) {
      const prev = await existingJson(resolve(root, cfg.dir, 'latest.json'));
      if (prev?.collectedAt && (!oldest || prev.collectedAt < oldest)) oldest = prev.collectedAt;
    }
    const timeout = parseTimeout(timeoutMs);
    const r = await fetchGdeltTexts(timeout, collectionTime, oldest);
    gdeltTexts = r.texts;
    gdeltFailed = !r.ok;
    gdeltError = r.error;
  }

  const results = {};
  const failures = [];
  for (const cfg of cfgs) {
    try {
      results[cfg.id] = await collectTheatre(cfg, { root, collectedAt: collectionTime, timeoutMs, only, fixture, gdeltTexts, gdeltFailed, gdeltError });
      console.log(results[cfg.id].changed
        ? `Collected ${results[cfg.id].feed.count} ${cfg.id} events; latest.json + ${results[cfg.id].days.length} day segments current`
        : `No meaningful ${cfg.id} change; heartbeat in status.json`);
    } catch (error) {
      console.error(`${cfg.id}: ${error.message}`);
      failures.push(`${cfg.id}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(`${failures.length}/${cfgs.length} theatres failed: ${failures.join(' | ')}`);
  return results;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    await collect({
      theatre: option('theatre'),
      all: flag('all'),
      inputPath: option('input'),
      root: option('root', ROOT),
      collectedAt: option('collected-at'),
      timeoutMs: option('timeout-ms', DEFAULT_TIMEOUT_MS),
      only: option('only'),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
