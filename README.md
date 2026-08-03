# Azzurro Review Intelligence

An accuracy-first Booking.com review collector and operations dashboard for the
four Azzurro trial properties. It collects public review data without an
official API, proves that accepted inventories are complete, stores them in one
SQLite file, and turns them into explainable weekly metrics and review topics.

## Database delivery

The committed `data/azzurro-reviews.sqlite` is intentionally **schema-only**:
it contains the complete table and index structure but no properties, reviews,
collection runs, or publications. Each machine collects and verifies its own
public review data before using the dashboard.

The normal path requires exact visible and structured counts. Central Sydney has
one explicit exception for a Booking-side visible-count lag, described below.

The original Surry Hills property was replaced with Olympic Paddington as
requested by the interviewer.

## Booking's advertised/retrievable count gap

Booking publishes a property's review total through four aggregate filters, and
separately paginates the reviews themselves. Those two numbers occasionally
disagree by a small amount: the page advertises N reviews while the review list
exhausts at N-1. It is Booking's own aggregation lag, not something a collector
can resolve.

The collector treats that as a **bounded, disclosed tolerance** rather than an
error or a requirement:

- A gap of zero is the ordinary healthy case and needs no attestation.
- A small gap is accepted, recorded as a `source_discrepancy_attestation`, and
  surfaced in the dashboard as an amber disclosure. The property still counts as
  verified; the badge marks the source's shortfall, not a failed collection.
- The tolerated gap is `min(5, 1% of the advertised total)`, so a property too
  small for one percent to reach a single review tolerates no gap at all.
- The shortfall may fall in any score bucket, and the per-bucket shortfalls must
  add up to exactly the whole gap.
- Anything wider still fails closed and publishes nothing.

Central Sydney can also expose a separate discrepancy between the count in
Booking's visible review modal and the complete, internally consistent
`ReviewList` inventory. Only Central Sydney's exact configured property key and
Booking hotel ID may use this exception, and only when the visible count is one
to five higher. The exact visible and structured counts are stored in an
immutable run attestation and shown in the dashboard. Every other property
still requires exact visible/structured equality. Missing rows are never
fabricated.

## What the dashboard includes

The Azzurro-inspired interface is designed for non-technical operations staff
and separates work into six uncluttered workspaces:

- **Overview:** current-week average, matched previous-week comparison, review
  volume, negative share, response rate, rating movement, recent reviews, and
  an action queue.
- **Trends:** animated rating, sentiment, score-distribution, and review-volume
  charts.
- **Properties:** property-by-property comparisons, weekly movement, response
  rates, top issues, and an animated fixed-scale comparison of Booking's source
  category scores: Staff, Facilities, Cleanliness, Comfort, Value for money,
  Location, and Free Wifi where published. Missing source scores stay blank
  rather than being treated as zero.
- **Review insights:** the eight requested operational topics, trend direction,
  negative-feedback concentration, definitions, and drill-down links. A period
  with negative reviews but no rule-supported topic matches now shows an
  explanatory empty state instead of an apparently blank chart.
- **Reviews:** full-text search, individual review drawer, pagination, sorting,
  and filters for property, date, sentiment, topic, score, language, guest
  type, and room type. The eight topic filters are also always visible as quick
  buttons above the feed.
- **Data quality:** per-property advertised/retrievable counts, inventory and
  semantic parity, parser version, source-gap disclosure, database integrity,
  and publication status. Properties not yet collected are labelled as awaiting
  verification rather than implying that collection is actively running. A
  property published with a Booking source gap is counted as verified and keeps
  an amber disclosure showing the advertised and retrievable counts.

Charts and cards use restrained entrance and data animations. All motion is
disabled when the operating system requests reduced motion.

A **Collect reviews** action is always available from the header (and shown
prominently when no data has been published yet). It starts the same
accuracy-gated collector documented below, with live per-property progress,
without requiring a terminal.

## Quick start

For a short operator-oriented version of these steps, see
[HOW-TO-RUN.md](HOW-TO-RUN.md).

### Requirements

- Node.js 22.13 or newer
- npm
- Playwright Chromium (installed by the command below), or an optional local
  Chrome executable
- Windows, macOS, or Linux

### Install

```bash
npm ci
npm ci --prefix dashboard
npx playwright install chromium
```

### Run the local application

