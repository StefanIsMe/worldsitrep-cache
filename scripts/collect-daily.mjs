#!/usr/bin/env node
// Daily collectors: Taiwan MND PLA-activities (HTML list+post, factual counts
// only, attribution + link back) + NSIDC daily sea-ice snapshot (derived
// metadata + image URLs, citation). Free, keyless. Slow cadence: daily.
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TIMEOUT_MS = 25_000;
const UA = "WorldSITREP-cache-collector/1.0 (+https://worldsitrep.com)";
const MND_HUB = "https://www.mnd.gov.tw/en/news/PlaactList";
const MND_ORIGIN = "https://www.mnd.gov.tw";
const NSIDC_IMAGES = {
  extent: "https://nsidc.org/data/seaice_index/images/daily_images/N_daily_extent.png",
  concentration: "https://nsidc.org/data/seaice_index/images/daily_images/N_daily_concentration_hires.png",
  timeseries: "https://nsidc.org/data/seaice_index/images/daily_images/N_iqr_timeseries.png",
};

function option(name, fallback = null) {
  const prefix = "--" + name + "=";
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

async function fetchText(url, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA } });
    if (!response.ok) throw new Error(label + " request failed with HTTP " + response.status);
    return await response.text();
  } catch (error) {
    if (error.name === "AbortError") throw new Error(label + " request timed out after " + timeoutMs + " ms");
    if (error.message.startsWith(label)) throw error;
    throw new Error(label + " request failed: " + error.message, { cause: error });
  } finally { clearTimeout(timer); }
}

async function headOk(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal, headers: { "user-agent": UA } });
    return { ok: response.ok, status: response.status, lastModified: response.headers.get("last-modified") };
  } catch {
    return { ok: false, status: 0, lastModified: null };
  } finally { clearTimeout(timer); }
}

/** Parse the MND PLA-activity list hub. Throws when structure changes. */
export function parseMndHub(html) {
  const items = [];
  const re = /<a\s+href="([^"]*?PLAAct\/(\d+)[^"]*)"[^>]*class="news_list"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[3];
    const date = /<div[^>]*class="date[^"]*"[^>]*>([^<]+)<\/div>/i.exec(block);
    const title = /<h2[^>]*class="title[^"]*"[^>]*>([^<]+)<\/h2>/i.exec(block);
    items.push({
      id: m[2],
      url: m[1].startsWith("http") ? m[1] : MND_ORIGIN + m[1],
      date: date ? date[1].trim() : null,
      title: title ? title[1].trim() : null,
    });
  }
  if (items.length === 0) throw new Error("MND hub structure changed (zero news_list items parsed)");
  return items;
}

/** Extract PLA counts from a post body. Returns nulls when phrasing differs. */
export function parseMndCounts(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = /(\d+)\s+sorties?\s+of\s+PLA\s+aircraft,\s*(\d+)\s+PLAN\s+(?:ships|vessels?)\s+and\s*(\d+)\s+official\s+ships/i.exec(text);
  const excerpt = text.slice(0, 500).trim();
  return {
    aircraftSorties: m ? Number(m[1]) : null,
    planShips: m ? Number(m[2]) : null,
    officialShips: m ? Number(m[3]) : null,
    excerpt,
  };
}

async function atomicJsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + process.pid + "." + Date.now() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function archivePath(output, collectedAt, day) {
  const date = new Date(day || collectedAt);
  if (Number.isNaN(date.getTime())) throw new Error("invalid date for archive path");
  return resolve(output, "archive", String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0") + ".jsonl");
}

async function existingJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function collect({ outputRoot = ROOT, collectedAt, timeoutMs = DEFAULT_TIMEOUT_MS, mndHubHtml = null, mndPostHtml = null } = {}) {
  const collectionTime = collectedAt || new Date().toISOString();
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout-ms must be a positive number");

  // --- Taiwan MND ---
  const hubHtml = mndHubHtml || await fetchText(MND_HUB, timeout, "MND hub");
  const hubItems = parseMndHub(hubHtml).slice(0, 10);
  const latest = hubItems[0];
  let counts = { aircraftSorties: null, planShips: null, officialShips: null, excerpt: null };
  try {
    const postHtml = mndPostHtml || await fetchText(latest.url, timeout, "MND post");
    counts = parseMndCounts(postHtml);
  } catch (error) { console.error("mnd post: " + error.message); }
  const taiwanFeed = {
    schemaVersion: 1,
    collectedAt: collectionTime,
    source: { id: "taiwan-mnd", url: MND_HUB },
    count: hubItems.length,
    latest: { ...latest, ...counts },
    items: hubItems,
  };
  const taiwanLatest = resolve(outputRoot, "taiwan-data", "latest.json");
  const taiwanPrev = await existingJson(taiwanLatest);
  let taiwanChanged = true;
  if (taiwanPrev && JSON.stringify(taiwanPrev.items) === JSON.stringify(taiwanFeed.items)
    && JSON.stringify(taiwanPrev.latest) === JSON.stringify(taiwanFeed.latest)) {
    taiwanChanged = false;
  } else {
    await atomicJsonWrite(taiwanLatest, taiwanFeed);
    await mkdir(dirname(archivePath(resolve(outputRoot, "taiwan-data"), collectionTime)), { recursive: true });
    await appendFile(archivePath(resolve(outputRoot, "taiwan-data"), collectionTime), JSON.stringify(taiwanFeed) + "\n", "utf8");
  }

  // --- NSIDC Arctic sea ice (daily image snapshot metadata) ---
  const checks = {};
  for (const [key, url] of Object.entries(NSIDC_IMAGES)) {
    checks[key] = { url, ...(await headOk(url, timeout)) };
  }
  const arcticFeed = {
    schemaVersion: 1,
    collectedAt: collectionTime,
    source: { id: "nsidc", url: "https://nsidc.org/sea-ice-today", citation: "NSIDC/CIRES/NASA" },
    count: Object.values(checks).filter((c) => c.ok).length,
    images: checks,
  };
  const arcticLatest = resolve(outputRoot, "arctic-data", "latest.json");
  const arcticPrev = await existingJson(arcticLatest);
  let arcticChanged = true;
  if (arcticPrev && JSON.stringify(arcticPrev.images) === JSON.stringify(arcticFeed.images)) {
    arcticChanged = false;
  } else {
    await atomicJsonWrite(arcticLatest, arcticFeed);
    await mkdir(dirname(archivePath(resolve(outputRoot, "arctic-data"), collectionTime)), { recursive: true });
    await appendFile(archivePath(resolve(outputRoot, "arctic-data"), collectionTime), JSON.stringify(arcticFeed) + "\n", "utf8");
  }

  return { taiwan: { latest: taiwanLatest, feed: taiwanFeed, changed: taiwanChanged }, arctic: { latest: arcticLatest, feed: arcticFeed, changed: arcticChanged } };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const result = await collect({ outputRoot: option("output", ROOT), collectedAt: option("collected-at"), timeoutMs: option("timeout-ms", DEFAULT_TIMEOUT_MS) });
    console.log("Taiwan MND: " + (result.taiwan.changed ? "wrote " + result.taiwan.latest + " (" + result.taiwan.feed.count + " items)" : "no change")
      + "; Arctic NSIDC: " + (result.arctic.changed ? "wrote " + result.arctic.latest + " (" + result.arctic.feed.count + "/3 images ok)" : "no change"));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
