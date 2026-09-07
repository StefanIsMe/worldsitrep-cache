import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRssItems, collect } from "../scripts/collect-news.mjs";

const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Yonhap</title>`
  + `<item><title><![CDATA[N.K. destroyer commissioned]]></title><link>https://en.yna.co.kr/a/1</link><pubDate>Sun, 07 Sep 2026 06:00:00 +0900</pubDate></item>`
  + `<item><title>ROK-US-JP exercise</title><link>https://en.yna.co.kr/a/2</link><pubDate>Sun, 07 Sep 2026 05:00:00 +0900</pubDate></item>`
  + `</channel></rss>`;

const items = parseRssItems(xml, { theatre: "korea", name: "Yonhap" });
assert.equal(items.length, 2);
assert.equal(items[0].title, "N.K. destroyer commissioned");
assert.equal(items[0].theatre, "korea");
assert.ok(!("body" in items[0]) && !("content" in items[0]), "link-only: no article body");

const tmp = mkdtempSync(join(tmpdir(), "wsr-news-"));
const fixture = join(tmp, "feed.xml");
writeFileSync(fixture, xml, "utf8");
const result = await collect({ inputPath: fixture, output: join(tmp, "news-data"), collectedAt: "2026-09-07T00:00:00.000Z" });
assert.equal(result.changed, true);
assert.equal(result.feed.count, 2);
assert.equal(result.feed.schemaVersion, 1);

console.log("news rss collector tests passed");
