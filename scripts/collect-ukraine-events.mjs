#!/usr/bin/env node
// Ukraine live-wire collector — hourly GitHub Actions.
// Sources (all keyless except ReliefWeb, which needs a free approved appname):
//  1. GDELT 2.1 export CSV  data.gdeltproject.org  (geocoded conflict events, ActionGeo UP)
//  2. RSS, link-only: Kyiv Independent, Ukrainska Pravda (English), Google News x2 queries
//  3. ISW daily assessments via their WordPress JSON API (title/link/date only)
//  4. ReliefWeb API v2 reports+disasters (only when RELIEFWEB_APPNAME is set)
//  5. DeepState map status signal ONLY (snapshot id + feature counts, never geometry)
// Excluded by policy: ACLED (EULA forbids redistribution), DeepState article/geometry
// scraping (no permission reply; HTML is bot-walled — no bypass attempted).
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UKRAINE_EVENTS_SCHEMA_VERSION, applyGeocodeToItem, deepstateStatusToMeta,
  extractOsmCandidates, gdeltExportUrl, gdeltRowToEvent, gdeltWindowDates,
  geocodeText, googleNewsSources, iswPostToEvent, mergeLiveEvents,
  reliefwebDocToEvent, removeGeocode, rssItemToEvent, extractZipSingleFile,
  stripForGeocode, validateOsmResult,
} from './lib/ukraineEvents.mjs';
import { parseRssItems } from './collect-news.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = resolve(ROOT, 'ukraine-events');
const DEFAULT_TIMEOUT_MS = 25_000;
const UA = 'WorldSITREP-cache-collector/1.0 (+https://worldsitrep.com)';
const GDELT_WINDOWS = 5;
const FEED_DELAY_MS = 2000;
const OSM_BUDGET_PER_RUN = 25;
const OSM_THROTTLE_MS = 1100; // Nominatim usage policy: max 1 req/s
const NOMINATIM_UA = 'WorldSITREP-cache-collector/1.0 (contact: stefan@worldsitrep.com)';
const GEOCODE_CACHE_ATTRIBUTION = 'Place lookups © OpenStreetMap contributors (ODbL). Cached to respect the Nominatim usage policy; delete entries to re-query.';
const UNSAFE_CACHE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const RSS_FEEDS = [
  { id: 'kyiv-independent', theatre: 'ukraine', name: 'Kyiv Independent', url: 'https://kyivindependent.com/news-archive/rss/' },
  { id: 'pravda-eng', theatre: 'ukraine', name: 'Ukrainska Pravda', url: 'https://www.pravda.com.ua/eng/rss/' },
  { id: 'gnews-war', theatre: 'ukraine', name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('Ukraine war') + '&hl=en-US&gl=US&ceid=US%3Aen', outletFromSourceTag: true },
  { id: 'gnews-strikes', theatre: 'ukraine', name: 'Google News', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('Ukraine drones OR missiles OR Kyiv strike') + '&hl=en-US&gl=US&ceid=US%3Aen', outletFromSourceTag: true },
];
const ISW_POSTS_URL = 'https://understandingwar.org/wp-json/wp/v2/posts?search='
  + encodeURIComponent('russian offensive campaign assessment') + '&per_page=10&_fields=id,date,link,title';
const DEEPSTATE_HISTORY_URL = 'https://deepstatemap.live/api/history/last';

