# World SITREP public cache data

Hourly normalized snapshots consumed by World SITREP (`worldsitrep.com`).
No website source code lives here. Free-tier only: no API keys, no paid services.

- `markets-data/latest.json` — rolling Polymarket snapshot for all 8 theatres
  (live markets only, sorted by volume, plain research links, no affiliate).
  Source: `https://gamma-api.polymarket.com/events` (free, keyless).
- `hazards-data/latest.json` — rolling USGS earthquake snapshot (M4.5+, past 24h).
  Source: `https://earthquake.usgs.gov/fdsnws/event/1/query` (free, keyless).
- `events-data/latest.json` — rolling events snapshot: HDX CKAN package metadata
  hourly + GDELT DOC artlist derived metadata when reachable (title/url/
  publisher/date only, link-only — never article bodies). NOTE: GDELT DOC is
  unreachable from GitHub Actions runners (verified 2026-09-07); the collector
  skips it by default and HDX carries the hourly snapshot. Retry manually with
  `GDELT_ENABLED=1 node scripts/collect-events.mjs`.
  Sources: `https://api.gdeltproject.org/api/v2/doc/doc`,
  `https://data.humdata.org/api/3/action/package_search` (free, keyless).
- `news-data/latest.json` — rolling news snapshot: free RSS feeds, link-only
  (title/url/date/publisher, never bodies). Current: Yonhap English (Korea).
  Source: `https://en.yna.co.kr/RSS/news.xml`.
- `<name>-data/archive/YYYY/MM/DD.jsonl` — one full envelope per collected run.

Raw feed URLs:

- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/markets-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/hazards-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/events-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/news-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/taiwan-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/arctic-data/latest.json

Schedules: `.github/workflows/collect-cache.yml` runs hourly (minute 7);
`.github/workflows/collect-daily.yml` runs daily (01:23 UTC) for Taiwan MND
PLA activities (factual counts + attribution + link back) and NSIDC Arctic
sea-ice image metadata (citation NSIDC/CIRES/NASA).
Both run unit tests first and commit only meaningful changes.

Schedule: `.github/workflows/collect-cache.yml` runs hourly (minute 7),
runs unit tests first, collects, and commits only meaningful changes.
Retention: 90 days of daily archive files, then prune.

## Local verification

node tests/markets-normalizer.test.mjs
node tests/hazards-normalizer.test.mjs
node tests/events-normalizer.test.mjs
node tests/news-rss.test.mjs
node scripts/collect-markets.mjs
node scripts/collect-hazards.mjs
node scripts/collect-events.mjs
node scripts/collect-news.mjs
node tests/daily-collectors.test.mjs
node scripts/collect-daily.mjs
