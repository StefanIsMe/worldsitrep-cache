#!/usr/bin/env node
// Compact cross-theatre headline digest for the World SITREP homepage.
// Derived ONLY from the theatre live-wire snapshots already in this repo
// (<theatre>-events/latest.json, kind "news") — no network, no new sources.
// Link-only: title + url + publisher + date, never article bodies.
//
// Selection is deterministic: per theatre, keep headlines from the last 48h,
// drop obvious off-topic beats (sports, celebrity, lifestyle), rank by a
// geopolitical-relevance lexicon, then recency. The homepage list
// interleaves theatres round-robin so one busy feed cannot crowd out others.
//
// Output: headlines-data/latest.json (~40-60KB vs ~9MB for all wires).
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "headlines-data");
const SCHEMA_VERSION = 1;
const WINDOW_MS = 48 * 3600 * 1000;
const PER_THEATRE = 8;
const GLOBAL_MAX = 48;

export const THEATRES = [
  "ukraine", "taiwan", "gaza", "iran", "sahel", "korea", "arctic",
  "us-election", "houthis", "myanmar", "france",
];

// Lexicons, matched case-insensitively against the title on word
// boundaries. A trailing "*" marks a stem ("negotiat*" hits negotiation).
const RELEVANT = [
  "missile*", "drone*", "strike", "strikes", "attack*", "troop*", "military", "army", "navy", "naval",
  "ceasefire*", "truce", "peace", "talks", "negotiat*", "sanction*", "nuclear",
  "invasion", "invade*", "offensive", "fighting", "clash*", "frontline*", "border*", "war", "wars", "killed", "kills", "shelling",
  "president", "minister*", "government", "parliament*", "election*", "vote*", "voter*",
  "summit", "diplomat*", "embassy", "treaty", "nato", "un", "u.n.", "security council",
  "coup", "junta", "rebel*", "militia*", "hostage*", "blockade*", "shipping",
  "tanker*", "strait", "pla", "drill*", "intercept*", "air defen*",
  "refugee*", "humanitarian", "aid", "tariff*", "oil", "gas", "energy",
  "protest*", "crackdown", "arrest*", "intelligence", "spy", "spies", "cyber*", "weapon*",
  "icbm", "satellite*", "occupied", "annex*", "sovereignty", "frigate*", "warship*", "airstrike*",
];
const OFF_TOPIC = [
  "baseball", "kbo", "postseason", "football", "soccer", "nba", "nfl", "mlb",
  "golf", "tennis", "olympic*", "world cup", "league", "playoff*", "box office",
  "k-pop", "kpop", "idol*", "celebrit*", "recipe*", "fashion", "concert*", "album*",
  "horoscope*", "archaeology", "museum*", "festival*", "tourism", "slugger*",
  "homer*", "pitcher*", "transfer window", "derby", "deepfake sex",
];

function lexiconRegex(words) {
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = words.map((w) => (w.endsWith("*") ? esc(w.slice(0, -1)) + "[a-z]*" : esc(w)));
  return new RegExp("(?<![a-z])(?:" + parts.join("|") + ")(?![a-z])", "gi");
}
const RELEVANT_RE = lexiconRegex(RELEVANT);
const OFF_TOPIC_RE = lexiconRegex(OFF_TOPIC);

const ENTITIES = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };

export function decodeEntities(text) {
  return String(text || "")
    .replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Wire news descriptions read "Title (Publisher, YYYY-MM-DD. Headline + link only.)". */
export function titleFromDescription(description) {
  const raw = decodeEntities(description).replace(/\s+/g, " ").trim();
  const stripped = raw.replace(/\s*\([^()]*\d{4}-\d{2}-\d{2}\.\s*Headline \+ link only\.\)\s*$/i, "").trim();
  // Google News titles carry a trailing " - Outlet"; the outlet is already in `source`.
  return stripped.replace(/\s+-\s+[^-]{2,60}$/, "").trim();
}

export function relevanceScore(title) {
  const t = String(title || "");
  OFF_TOPIC_RE.lastIndex = 0;
  if (OFF_TOPIC_RE.test(t)) return -1;
  const hits = new Set((t.match(RELEVANT_RE) || []).map((m) => m.toLowerCase()));
  return Math.min(hits.size, 4);
}

function normKey(title) {
  return title.toLowerCase().replace(/^\(lead\)\s*/, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}

export function selectTheatre(theatre, events, now = Date.now()) {
  const seen = new Set();
  const rows = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.kind !== "news" || !e.sourceUrl) continue;
    const at = Date.parse(e.isoDate || e.date || "");
    if (!Number.isFinite(at) || now - at > WINDOW_MS || at - now > 3600 * 1000) continue;
    const title = titleFromDescription(e.description);
    if (title.length < 12) continue;
    const key = normKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const relevance = relevanceScore(title);
    if (relevance < 0) continue;
    rows.push({
      id: String(e.id),
      theatre,
      title,
      url: e.sourceUrl,
      publisher: decodeEntities(e.source || e.actor || "Wire"),
      publishedAt: new Date(at).toISOString(),
      relevance,
    });
  }
  // Strong matches (2+ distinct terms) first, then single hits, then the
  // rest — newest first within each band.
  const band = (r) => Math.min(r.relevance, 2);
  rows.sort((a, b) => (band(b) - band(a)) || b.publishedAt.localeCompare(a.publishedAt));
  return rows.slice(0, PER_THEATRE);
}

/** Round-robin interleave (each theatre's list is already ranked). */
export function interleave(lists, max = GLOBAL_MAX) {
  const out = [];
  const seen = new Set();
  const queues = lists.map((l) => [...l]);
  while (out.length < max && queues.some((q) => q.length)) {
    for (const q of queues) {
      // Feeds overlap (a Myanmar story in an Asia feed): first theatre wins.
      while (q.length && seen.has(normKey(q[0].title || ""))) q.shift();
      if (q.length && out.length < max) {
        const row = q.shift();
        seen.add(normKey(row.title || ""));
        out.push(row);
      }
    }
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function main() {
  const now = Date.now();
  const theatres = {};
  const lists = [];
  for (const id of THEATRES) {
    const file = resolve(ROOT, `${id}-events`, "latest.json");
    if (!existsSync(file)) {
      theatres[id] = { status: "missing", count: 0, items: [] };
      continue;
    }
    try {
      const env = JSON.parse(await readFile(file, "utf8"));
      const items = selectTheatre(id, env.events || env.items, now);
      theatres[id] = { status: "ok", wireCollectedAt: env.collectedAt || null, count: items.length, items };
      lists.push(items);
    } catch (error) {
      theatres[id] = { status: "error", error: String(error?.message || error).slice(0, 200), count: 0, items: [] };
    }
  }
  const items = interleave(lists);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    collectedAt: new Date(now).toISOString(),
    source: { id: "theatre-wires", url: "https://github.com/StefanIsMe/worldsitrep-cache" },
    windowHours: WINDOW_MS / 3600000,
    count: items.length,
    items,
    theatres,
  };
  await mkdir(OUT_DIR, { recursive: true });
  const target = resolve(OUT_DIR, "latest.json");
  const tmp = target + ".tmp";
  await writeFile(tmp, JSON.stringify(payload, null, 1) + "\n");
  await rename(tmp, target);
  console.log(`headlines: ${items.length} items across ${lists.filter((l) => l.length).length} theatres`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
