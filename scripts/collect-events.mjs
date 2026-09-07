#!/usr/bin/env node
// Hourly events snapshot: GDELT DOC artlist (derived metadata, link-only) +
// HDX CKAN package metadata. Free, keyless. Never mirror article bodies.
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENTS_SCHEMA_VERSION, normalizeGdeltArticle, normalizeHdxPackage } from "./lib/cacheNormalizer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = resolve(ROOT, "events-data");
const DEFAULT_TIMEOUT_MS = 20_000;
const UA = "WorldSITREP-cache-collector/1.0 (+https://worldsitrep.com)";

// GDELT DOC queries per theatre (kept narrow; derived metadata only).
export const THEATER_QUERIES = {
  ukraine: "Ukraine war",
  taiwan: "Taiwan Strait China",
  gaza: "Gaza Israel",
  iran: "Iran Hormuz",
  sahel: "Sahel Mali Niger",
  korea: "North Korea missile",
  arctic: "Greenland Arctic",
  "us-election": "United States election Trump",
};

// HDX CKAN package_search terms per theatre (metadata only).
export const THEATER_HDX_TERMS = {
  ukraine: "ukraine humanitarian",
  gaza: "gaza humanitarian",
  iran: "iran humanitarian",
  sahel: "sahel humanitarian",
};

const GDELT_DELAY_MS = 5000; // polite: GDELT has no hard limit; stay gentle
const HDX_DELAY_MS = 2000;

function option(name, fallback = null) {
  const prefix = "--" + name + "=";
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function parseTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout-ms must be a positive number");
  return timeout;
}

async function fetchJson(url, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json", "user-agent": UA } });
    if (!response.ok) throw new Error(label + " request failed with HTTP " + response.status);
    try { return await response.json(); }
    catch (error) { throw new Error(label + " returned invalid JSON: " + error.message, { cause: error }); }
  } catch (error) {
    if (error.name === "AbortError") throw new Error(label + " request timed out after " + timeoutMs + " ms");
    if (error.message.startsWith(label)) throw error;
    throw new Error(label + " request failed: " + error.message, { cause: error });
  } finally { clearTimeout(timer); }
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

function archivePath(output, collectedAt) {
  const date = new Date(collectedAt);
  if (Number.isNaN(date.getTime())) throw new Error("--collected-at must be a valid ISO date");
  return resolve(output, "archive", String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0") + ".jsonl");
}

async function existingJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function collect({ inputPath, output = DEFAULT_OUTPUT, collectedAt, timeoutMs = DEFAULT_TIMEOUT_MS, only = null } = {}) {
  const collectionTime = collectedAt || new Date().toISOString();
  const timeout = parseTimeout(timeoutMs);
  const wantGdelt = !only || only === "gdelt";
  const wantHdx = !only || only === "hdx";
  const events = [];
  if (inputPath) {
    const fixture = JSON.parse(await readFile(resolve(inputPath), "utf8"));
    for (const item of fixture.gdelt || []) {
      try { events.push({ kind: "news", ...normalizeGdeltArticle(item.article, item.theatre) }); }
      catch (error) { console.error("gdelt fixture: " + error.message); }
    }
    for (const item of fixture.hdx || []) {
      try { events.push({ kind: "dataset", ...normalizeHdxPackage(item.pkg, item.theatre) }); }
      catch (error) { console.error("hdx fixture: " + error.message); }
    }
  } else {
    if (wantGdelt) {
    for (const [theatre, query] of Object.entries(THEATER_QUERIES)) {
      try {
        const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent(query)
          + "&mode=artlist&maxrecords=10&format=json&timespan=12h";
        const payload = await fetchJson(url, timeout, "GDELT");
        const articles = Array.isArray(payload?.articles) ? payload.articles : [];
        for (const a of articles.slice(0, 10)) {
          try { events.push({ kind: "news", ...normalizeGdeltArticle(a, theatre) }); }
          catch (error) { console.error("gdelt " + theatre + ": " + error.message); }
        }
      } catch (error) { console.error("gdelt " + theatre + ": " + error.message); }
      await sleep(GDELT_DELAY_MS);
    }
    }
    if (wantHdx) {
    for (const [theatre, term] of Object.entries(THEATER_HDX_TERMS)) {
      try {
        const url = "https://data.humdata.org/api/3/action/package_search?q=" + encodeURIComponent(term) + "&rows=5";
        const payload = await fetchJson(url, timeout, "HDX");
        const pkgs = Array.isArray(payload?.result?.results) ? payload.result.results : [];
        for (const p of pkgs.slice(0, 5)) {
          try { events.push({ kind: "dataset", ...normalizeHdxPackage(p, theatre) }); }
          catch (error) { console.error("hdx " + theatre + ": " + error.message); }
        }
      } catch (error) { console.error("hdx " + theatre + ": " + error.message); }
      await sleep(HDX_DELAY_MS);
    }
    }
  }
  if (events.length === 0) throw new Error("no events collected (all fetches failed)");
  const feed = {
    schemaVersion: EVENTS_SCHEMA_VERSION,
    collectedAt: collectionTime,
    source: [
      { id: "gdelt-doc", url: "https://api.gdeltproject.org/api/v2/doc/doc" },
      { id: "hdx-ckan", url: "https://data.humdata.org/api/3/action/package_search" },
    ],
    count: events.length,
    events,
  };
  const latest = resolve(output, "latest.json");
  const previous = await existingJson(latest);
  if (previous && JSON.stringify(previous.events) === JSON.stringify(feed.events)) {
    return { latest, archive: null, feed: previous, changed: false };
  }
  await atomicJsonWrite(latest, feed);
  const archive = archivePath(output, feed.collectedAt);
  await mkdir(dirname(archive), { recursive: true });
  await appendFile(archive, JSON.stringify(feed) + "\n", "utf8");
  return { latest, archive, feed, changed: true };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const result = await collect({ inputPath: option("input"), output: option("output", DEFAULT_OUTPUT), collectedAt: option("collected-at"), timeoutMs: option("timeout-ms", DEFAULT_TIMEOUT_MS), only: option("only") });
    console.log(result.changed ? "Collected " + result.feed.count + " events; wrote " + result.latest + " and " + result.archive : "No meaningful event change; left latest/archive unchanged");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
