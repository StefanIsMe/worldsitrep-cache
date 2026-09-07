#!/usr/bin/env node
// Hourly USGS earthquake snapshot (M4.5+, past 24h). Free, keyless.
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HAZARDS_SCHEMA_VERSION, normalizeUsgsFeature } from "./lib/cacheNormalizer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = resolve(ROOT, "hazards-data");
const DEFAULT_TIMEOUT_MS = 15_000;
const UA = "WorldSITREP-cache-collector/1.0 (+https://worldsitrep.com)";
const USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=4.5&limit=50&orderby=time";

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

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json", "user-agent": UA } });
    if (!response.ok) throw new Error("USGS request failed with HTTP " + response.status);
    try { return await response.json(); }
    catch (error) { throw new Error("USGS returned invalid JSON: " + error.message, { cause: error }); }
  } catch (error) {
    if (error.name === "AbortError") throw new Error("USGS request timed out after " + timeoutMs + " ms");
    if (error.message.startsWith("USGS")) throw error;
    throw new Error("USGS request failed: " + error.message, { cause: error });
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

export async function collect({ inputPath, output = DEFAULT_OUTPUT, collectedAt, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const collectionTime = collectedAt || new Date().toISOString();
  const timeout = parseTimeout(timeoutMs);
  const payload = inputPath ? JSON.parse(await readFile(resolve(inputPath), "utf8")) : await fetchJson(USGS_URL, timeout);
  const features = Array.isArray(payload?.features) ? payload.features : [];
  if (features.length === 0) throw new Error("no quakes collected (empty feature list)");
  const quakes = [];
  for (const f of features) {
    try { quakes.push(normalizeUsgsFeature(f)); }
    catch (error) { console.error("quake skipped: " + error.message); }
  }
  quakes.sort((a, b) => (b.time || "").localeCompare(a.time || ""));
  const feed = {
    schemaVersion: HAZARDS_SCHEMA_VERSION,
    collectedAt: collectionTime,
    source: { id: "usgs", url: "https://earthquake.usgs.gov/fdsnws/event/1/query" },
    count: quakes.length,
    quakes,
  };
  const latest = resolve(output, "latest.json");
  const previous = await existingJson(latest);
  if (previous && JSON.stringify(previous.quakes) === JSON.stringify(feed.quakes)) {
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
    const result = await collect({ inputPath: option("input"), output: option("output", DEFAULT_OUTPUT), collectedAt: option("collected-at"), timeoutMs: option("timeout-ms", DEFAULT_TIMEOUT_MS) });
    console.log(result.changed ? "Collected " + result.feed.count + " quakes; wrote " + result.latest + " and " + result.archive : "No meaningful quake change; left latest/archive unchanged");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