```bash
npm run app
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The command starts:

- the read-only dashboard data service on `127.0.0.1:4318`; and
- the frontend on `127.0.0.1:3000`.

The app reads `data/azzurro-reviews.sqlite`. The committed file has tables only,
so collect reviews from the dashboard itself before there is anything to show.

To start the two processes separately:

```bash
npm run dashboard:api
npm run dashboard:dev
```

### Collect initial data

No terminal command is required. The dashboard shows a **Collect reviews now**
button whenever no data has been published yet, and a **Collect reviews**
action in the header once data exists. Clicking it opens a real browser window
and runs the same accuracy-gated collector as the CLI for all four
properties, publishing to the local SQLite file only after every check
succeeds. If Booking shows a human-verification page, complete it in the
opened browser window; collection continues automatically afterward.
Per-property progress is shown live under the header, and the dashboard
reloads on its own once a property publishes.

No machine-specific browser path is embedded. After the install commands
above, the collector uses Playwright's managed Chromium on Windows, macOS, or
Linux. An installed Chrome path is an optional override, not a requirement.

The button calls the same `scripts/scrape.mjs` collector documented below, so
the terminal commands remain available for scripting, CI, or collecting a
single named property without opening the dashboard.

## Running the collector from a terminal

The dashboard's **Collect reviews** button (see Quick start above) runs this
same collector for all four properties without a terminal. The commands below
are the equivalent terminal path, useful for scripting, CI, or a single named
property.

The four property URLs and Booking hotel IDs are fixed in
`config/properties.json`, so normal runs do not rediscover them.

Start with a low-traffic canary:

```bash
npm run canary -- --property olympic_paddington
```

Run a complete accuracy-gated collection:

```bash
npm run scrape -- --mode full --property olympic_paddington
```

The same operation is exposed with an operator-friendly refresh command:

```bash
npm run refresh:reviews -- --property olympic_paddington
```

This is the command that contacts Booking and reconciles new, changed, and
missing reviews; the dashboard's **Collect reviews** button runs it the same
way. The dashboard's separate **Reload dashboard** button only reloads the
latest accepted SQLite publication and never starts a scrape on its own.

Run selected properties sequentially:

```bash
npm run scrape -- --mode full \
  --property olympic_paddington \
  --property potts_point \
  --property central_sydney \
  --property darling_harbour
```

For routine refreshes, run one property per command. A full multi-property run
stops after its first failed property so it does not keep requesting Booking
after an access, rate-limit, or verification signal. Earlier accepted
publications remain intact, and any later property can be run separately.

If Booking presents an ordinary human-verification page, the supported
interactive mode opens a headed anonymous browser and waits for a person to
resolve it:

```bash
npm run scrape -- --mode full \
  --property central_sydney \
  --headed \
  --interactive-challenge
