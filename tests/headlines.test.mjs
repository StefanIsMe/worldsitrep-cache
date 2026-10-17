import assert from "node:assert/strict";
import { titleFromDescription, relevanceScore, selectTheatre, interleave, decodeEntities } from "../scripts/build-headlines.mjs";

assert.equal(
  titleFromDescription("Iran rejects pressure, remains open to dialogue: Araghchi (IRNA English, 2026-10-17. Headline + link only.)"),
  "Iran rejects pressure, remains open to dialogue: Araghchi",
);
assert.equal(titleFromDescription("Drone hits port - Reuters (Google News, 2026-10-17. Headline + link only.)"), "Drone hits port");
assert.equal(decodeEntities("U.S. News &amp; World"), "U.S. News & World");

assert.ok(relevanceScore("Russian missile strike hits Odesa port") > 0);
assert.equal(relevanceScore("Tigers defeat Twins to open KBO postseason series"), -1);
assert.equal(relevanceScore("Lee pays tribute to firefighter"), 0);

const now = Date.parse("2026-10-17T12:00:00Z");
const ev = (id, title, iso, kind = "news") => ({ id, kind, isoDate: iso, description: `${title} (X, 2026-10-17. Headline + link only.)`, source: "X", sourceUrl: `https://x.test/${id}` });
const picked = selectTheatre("korea", [
  ev("a", "Slugger homers in KBO postseason", "2026-10-17T11:00:00Z"),
  ev("b", "Lee pays tribute to firefighters", "2026-10-17T11:30:00Z"),
  ev("c", "North Korea fires ballistic missile", "2026-10-17T09:00:00Z"),
  ev("d", "North Korea fires ballistic missile", "2026-10-17T08:00:00Z"),
  ev("e", "Old missile story", "2026-10-10T08:00:00Z"),
  ev("f", "Event row", "2026-10-17T11:00:00Z", "event"),
], now);
assert.deepEqual(picked.map((p) => p.id), ["c", "b"], "relevant first, dedupe, drop sports/old/non-news");

const mixed = interleave([[{ title: "a", publishedAt: "3" }, { title: "b", publishedAt: "1" }], [{ title: "c", publishedAt: "2" }, { title: "a", publishedAt: "0" }]], 9);
assert.equal(mixed.length, 3, "cross-theatre duplicate dropped");
assert.deepEqual(mixed.map((m) => m.publishedAt), ["3", "2", "1"], "round-robin keeps every theatre represented");
console.log("headlines tests passed");
