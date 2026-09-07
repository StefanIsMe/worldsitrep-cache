# World SITREP public cache data

Hourly normalized snapshots consumed by World SITREP (`worldsitrep.com`).
No website source code lives here. Free-tier only: no API keys, no paid services.

- `markets-data/latest.json` — rolling Polymarket snapshot for all 8 theatres
  (live markets only, sorted by volume, plain research links, no affiliate).
  Source: `https://gamma-api.polymarket.com/events` (free, keyless).
- `hazards-data/latest.json` — rolling USGS earthquake snapshot (M4.5+, past 24h).
  Source: `https://earthquake.usgs.gov/fdsnws/event/1/query` (free, keyless).
- `<name>-data/archive/YYYY/MM/DD.jsonl` — one full envelope per collected run.

Raw feed URLs:

- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/markets-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/hazards-data/latest.json

Schedule: `.github/workflows/collect-cache.yml` runs hourly (minute 7),
runs unit tests first, collects, and commits only meaningful changes.
Retention: 90 days of daily archive files, then prune.

## Local verification

node tests/markets-normalizer.test.mjs
node tests/hazards-normalizer.test.mjs
node scripts/collect-markets.mjs
node scripts/collect-hazards.mjs