```

The collector never solves, bypasses, or automates a challenge. It also never
uses a Booking username, password, saved profile, or login cookie.

Useful flags:

```text
--db <path>                  SQLite file (default: data/azzurro-reviews.sqlite)
--delay-ms <number>          Shared delay between review requests
--request-timeout-ms <n>     Per-request timeout
--max-retries <n>            Temporary transport retry budget
--summary <path>             Sanitized run summary
--chrome <path>              Optional installed Chrome executable
--headed                     Show the browser
--interactive-challenge      Wait for manual challenge resolution
```

By default the collector uses the Playwright Chromium installed during setup.
Set `AZZURRO_CHROME_PATH` or pass `--chrome` only when an installed Chrome build
is preferred.

## Collection method

Static HTML is useful for property identity and the visible score, but it is
not a reliable source for thousands of modal reviews. The selected method is
browser-assisted structured collection:

1. Open the canonical public property page in a fresh anonymous browser
   context.
2. Verify the property identity, displayed aggregate score, and advertised
   review count.
3. Click Booking's full-review control and capture the public structured
   `ReviewList` request generated by the page.
4. Accept only the proven operation, variables, property ID, neutral filters,
   safe headers, and response schema.
5. Run newest-first and oldest-first canaries and verify that sort direction,
   count sources, score buckets, and property category scores agree.
6. Crawl the complete inventory oldest-first, including an explicit empty
   terminal page.
7. Crawl it again newest-first.
8. Require identical unique review IDs and identical normalized record hashes
   between both passes.
9. Re-read the head and reject any moving count, changed record, duplicate,
   schema drift, access page, or rate limit.
10. Atomically publish the new generation to SQLite only after every check
    succeeds.

Direct HTTP replay is used only inside that browser-established, validated
request contract. This is faster than clicking through every review while
remaining tied to the live public page. Every new run recaptures the template;
no HAR, cookie, token, or account session is required.

## Accuracy and duplicate handling

Accuracy is enforced before publication, not estimated afterwards:

- Four independent advertised-count sources must agree.
- Five disjoint Booking score buckets must reconcile to the advertised total.
- The advertised total and the retrievable inventory must match, or differ by no
  more than the bounded gap described above, which is then disclosed.
- Central Sydney alone may have a stored visible-modal versus structured-list
  difference of one to five; both complete structured passes must still match
  exactly and the published count is always the number of real returned rows.
- A non-empty property must expose a non-empty category-score profile.
- Every review must satisfy the strict parser contract.
- Source review IDs must be unique within a page and across the inventory.
- Oldest-first and newest-first unique-ID sets must match exactly.
- Normalized semantic record hashes must also match exactly.
- A final head check must show that the source did not move during collection.
- Staging and publication are transactional; a failed run cannot replace the
  last accepted generation.
- Public exports replace Booking's source token with a stable one-way public
  review ID.

Future refreshes run the same full reconciliation. Existing source IDs are
matched to current rows, unchanged records are reused, changed records create
immutable versions, new IDs are inserted, and missing IDs are detected. This
prevents duplicate appends and also detects deletions or edits.

During each full refresh the terminal prints the verified count after the
first page, every 100 processed reviews, and the end of both independent
passes. Large properties can take several minutes because correctness checks
intentionally read the complete inventory twice.

If a request fails normally, the run is recorded as failed, the command exits
non-zero, and `data/last-run-summary.json` contains the sanitized reason. The
last accepted publication remains available to the dashboard. If the process
is forcibly killed, its partial staging data is still never published; rerun
the same property and the collector starts a new full proof from the beginning.
There is deliberately no partial checkpoint resume because reusing an old
partial inventory would weaken the moving-source and completeness guarantees.

Progress is visible in the terminal, but the trial does not include a background
watchdog, scheduler, or automatic restart. If output stops beyond the configured
request timeout, let the command return its recorded error; after an access or
rate-limit response, wait before deliberately rerunning that one property. A
force-killed process can leave an audit row marked `collecting`, but it cannot
replace the accepted publication.

An incremental collector exists in the domain code but is deliberately
disabled in the production CLI. A shallow "stop after known reviews" strategy
cannot prove that Booking did not reorder, edit, or remove an older review.
For this trial, completeness is more important than shaving off requests.

## SQLite architecture

`data/azzurro-reviews.sqlite` is the single local source of truth.

Key tables:

- `properties`
- `scrape_runs` and `scrape_run_pages`
- `property_snapshots`
- `full_inventory_attestations`
- `source_discrepancy_attestations`
- `property_publications`
- `reviews` and immutable `review_versions`

The dashboard reads the current accepted publication only. Review sentiment
and topics are deterministic derived data computed by a versioned rules module
and cached in memory. Source facts remain unchanged and separate from derived
labels, which avoids stale analysis tables and makes every label reproducible.

## Review-insight methodology

`src/review-insights.mjs` implements classifier version **1.0.1**, a
deterministic, multi-label rules engine for:

- Cleanliness
- Check-in experience
- Staff or receptionist behaviour
- Noise
- Facilities
- Location
- Room condition
- Value for money

It evaluates positive and negative text separately, applies phrase rules,
common variants, local negation, and contrast boundaries, and retains the exact
matched terms as evidence. A review can match more than one topic. If the text
does not provide enough evidence, no topic is forced. Version 1.0.1 also rejects
anchored non-complaint text such as “didn't experience any issues” when Booking
places it in the negative-text field.

Sentiment uses both score and the two source text channels:

- high scores normally support positive sentiment;
- low scores normally support negative sentiment;
- middle scores or conflicting text can be mixed; and
- score-only or insufficient cases can remain unclassified.

The dashboard's example percentage uses this denominator:

> reviews in the reporting period that contain negative feedback

The numerator is the subset of those reviews with negative evidence for the
selected topic. Because the classifier is multi-label, topic percentages do
not have to add to 100%.

### Method limitations

- Rules are explainable and deterministic, but less flexible than a reviewed
  multilingual language model.
- Sarcasm, unusual wording, and some non-English text may remain unclassified.
- Booking's property category scores are source aggregates; they are not the
  same as topic tags inferred from individual review text.
- A missing topic means "no configured evidence matched", not "the issue did
  not exist".

## Reporting-period rules

- Reporting timezone: `Australia/Sydney`
- Week starts: Monday
- The current week is compared with the same elapsed weekdays in the previous
  week. For example, Monday-Friday is compared with the previous
  Monday-Friday, not a complete seven-day week.
- A custom date range is compared with the immediately preceding range of the
  same length.
- All overview, trend, property, topic, and drill-down calculations use the
  same selected property/date corpus.

## Commands

```bash
npm test                         # 238 scraper/backend tests
npm run test:coverage
npm run dashboard:api
npm run dashboard:dev
npm run dashboard:build
npm run app

