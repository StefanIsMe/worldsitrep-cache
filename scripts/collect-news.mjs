#!/usr/bin/env node
// Hourly news snapshot: free RSS feeds (link-only: title/url/date/publisher,
// never article bodies). Free, keyless.
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = resolve(ROOT, "news-data");
const DEFAULT_TIMEOUT_MS = 20_000;
const UA = "WorldSITREP-cache-collector/1.0 (+https://worldsitrep.com)";
const SCHEMA_VERSION = 1;

// Verified live 2026-09-07. License: headlines+links+dates only.
export const RSS_FEEDS = [
  { theatre: "korea", name: "Yonhap", url: "https://en.yna.co.kr/RSS/news.xml" },
];

const FEED_DELAY_MS = 2000;
const MAX_ITEMS_PER_FEED = 15;

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

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": UA } });
    if (!response.ok) throw new Error("RSS request failed with HTTP " + response.status);
    return await response.text();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("RSS request timed out after " + timeoutMs + " ms");
    if (error.message.startsWith("RSS")) throw error;
    throw new Error("RSS request failed: " + error.message, { cause: error });
  } finally { clearTimeout(timer); }
}

function unescapeXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .trim();
}

function pickTag(block, tags) {
  for (const t of tags) {
    const m = block.match(new RegExp("<" + t + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + t + ">", "i"));
    if (m) return unescapeXml(m[1]);
  }
  return null;
}

/** Minimal RSS/Atom item parser (no dependencies). Link-only fields. */
export function parseRssItems(xml, feed) {
  const blocks = [];
  const itemRe = /<(item|entry)[\s>][\s\S]*?<\/\1>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) blocks.push(m[0]);
  const items = [];
  for (const b of blocks.slice(0, MAX_ITEMS_PER_FEED)) {
    let url = pickTag(b, ["link"]);
    if (!url) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (href) url = href[1].trim();
    }
    if (!url) continue;
    const title = pickTag(b, ["title"]) || url;
    const rawDate = pickTag(b, ["pubDate", "published", "updated", "dc:date"]);
    let publishedAt = null;
    if (rawDate) {
      const t = Date.parse(rawDate);
      if (Number.isFinite(t)) publishedAt = new Date(t).toISOString();
    }
    items.push({
      id: url,
      theatre: feed.theatre,
      title,
      url,
      publisher: feed.name,
      publishedAt,
    });
  }
  return items;
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

export async function collect({ inputPath, inputIsUrl, output = DEFAULT_OUTPUT, collectedAt, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const collectionTime = collectedAt || new Date().toISOString();
  const timeout = parseTimeout(timeoutMs);
  const items = [];
  if (inputPath) {
    const xml = await readFile(resolve(inputPath), "utf8");
    const feed = { theatre: "korea", name: "Yonhap" };
    items.push(...parseRssItems(xml, feed).map((i) => ({ kind: "news", ...i })));
  } else if (inputIsUrl) {
    const xml = await fetchText(inputIsUrl, timeout);
    items.push(...parseRssItems(xml, { theatre: "korea", name: "Yonhap" }).map((i) => ({ kind: "news", ...i })));
  } else {
    for (const feed of RSS_FEEDS) {
      try {
        const xml = await fetchText(feed.url, timeout);
        items.push(...parseRssItems(xml, feed).map((i) => ({ kind: "news", ...i })));
      } catch (error) { console.error("rss " + feed.theatre + ": " + error.message); }
      await sleep(FEED_DELAY_MS);
    }
  }
  if (items.length === 0) throw new Error("no news collected (all fetches failed)");
  const feed = {
    schemaVersion: SCHEMA_VERSION,
    collectedAt: collectionTime,
    source: RSS_FEEDS.map((f) => ({ id: f.name.toLowerCase(), url: f.url })),
    count: items.length,
    items,
  };
  const latest = resolve(output, "latest.json");
  const previous = await existingJson(latest);
  if (previous && JSON.stringify(previous.items) === JSON.stringify(feed.items)) {
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
    const result = await collect({ inputPath: option("input"), inputIsUrl: option("url"), output: option("output", DEFAULT_OUTPUT), collectedAt: option("collected-at"), timeoutMs: option("timeout-ms", DEFAULT_TIMEOUT_MS) });
    console.log(result.changed ? "Collected " + result.feed.count + " news; wrote " + result.latest + " and " + result.archive : "No meaningful news change; left latest/archive unchanged");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
