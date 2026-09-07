import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMndHub, parseMndCounts, collect } from "../scripts/collect-daily.mjs";

const hub = await readFile("tests/fixtures/mnd-hub.fixture.html", "utf8");
const items = parseMndHub(hub);
assert.ok(items.length >= 5, "hub parses list items, got " + items.length);
assert.equal(items[0].id, "87692");
assert.equal(items[0].date, "2026.09.07");
assert.ok(items[0].url.includes("/en/News/PLAAct/87692"), "absolute post URL, got " + items[0].url);
assert.ok(items[0].title.includes("PLA activities"), "title parsed");

// Structure-change tripwire: empty/garbage HTML must throw, never silent-empty
assert.throws(() => parseMndHub("<html><body>redesign</body></html>"), /structure changed/);

const post = await readFile("tests/fixtures/mnd-post.fixture.html", "utf8");
const counts = parseMndCounts(post);
assert.equal(counts.aircraftSorties, 2);
assert.equal(counts.planShips, 13);
assert.equal(counts.officialShips, 4);
assert.ok(counts.excerpt.length > 50);

const tmp = mkdtempSync(join(tmpdir(), "wsr-daily-"));
const result = await collect({ outputRoot: tmp, collectedAt: "2026-09-07T00:00:00.000Z", mndHubHtml: hub, mndPostHtml: post });
assert.equal(result.taiwan.feed.count, items.length);
assert.equal(result.taiwan.feed.latest.aircraftSorties, 2);
assert.ok(result.arctic.feed.count >= 0, "arctic tolerates offline images in tests");

console.log("daily collectors tests passed");
