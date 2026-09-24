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
- `ukraine-events/latest.json` — rolling Ukraine live-wire feed (72h events/news,
  14d assessments/reports, cap 1500, newest first). Records match the site's
  event schema: GDELT rows carry machine-geocoded coords (`approximate` tier);
  headlines/assessments/reports are feed-only (`unplaced`, never invented
  coords). Envelope also carries per-source statuses.
  (No DeepState calls of any kind: API access denied Sep 2026 — see source policy.)
  Sources: GDELT 2.1 export CSV (`https://data.gdeltproject.org/gdeltv2/`,
  ActionGeo UP + conflict QuadClass, derived metadata only), Kyiv Independent
  RSS, Ukrainska Pravda English RSS, Google News RSS x2 (headlines + outlet +
  links only), ISW assessments via their WordPress JSON API (title/link/date
  only), ReliefWeb API v2 reports+disasters (only when the free
  `RELIEFWEB_APPNAME` Actions secret is set — request one at
  `https://apidoc.reliefweb.int/parameters#appname`).
  Headlines gain map coordinates in the Actions run itself: a curated
  Ukraine-war gazetteer (`scripts/lib/ukraineGazetteer.mjs`, same points as
  the site's curated archive) matches places first, then OSM Nominatim
  resolves verb-triggered candidates for the residue (budgeted, cached in
  `ukraine-events/geocode-cache.json`, Ukraine + European-Russia only —
  never invented, never Siberia). Everything placed is `approximate` tier
  with the match in `coordsNote`; placeless headlines and theatre-wide
  assessments honestly stay `unplaced`. The stage runs over the merged set,
  so previously collected items gain coords on later runs too.
- `territory-daily/latest.json` — rolling Ukraine territory-control snapshot:
  slim normalized status polygons (`detailedPolygons` in the site's
  `[lat,lng]` shape) in three classes, ALL automated (no hand-drawn lines):
  Occupied (assessed, from the public mirror), Friendly (derived — the
  pinned open Ukraine boundary as an underlay, so un-occupied ground reads
  as Ukrainian-held), Unknown (derived — recent combat-reporting clusters
  auto-surfaced as labelled-unverified circles near the contact line).
  Every polygon carries `src` provenance (`mirror` / `boundary-derived` /
  `news-derived`); the envelope carries `snapshotId` (yyyymmdd),
  `snapshotDate`, `collectedAt`, `contentHash` (change detection — derived
  legs refresh without moving the mirror id), per-class `census` (count +
  as-of + source), mirror provenance (`source` + `sourceUrl`), upstream
  attribution (`upstreamUrl`) and `licenseUrl` on every snapshot.
  Day segments live at `territory-daily/days/YYYY/MM/DD.json` (day's
  latest snapshot + `snapshots` id list, kept forever).
  Sources: (1) the public cyterat mirror's per-day GeoJSON (GitHub raw,
  ~04:13 UTC with a 3-day gap cascade — zero direct DeepStateMap calls;
  API access denied); (2) `data/territory/boundary-ukraine.geojson`, the
  pinned geoBoundaries Ukraine ADM0 boundary (OpenStreetMap contributors,
  ODbL — attribution in `data/territory/boundary-meta.json`), refreshed
  automatically when the pin is older than 180 days; (3) the live wire's
  `zone-proposals/latest.json` for the Unknown class.
  History before Sep 2026 is a weekly (Monday) occupied-only backfill from
  the `cyterat` mirror (`scripts/backfill-territory.mjs`, one-shot,
  committed Sep 2026): 114 Mondays from 2024-07-08, gaps 2024-08-19 +
  2025-03-31 (mirror 404s), each file flagged `partial: true` with mirror
  provenance.
- `zone-proposals/latest.json` — zone proposals from recent placed live-wire
  events (7d window) clustered by oblast (`scripts/lib/ukraineOblasts.mjs`
  centers, ids matching the site's `zones.json`), zones with 3+ events,
  kind breakdown + sample source links + per-zone `centroid`, `radiusKm`
  (event spread, clamped 15–80 km), `combatCount`, `tierCounts` and
  `newestIsoDate`. Two consumers: the site's "unverified" zone-popup line
  (a human promotes these to curated zone history — nothing auto-morphs)
  and the territory collector's Unknown class (proposals with 2+ combat /
  strike signals within 120 km of the contact line auto-surface as
  labelled-unverified circles; rear-area reporting is counted as gated,
  not drawn). Clustering drops two noise classes, counted on the envelope:
  country-level GDELT rows (`coarseGdeltDropped` — geoType 1 pins on the
  country centroid) and out-of-theatre pins (`outsideTheatreDropped` —
  e.g. "Moscow says …" datelines geocoded to Moscow).