npm run canary -- --property <key>
npm run scrape -- --mode full --property <key>

npm run export:sample -- --out sample-data
npm run export:all
npm run audit:export

npm run package:release -- \
  -OutputPath ./azzurro-review-intelligence.zip
```

Dashboard-specific checks:

```bash
npm run lint --prefix dashboard
npm run typecheck --prefix dashboard
npm test --prefix dashboard
```

## Verification completed

- Root suite: **238 tests**, **232 passed**, **0 failed**, **6 skipped**.
  The skipped cases require the original private HAR captures; equivalent
  sanitized contract fixtures run in the normal suite.
- Live collection evidence is local and time-dependent. The latest accepted
  publication counts should be read from the dashboard's Data quality page;
  failed or incomplete live attempts do not replace an accepted generation.
- Dashboard: ESLint passed, TypeScript passed, five-environment production
  build passed, and two rendered-production tests passed.
- Browser QA: all six workspaces, exact source category scores, the
  cross-property category comparison and accessible value table, quick topic
  filters, Cleanliness drill-down, review drawer, keyboard close, URL
  persistence, data-quality states, the zero-topic explanatory state, and
  desktop overflow were checked with no console errors.
- API QA: health, local-only CORS, invalid-query `400`, and repeated dashboard
  requests were checked. Warm responses measured roughly 80-96 ms after cache
  preparation on the test machine.
- SQLite `PRAGMA integrity_check`: `ok`.
- Release QA: deterministic ZIP checksum and every archived entry hash verified.
  A fresh extraction passed all 224 root tests, dashboard lint, TypeScript,
  production build, and both rendered tests.
- The extracted root/dashboard lockfiles matched the dependency installations
  used for those tests. This restricted runner denied a clean npm-cache read,
  so a different laptop must still run the documented `npm ci` commands.

The validation summary above is sufficient to reproduce the delivered checks.

## Exports and release contents

Review exports are intentionally not committed. After collecting accepted data,
generate local JSONL and CSV exports with:

```bash
npm run export:sample -- --out sample-data
```

The release packager includes the schema-only SQLite file, not collected review
records.

The release packager excludes HARs, logs, temporary build output, environment
files, cookies, browser profiles, and dependency folders. No passwords, API
keys, session cookies, or personal account credentials are required or stored.

## Known limitations

- Booking can change its public page or structured response, rate-limit
  requests, or present a challenge. The collector fails closed rather than
  silently publishing partial data.
- Booking frequently serves a challenge page to a headless browser. Collect with
  `--headed --interactive-challenge` if a run fails with `CHALLENGE`.
- A tolerated count difference means Booking displayed or aggregated more rows
  than its structured review list served during that run. The app publishes
  only returned, twice-verified rows and clearly discloses the exact difference.
- Full refreshes prioritize proof over speed and can take time for properties
  with thousands of reviews.
- Collection is manually started; no scheduler, watchdog, automatic restart, or
  checkpoint resume is included.
- The local frontend command uses the development server for reliable
  cross-platform startup. A production build is verified separately.

## Responsible-use boundary

Use this project only for public review data within the supplied property
scope. Keep request volume low, respect Booking.com's terms and robots/rate
signals, and stop on access denial or verification challenges. Do not add
credential harvesting, cookie reuse, CAPTCHA bypass, account automation, or
proxy rotation.
