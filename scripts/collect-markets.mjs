#!/usr/bin/env node
// Hourly Polymarket snapshot for all theatres. Free, keyless. Plain links, no affiliate.
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKETS_SCHEMA_VERSION, normalizeGammaEvent, selectLiveMarkets } from "./lib/cacheNormalizer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = resolve(ROOT, "markets-data");
const DEFAULT_TIMEOUT_MS = 15_000;
const SLUG_DELAY_MS = 250;
const UA = "WorldSITREP-cache-collector/1.0 (+https://worldsitrep.com)";

export const THEATER_SLUGS = {
  ukraine: [
    "russia-x-ukraine-ceasefire-by",
    "russia-x-ukraine-ceasefire-agreement-by",
    "russia-x-ukraine-peace-talks-byptptpt-20260609012540716",
    "russia-x-ukraine-any-diplomatic-meeting-byptptpt-20260819",
    "putin-out-before-2027",
  ],
  taiwan: ["will-china-invade-taiwan-before-2027", "will-china-invade-taiwan-by-december-31-2027"],
  gaza: ["israel-x-hamas-ceasefire-phase-ii-by-october-31"],
  iran: ["will-the-us-invade-iran-before-2027"],
  korea: [
    "will-north-and-south-korea-engage-in-direct-talks-by-2027",
    "kim-jong-un-out-as-supreme-leader-of-north-korea-before-2027",
  ],
  arctic: ["will-trump-acquire-greenland-before-2027", "will-the-us-acquire-any-part-of-greenland-in-2026", "will-the-us-invade-greenland-in-2026"],
  "us-election": [
    "who-will-trump-endorse-first-in-the-2028-us-presidential-election-20260727202224755",
    "will-aoc-announce-a-run-for-senate-or-president-before-2028",
  ],
};

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
    if (!response.ok) throw new Error("Gamma request failed with HTTP " + response.status);
    try { return await response.json(); }
    catch (error) { throw new Error("Gamma returned invalid JSON: " + error.message, { cause: error }); }
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Gamma request timed out after " + timeoutMs + " ms");
    if (error.message.startsWith("Gamma")) throw error;
    throw new Error("Gamma request failed: " + error.message, { cause: error });
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
  let markets = [];
  if (inputPath) {
    const fixture = JSON.parse(await readFile(resolve(inputPath), "utf8"));
    for (const [theatre, payload] of Object.entries(fixture)) {
      try { markets.push(normalizeGammaEvent(payload, theatre)); }
      catch (error) { console.error("fixture " + theatre + ": " + error.message); }
    }
  } else {
    for (const [theatre, slugs] of Object.entries(THEATER_SLUGS)) {
      for (const slug of slugs) {
        try {
          const payload = await fetchJson("https://gamma-api.polymarket.com/events?slug=" + encodeURIComponent(slug), timeout);
          markets.push(normalizeGammaEvent(payload, theatre));
        } catch (error) { console.error(slug + ": " + error.message); }
        await new Promise((r) => setTimeout(r, SLUG_DELAY_MS));
      }
    }
  }
  if (markets.length === 0) throw new Error("no markets collected (all fetches failed)");
  const selected = selectLiveMarkets(markets);
  const feed = {
    schemaVersion: MARKETS_SCHEMA_VERSION,
    collectedAt: collectionTime,
    source: { id: "polymarket-gamma", url: "https://gamma-api.polymarket.com/events" },
    count: selected.length,
    markets: selected,
  };
  const latest = resolve(output, "latest.json");
  const previous = await existingJson(latest);
  if (previous && JSON.stringify(previous.markets) === JSON.stringify(feed.markets)) {
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
    console.log(result.changed ? "Collected " + result.feed.count + " markets; wrote " + result.latest + " and " + result.archive : "No meaningful market change; left latest/archive unchanged");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
