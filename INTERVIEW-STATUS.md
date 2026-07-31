# Azzuro trial - interview status

## Short update to send

- I finished the accuracy-first Booking review collector and connected it to a
  single local SQLite database.
- Olympic Paddington (12), Potts Point (2,516), and Darling Harbour (4,248)
  passed two complete opposite-order collections with exact IDs and review
  content, giving 6,776 verified reviews.
- Central Sydney is still pending verification. The verified diagnostic baseline
  was 2,537 advertised versus 2,536 retrievable, with the one-review difference
  in the 5-7 bucket. The strict exception now validates the current live totals
  dynamically while refusing anything below that baseline or anything other
  than the same exact one-review shape. It still cannot publish without a full
  qualifying live run. The current SQLite database therefore still has 0
  Central rows.
- I built the operations dashboard with separate pages for overview, trends,
  properties, review insights, full reviews, and data quality.
- It includes current-week versus matched previous-week rating, property
  comparisons, sentiment and volume trends, score distribution, response rate,
  full review reading, and advanced filters.
- I added Booking's exact property category scores (Staff, Facilities,
  Cleanliness, Comfort, Value, Location, and Free Wifi where available).
- I added an animated fixed 0-10 comparison chart for those Booking categories
  across the accepted properties. Missing scores stay blank, Central is
  explicitly omitted while unpublished, and an exact accessible table backs the
  visual chart.
- I made all eight operational topic filters visible above the review feed, so
  Cleanliness and the other topics are no longer hidden in the filter panel.
- Review insights are deterministic and explainable. Each label retains the
  phrase that caused the match, and unmatched reviews are not forced into a
  topic.
- I fixed the apparently blank all-zero Insights chart. It now shows a clear
  no-topic-match explanation, and classifier `1.0.1` no longer treats explicit
  "no issues" wording in Booking's negative field as a complaint. Unsupported
  languages remain visibly unclassified instead of being guessed.
- I added subtle chart/card animations and reduced-motion support.
- I made the package portable: defaults resolve from the extracted project,
  the collector uses installed Playwright Chromium unless Chrome is explicitly
  selected, and the combined app launcher works across supported platforms.
- I removed the misleading **Collection in progress** label. The header now
  reports **3 of 4 properties verified**, and the interface explains that this
  is publication coverage rather than an active scraper indicator.
- I defined the accepted Central state clearly: once a qualifying `source-gap`
  run is published it counts as verified and is labelled exactly **Verified
  with 1-review disclosure**, while the amber badge remains visible. Central
  has not reached that state in the included database.
- I tested the complete scraper/backend suite: 224 tests, 218 passed, 0 failed,
  6 optional checks skipped because they require the original private HAR
  files.
- Lint, TypeScript, production build, rendered tests, API checks, and live
  Chrome interaction checks all pass.
- I generated sample JSONL/CSV data. The current source credential scan covered
  113 files (1,727,671 bytes) with zero sensitive-content or sensitive-filename
  matches. The rebuilt release was extracted into a clean folder and passed all
  root/dashboard tests plus SQLite, allowlist, checksum, and secret checks.

## What was checked in the last hour

- Fixed matched week-to-date comparisons so a partial current week is never
  compared with a full previous week.
- Kept overview, trends, property metrics, topic metrics, and drill-downs on one
  consistent property/date corpus.
- Verified that the dashboard never invents "mixed" sentiment as a residual.
- Verified that a topic percentage uses reviews containing negative feedback
  as the denominator.
- Added strict revalidation before the known Central source-gap status can be
  shown as **Verified with 1-review disclosure**; the accepted disclosure stays
  amber and counts toward verified publication coverage.
- Made Central's one-review exception follow later live totals instead of
  freezing 2,537 forever, while retaining 2,537 and the 323 target bucket as
  independently verified minimum baselines.
- Confirmed a refresh reruns the full two-pass proof, matches stable review IDs,
  inserts only new rows, versions edits, detects removals, and cannot publish a
  duplicate or partial inventory.
- Confirmed scrape progress is printed during both passes. A normal or forced
  stop leaves the previous accepted generation intact; rerunning starts a clean
  proof rather than trusting an interrupted partial crawl.
- Confirmed the dashboard reload button only refetches accepted SQLite data and
  does not silently start a Booking scrape.
- Added a collapsible desktop sidebar: it becomes an 86px labelled icon rail,
  retains the active section marker, and expands back in place. I also reduced
  the shared desktop card gutter from 48px maximum to 32px, so the dashboard
  uses the available width more efficiently.
- Confirmed Olympic category values in the live UI: 9.4 Staff, 9.2 Facilities,
  9.4 Cleanliness, 9.4 Comfort, 9.6 Value, and 9.4 Location.
- Confirmed the new source-category comparison plots Olympic, Potts Point, and
  Darling Harbour exactly, marks Olympic Free Wifi as not published, and does
  not turn Central's missing source evidence into a zero.
- Confirmed the visible Cleanliness filter reduces 6,776 reviews to 1,062
  matching reviews and persists in the URL.
- Opened and closed a full review with the keyboard.
- Checked all six dashboard pages and all four property confidence rows.
- Confirmed pending-publication wording is consistent in the header, filters,
  Properties, and Data quality workspaces; dashboard lint, TypeScript, build,
  and 2/2 rendered regression checks passed after the change.
- Checked in Chrome that a zero-signal Insights period now shows the explanatory
  empty state rather than empty axes, and that the topic cards and drill-downs
  remain available.
- Checked local API health, CORS, validation errors, and warm response time.
- Reran all 224 root tests in the current source, plus dashboard lint,
  TypeScript, the production build, and 2/2 rendered tests.
- Verified API health `200`, contract version 1, JSON/no-store/nosniff headers,
  invalid date `400`, unsupported POST `405`, unknown route `404`, and SQLite
  integrity `ok`.
- Verified the date-scoped review feed returns 11 reviews for 27-31 July while
  the unfiltered accepted feed contains 6,776. Review-feed dates remain
  intentionally separate from the global reporting-period filters.
- Verified the packaged SQLite database is internally sound and still contains
  the exact 12 + 2,516 + 4,248 accepted reviews.
- Verified the package excludes dependencies, build output, HARs, logs,
  environment files, browser state, credentials, and session data.
- Verified a fresh package extraction against matching dependency lockfiles:
  224 root tests, dashboard lint, TypeScript, production build, and 2/2 rendered
  checks passed. This restricted runner denied a fresh npm-cache read, so another
  laptop still needs the documented `npm ci` install step.

## Honest answer if asked whether it is finished

The scraper, database, analytics, and local dashboard are complete for the
three properties whose live inventories could be fully verified. Central
Sydney is the only data-completion item. Its code path and tests are complete,
but the final live request was blocked by the restricted delivery network, so
the current SQLite still contains 0 Central rows. I kept the UI honest rather
than inserting 2,536 unverified rows or claiming 2,537. A qualifying live run
is still required; after acceptance, the UI will count it as verified and show
**Verified with 1-review disclosure** in amber. A fresh laptop still requires
supported Node.js, installed dependencies, and network access that permits
Booking's public page; no scraper can guarantee that Booking will never
present a challenge or change its contract.

## One-sentence technical summary

The collector captures Booking's public structured review request from an
anonymous browser, validates and replays only that proven contract, reconciles
two complete inventories, and atomically publishes the result to SQLite for an
explainable React operations dashboard.
