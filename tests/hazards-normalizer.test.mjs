import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeUsgsFeature } from "../scripts/lib/cacheNormalizer.mjs";
import { collect } from "../scripts/collect-hazards.mjs";

const q = normalizeUsgsFeature({
  id: "us7000test",
  properties: { mag: 5, place: "Kermadec Islands region", time: 1788746808371, url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test", tsunami: 0 },
  geometry: { type: "Point", coordinates: [178.5443, -30.9663, 585.146] },
});
assert.equal(q.id, "us7000test");
assert.equal(q.lat, -30.9663);
assert.equal(q.lng, 178.5443);
assert.equal(q.tsunami, false);

assert.throws(() => normalizeUsgsFeature({ properties: {}, geometry: null }), /coordinates/);

const tmp = mkdtempSync(join(tmpdir(), "wsr-hazards-"));
const result = await collect({ inputPath: "tests/fixtures/usgs.fixture.json", output: join(tmp, "hazards-data"), collectedAt: "2026-09-07T00:00:00.000Z" });
assert.equal(result.changed, true);
assert.ok(result.feed.count > 0);
assert.equal(result.feed.schemaVersion, 1);

console.log("hazards normalizer and collector tests passed");
