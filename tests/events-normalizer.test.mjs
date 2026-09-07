import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeGdeltArticle, normalizeHdxPackage } from "../scripts/lib/cacheNormalizer.mjs";
import { collect } from "../scripts/collect-events.mjs";

const n = normalizeGdeltArticle(
  { url: "https://example.com/a", title: "Test", sourceCountry: "Ukraine", seendate: "20260907T000000Z", language: "English" },
  "ukraine",
);
assert.equal(n.theatre, "ukraine");
assert.equal(n.url, "https://example.com/a");
assert.ok(!("body" in n) && !("content" in n), "link-only: no article body stored");

assert.throws(() => normalizeGdeltArticle({ title: "no url" }, "ukraine"), /url/);

const d = normalizeHdxPackage(
  { name: "ukraine-humanitarian-needs", title: "Needs", organization: { title: "OCHA" }, license_title: "CC BY 4.0", metadata_modified: "2026-09-01" },
  "ukraine",
);
assert.equal(d.url, "https://data.humdata.org/dataset/ukraine-humanitarian-needs");
assert.equal(d.license, "CC BY 4.0");

const tmp = mkdtempSync(join(tmpdir(), "wsr-events-"));
const result = await collect({ inputPath: "tests/fixtures/events.fixture.json", output: join(tmp, "events-data"), collectedAt: "2026-09-07T00:00:00.000Z" });
assert.equal(result.changed, true);
assert.ok(result.feed.count > 0);
assert.equal(result.feed.schemaVersion, 1);

console.log("events normalizer and collector tests passed");