function option(name, fallback = null) {
  const prefix = '--' + name + '=';
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
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

function archivePath(output, collectedAt) {
  const date = new Date(collectedAt);
  if (Number.isNaN(date.getTime())) throw new Error('--collected-at must be a valid ISO date');
  const p = (v) => String(v).padStart(2, '0');
  return resolve(output, 'archive', String(date.getUTCFullYear()), p(date.getUTCMonth() + 1), `${p(date.getUTCDate())}.jsonl`);
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

async function osmLookup(name, timeoutMs) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=ua,ru&q=' + encodeURIComponent(name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': NOMINATIM_UA, 'accept-language': 'en' } });
    if (!response.ok) throw new Error('Nominatim HTTP ' + response.status);
    const arr = await response.json();
    return validateOsmResult(Array.isArray(arr) ? arr[0] : null);
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
async function geocodeEvents(events, { cache, timeout, osmBudget, useOsm }) {
  let gazetteerHits = 0, osmHits = 0, cacheHits = 0, queries = 0, revalidated = 0, unplaced = 0;
  const out = [];
  for (const e of events) {
    const tagged = (e.tags || []).includes('headline-geocoded');
    const wasGazetteer = tagged && (e.coordsNote || '').includes('gazetteer match');
    if (e.lat != null && e.lng != null && !wasGazetteer) {
      out.push(e);
      continue; // located by GDELT/OSM — stable, never re-derived
    }
    const text = stripForGeocode(e.description || '');
    const g = geocodeText(text);
    if (g) {
      out.push(applyGeocodeToItem(e, g, g.name));
      if (e.lat == null || e.lng == null) gazetteerHits++;
      else revalidated++;
      continue;
    }
    if (wasGazetteer) {
      // A guard now rejects this match (e.g. a "Moscow army" actor-phrase):
      // un-place honestly instead of leaving a wrong dot.
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
        hit = await osmLookup(cand, timeout);
      } catch (error) {
        console.error(`osm "${cand}": ${error.message} (will retry next run)`);
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

/** DeepState equality ignoring fetchedAt (a poll timestamp, not a data change). */
function sameDeepstate(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return a.snapshotId === b.snapshotId && a.featureCount === b.featureCount
    && a.status === b.status && a.error === b.error && a.url === b.url;
}

async function collectGdelt(timeout, collectedAt) {
  // Hourly runs overlap the 15-min GDELT grid; mergeLiveEvents dedupes by event id.
  const windows = gdeltWindowDates(new Date(collectedAt), GDELT_WINDOWS);
  const settled = await Promise.allSettled(windows.map(async (w) => {
    const url = gdeltExportUrl(w);
    const zip = await fetchBuffer(url, timeout, 'GDELT export', 'application/zip');
    const { data } = extractZipSingleFile(zip);
    return { url, text: data.toString('utf8') };
  }));
  const events = [];
  let okFiles = 0;
  const errors = [];
  for (const s of settled) {
    if (s.status === 'rejected') {
      errors.push(s.reason?.message || String(s.reason));
      continue;
    }
    okFiles++;
    for (const line of s.value.text.split('\n')) {
      if (!line) continue;
      try {
        const e = gdeltRowToEvent(line.split('\t'));
        if (e) events.push(e);
      } catch (error) {
        console.error(`gdelt bad row in ${s.value.url}: ${error.message}`);
      }
    }
  }
  if (okFiles === 0) {
    return { events, status: statusFailed('gdelt-2.1-export', 'https://data.gdeltproject.org/gdeltv2/', errors[0] || 'all windows failed') };
  }
  if (errors.length) console.error(`gdelt: ${errors.length}/${settled.length} windows failed; kept ${okFiles}`);
  return { events, status: statusOk('gdelt-2.1-export', 'https://data.gdeltproject.org/gdeltv2/', events.length) };
}

async function collectRss(timeout, collectedAt) {
  const events = [];
  const statuses = [];
  for (const feed of RSS_FEEDS) {
    try {
      const xml = (await fetchBuffer(feed.url, timeout, `RSS ${feed.id}`, 'application/rss+xml, application/xml, text/xml')).toString('utf8');
      const outlets = feed.outletFromSourceTag ? googleNewsSources(xml) : new Map();
      let count = 0;
      for (const item of parseRssItems(xml, feed)) {
        const outlet = outlets.get(item.url);
        const e = rssItemToEvent(outlet ? { ...item, publisher: outlet } : item, collectedAt);
        if (e) {
          events.push(e);
          count++;
        }
      }
      statuses.push(statusOk(feed.id, feed.url, count));
    } catch (error) {
      console.error(`rss ${feed.id}: ${error.message}`);
      statuses.push(statusFailed(feed.id, feed.url, error));
    }
    await sleep(FEED_DELAY_MS);
  }
  return { events, statuses };
}

async function collectIsw(timeout) {
  try {
    const posts = await fetchJson(ISW_POSTS_URL, timeout, 'ISW');
    if (!Array.isArray(posts)) throw new Error('ISW response is not an array');
    const events = [];
    for (const p of posts.slice(0, 10)) {
      try {
        const e = iswPostToEvent(p);
        if (e) events.push(e);
      } catch (error) {
        console.error(`isw bad post: ${error.message}`);
      }
    }
    return { events, status: statusOk('isw-assessments', 'https://understandingwar.org/', events.length) };
  } catch (error) {
    console.error(`isw: ${error.message}`);
    return { events: [], status: statusFailed('isw-assessments', 'https://understandingwar.org/', error) };
  }
}

async function collectReliefweb(timeout) {
  const appname = process.env.RELIEFWEB_APPNAME;
  if (!appname) {
    console.log('ReliefWeb skipped (RELIEFWEB_APPNAME not set — request a free appname at https://apidoc.reliefweb.int/parameters#appname)');
    return { events: [], status: statusSkipped('reliefweb', 'https://api.reliefweb.int/v2/', 'RELIEFWEB_APPNAME not set') };
  }
  const events = [];
  for (const [endpoint, kind] of [['reports', 'report'], ['disasters', 'disaster']]) {
    try {
      const payload = await reliefwebPost(endpoint, appname, {
        filter: { field: 'primary_country.iso3', value: ['ukr'] },
        limit: 10,
        sort: ['date.created:desc'],
        fields: { include: ['title', 'date.created', 'primary_country.name', 'source.name', 'url_alias'] },
      }, timeout);
      for (const doc of payload?.data || []) {
        const e = reliefwebDocToEvent(doc, kind);
        if (e) events.push(e);
      }
    } catch (error) {
      console.error(`reliefweb ${endpoint}: ${error.message}`);
      return { events, status: statusFailed('reliefweb', 'https://api.reliefweb.int/v2/', error) };
    }
    await sleep(FEED_DELAY_MS);
  }
  return { events, status: statusOk('reliefweb', 'https://api.reliefweb.int/v2/', events.length) };
}

async function collectDeepstateStatus(timeout, collectedAt) {
  try {
    const json = await fetchJson(DEEPSTATE_HISTORY_URL, timeout, 'DeepState');
    const meta = deepstateStatusToMeta(json, collectedAt);
    console.log(`DeepState snapshot ${meta.snapshotId} (${meta.featureCount} features) — status only, no geometry stored`);
    return { meta, status: statusOk('deepstate-status', 'https://deepstatemap.live/en', 1) };
  } catch (error) {
    console.error(`deepstate: ${error.message}`);
    return { meta: { status: 'failed', error: String(error.message).slice(0, 200), fetchedAt: collectedAt, url: 'https://deepstatemap.live/en' }, status: statusFailed('deepstate-status', 'https://deepstatemap.live/en', error) };
  }
}

export async function collect({ inputPath, output = DEFAULT_OUTPUT, collectedAt, timeoutMs = DEFAULT_TIMEOUT_MS, only = null } = {}) {
  const collectionTime = collectedAt || new Date().toISOString();
  const timeout = parseTimeout(timeoutMs);
  const want = (name) => !only || only === name;
  const fresh = [];
  const sources = [];
  let deepstate = null;

  if (inputPath) {
    const fixture = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
    if (want('gdelt')) {
      let count = 0;
      for (const line of fixture.gdeltRows || []) {
        try {
          const e = gdeltRowToEvent(line.split('\t'));
          if (e) {
            fresh.push(e);
            count++;
          }
        } catch (error) {
          console.error('gdelt fixture: ' + error.message);
        }
      }
      sources.push(statusOk('gdelt-2.1-export', 'fixture', count));
    }
    if (want('rss')) {
      for (const item of fixture.rss || []) {
        const feed = RSS_FEEDS.find((f) => f.id === item.feed) || RSS_FEEDS[0];
        const outlets = item.xml && feed.outletFromSourceTag ? googleNewsSources(item.xml) : new Map();
        const parsed = item.xml ? parseRssItems(item.xml, feed) : [item.item];
        for (const p of parsed) {
          const e = rssItemToEvent(outlets.get(p.url) ? { ...p, publisher: outlets.get(p.url) } : p, collectionTime);
          if (e) fresh.push(e);
        }
      }
      sources.push(statusOk('rss-fixture', 'fixture', fresh.filter((e) => e.kind === 'news').length));
    }
    if (want('isw')) {
      let count = 0;
      for (const p of fixture.isw || []) {
        const e = iswPostToEvent(p);
        if (e) {
          fresh.push(e);
          count++;
        }
      }
      sources.push(statusOk('isw-assessments', 'fixture', count));
    }
    if (want('reliefweb')) {
      let count = 0;
      for (const d of fixture.reliefweb || []) {
        const e = reliefwebDocToEvent(d.doc, d.kind);
        if (e) {
          fresh.push(e);
          count++;
        }
      }
      sources.push(statusOk('reliefweb', 'fixture', count));
    }
    if (want('deepstate')) {
      if (fixture.deepstate) {
        deepstate = deepstateStatusToMeta(fixture.deepstate, collectionTime);
        sources.push(statusOk('deepstate-status', 'fixture', 1));
      }
    }
  } else {
    if (want('gdelt')) {
      const r = await collectGdelt(timeout, collectionTime);
      fresh.push(...r.events);
      sources.push(r.status);
    }
    if (want('rss')) {
      const r = await collectRss(timeout, collectionTime);
      fresh.push(...r.events);
      sources.push(...r.statuses);
    }
    if (want('isw')) {
      const r = await collectIsw(timeout);
      fresh.push(...r.events);
      sources.push(r.status);
    }
    if (want('reliefweb')) {
      const r = await collectReliefweb(timeout);
      fresh.push(...r.events);
      sources.push(r.status);
    }
    if (want('deepstate')) {
      const r = await collectDeepstateStatus(timeout, collectionTime);
      deepstate = r.meta;
      sources.push(r.status);
    }
  }

  const latest = resolve(output, 'latest.json');
  const previous = await existingJson(latest);
  const merged = mergeLiveEvents({ previous: previous?.events || [], fresh, now: collectionTime });
  // Geocode over the merged set so carried-over previous items gain coords
  // on later runs, not just fresh ones. Fixture mode is gazetteer-only.
  const cache = inputPath ? { entries: {}, dirty: false } : await loadGeocodeCache(output);
  const geo = await geocodeEvents(merged, { cache, timeout, osmBudget: OSM_BUDGET_PER_RUN, useOsm: !inputPath });
  const events = geo.events;
  const unplaced = events.filter((e) => e.lat == null || e.lng == null).length;
  console.log(`geocode: ${geo.stats.gazetteerHits} gazetteer, ${geo.stats.osmHits} osm (+${geo.stats.cacheHits} cached), ${geo.stats.queries} queries, ${geo.stats.revalidated} revalidated, ${geo.stats.removed} removed, ${unplaced} still unplaced`);
  if (!inputPath && cache.dirty) {
    await atomicJsonWrite(resolve(output, 'geocode-cache.json'), { _attribution: GEOCODE_CACHE_ATTRIBUTION, entries: cache.entries });
  }
  if (events.length === 0) throw new Error('no ukraine events collected (all fetches failed or everything expired)');

  const feed = {
    schemaVersion: UKRAINE_EVENTS_SCHEMA_VERSION,
    theatre: 'ukraine',
    collectedAt: collectionTime,
    sources,
    deepstate,
    count: events.length,
    events,
  };
  if (previous && JSON.stringify(previous.events) === JSON.stringify(feed.events)
    && JSON.stringify(previous.sources) === JSON.stringify(feed.sources)
    && sameDeepstate(previous.deepstate, feed.deepstate)) {
    return { latest, archive: null, feed: previous, changed: false };
  }
  await atomicJsonWrite(latest, feed);
  const archive = archivePath(output, feed.collectedAt);
  await mkdir(dirname(archive), { recursive: true });
  await appendFile(archive, JSON.stringify(feed) + '\n', 'utf8');
  return { latest, archive, feed, changed: true };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const result = await collect({
      inputPath: option('input'),
      output: option('output', DEFAULT_OUTPUT),
      collectedAt: option('collected-at'),
      timeoutMs: option('timeout-ms', DEFAULT_TIMEOUT_MS),
      only: option('only'),
    });
    console.log(result.changed
      ? `Collected ${result.feed.count} ukraine events; wrote ${result.latest} and ${result.archive}`
      : 'No meaningful ukraine change; left latest/archive unchanged');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
