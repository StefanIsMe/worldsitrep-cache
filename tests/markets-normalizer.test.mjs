import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeGammaEvent, selectLiveMarkets, toProbability } from "../scripts/lib/cacheNormalizer.mjs";
import { collect } from "../scripts/collect-markets.mjs";

assert.equal(toProbability(0.183), 18.3);
assert.equal(toProbability("0.5"), 50);
assert.equal(toProbability(null), 0);

const ev = normalizeGammaEvent(
  [{ slug: "test-event", title: "Test?", markets: [{ lastTradePrice: 0.42, volume: "1234", outcomePrices: "[\"0.42\",\"0.58\"]", endDate: "2026-12-31" }] }],
  "ukraine",
);
assert.equal(ev.id, "test-event");
assert.equal(ev.theatre, "ukraine");
assert.equal(ev.url, "https://polymarket.com/event/test-event");
assert.equal(ev.probability, 42);
assert.equal(ev.closed, false);
assert.ok(!ev.url.includes("?r="), "no referral codes in market URLs");

const picked = selectLiveMarkets([
  { id: "a", closed: true, volumeNum: 999 },
  { id: "b", closed: false, volumeNum: 10 },
  { id: "c", closed: false, volumeNum: 50 },
]);
assert.deepEqual(picked.map((m) => m.id), ["c", "b"]);

const tmp = mkdtempSync(join(tmpdir(), "wsr-markets-"));
const result = await collect({ inputPath: "tests/fixtures/gamma.fixture.json", output: join(tmp, "markets-data"), collectedAt: "2026-09-07T00:00:00.000Z" });
assert.equal(result.changed, true);
assert.ok(result.feed.count > 0);
assert.equal(result.feed.schemaVersion, 1);

console.log("markets normalizer and collector tests passed");