- Warehouse history (nothing is ever pruned):
  - `ukraine-events/days/YYYY/MM/DD.json` — immutable day segments: every record
    whose UTC date is that day (full records, deduped by id). Runs only ever
    append new ids; `ukraine-events/index.json` lists day counts by kind.
    The old `ukraine-events/archive/` full-envelope dumps are frozen legacy.
  - `<name>-data/archive/YYYY/MM/DD.jsonl` (markets, hazards, events, news,
    taiwan, arctic) — one full envelope per changed run, kept forever.
  - `commercial-data/shards/<lat>-<lon>.json` + `global-vessel-data/shards/`
    — regional shards on a fixed 4x4 macro grid (45d lat x 90d lon, cells
    `0-0`..`3-3`) with per-dataset `index.json` (bbox + counts), so clients
    fetch only the cells in view instead of the multi-MB global files (which
    are still written for compatibility). `maritime-data` stays whole: it is
    Baltic-only, a single region by construction.

Source policy: ACLED is intentionally NOT collected (its EULA forbids
redistribution). ZERO direct DeepStateMap.live calls of any kind: API access
was denied (Sep 2026), so the former status-signal poll is removed and the
territory collector reads only the public cyterat mirror (GitHub raw). No
HTML scraping either (bot-walled — no bypass attempted). Every snapshot keeps
mirror provenance + upstream attribution + the license link (`https://deepstatemap.live/license-en.html`), and if DeepState asks us to stop, the mirror-sourced collector is disabled the same day.

Deliberately NOT ingested (researched Sep 2026, blocked on permission/keys):
ISW's public ArcGIS feature services (assessed Russian control, advances,
claimed counteroffensives — technically queryable as GeoJSON, but ISW's Fair
Use & Attribution Policy requires prior written permission before their
materials go into another mapping platform, so they stay out until that
permission is granted — ask at understandingwar.org, then plug the layer
queries into `scripts/collect-territory.mjs` as assessed Unknown/Friendly
legs); NASA FIRMS fire points (would need a free FIRMS MAP_KEY Actions
secret — a possible future sensor leg for the Unknown class). Neither gap
needs hand-drawn lines: the derived legs above keep all three classes fresh
without them.

Raw feed URLs:

- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/markets-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/hazards-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/events-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/news-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/taiwan-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/arctic-data/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/ukraine-events/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/ukraine-events/status.json (run-liveness record: checkedAt + per-source health)
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/ukraine-events/index.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/ukraine-events/days/2026/09/22.json (day segments: days/YYYY/MM/DD.json)
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/territory-daily/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/territory-daily/status.json (run-liveness record: checkedAt + snapshot id + per-class census)
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/territory-daily/index.json (timeline day list for the site scrubber)
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/zone-proposals/latest.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/commercial-data/index.json
- https://raw.githubusercontent.com/StefanIsMe/worldsitrep-cache/main/global-vessel-data/index.json (needs AISSTREAM_API_KEY; stale without it)

Schedules: `.github/workflows/collect-cache.yml` runs hourly (minute 7);
`.github/workflows/collect-daily.yml` runs daily (01:23 UTC) for Taiwan MND
PLA activities (factual counts + attribution + link back) and NSIDC Arctic
sea-ice image metadata (citation NSIDC/CIRES/NASA).
`.github/workflows/collect-ukraine-events.yml` runs hourly (minute 37) for
the Ukraine live-wire feed.
`.github/workflows/collect-territory.yml` runs daily (04:13 UTC, after the mirror's ~03:00 UTC refresh) for the Ukraine territory snapshot; the watchdog also heals it inline when `territory-daily/latest.json` is older than 30h.
`.github/workflows/collect-traffic.yml` runs twice hourly (minutes 17, 47).
`.github/workflows/check-freshness.yml` (watchdog) runs every 30 minutes and
collects inline for whichever snapshot groups are stale. All run unit tests
first and commit only meaningful snapshot changes.

GitHub treats schedules as best-effort: in September 2026 the hourly jobs
here were observed running only every 3-6h. Three mitigations keep data
fresh anyway: (1) the watchdog above, so the union of schedules heals gaps;
(2) gap-covering lookbacks — the Ukraine collector re-reads every GDELT
15-min slot since the previous run (capped at 48 windows / 12h) and RSS
feeds keep 50 items of catch-up headroom, so any run backfills what skipped
runs missed; (3) `ukraine-events/status.json` (raw URL below) is rewritten
on every run with `checkedAt` even when nothing changed, so monitors can
tell "checked, quiet" apart from "never ran".
Retention: forever — the prune jobs were removed in September 2026. History
is an asset for analysis and SEO; GitHub's practical limits (100MB per file,
~5GB per repo) are nowhere in sight at current volumes.

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
node tests/ukraine-events.test.mjs
node tests/freshness-gate.test.mjs
node tests/geo-shard.test.mjs
node scripts/collect-ukraine-events.mjs
node tests/territory-normalizer.test.mjs
node scripts/collect-territory.mjs --output-dir=$TMP/terr (live mirror fetch; --input=file [--date=...] for offline replay)
node tests/no-direct-deepstate.test.mjs
node tests/zone-proposals.test.mjs
node scripts/build-zone-proposals.mjs
