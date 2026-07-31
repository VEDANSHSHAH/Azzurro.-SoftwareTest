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

## Booking advertised/retrievable count gap

Booking shows an aggregate review total and separately paginates individual
reviews. Occasionally the review list ends a small number short of the
advertised total. The collector records this as a bounded source-gap disclosure
only when all aggregate totals, score buckets, and two independent inventories
reconcile.

- An exact count is the normal case.
- A gap is tolerated only up to `min(5, 1% of the advertised total)`.
- The score-bucket shortfalls must add up to exactly the disclosed gap.
- A wider or inconsistent gap fails closed and is not published.

Every fresh database starts with zero rows until a qualifying live run publishes
an accepted collection.

The original Surry Hills property was replaced with Olympic Paddington as
requested by the interviewer.

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
  and publication status. Pending properties are labelled as awaiting
  verification rather than implying that collection is actively running. A
  published source gap is counted as verified and retains an amber disclosure.

Charts and cards use restrained entrance and data animations. All motion is
disabled when the operating system requests reduced motion.

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

### Collect initial data

Run each property separately. The collector creates and populates the local
SQLite file only after it has verified a complete collection.

```bash
npm run refresh:reviews -- --property olympic_paddington
npm run refresh:reviews -- --property potts_point
npm run refresh:reviews -- --property central_sydney
npm run refresh:reviews -- --property darling_harbour
```

### Run the local application

```bash
npm run app
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The command starts:

- the read-only dashboard data service on `127.0.0.1:4318`; and
- the frontend on `127.0.0.1:3000`.

The app reads `data/azzurro-reviews.sqlite`. The committed file has tables only;
run the collection commands above first to populate the dashboard with accepted
data.

The dashboard header also has a **Start collection** button. Select a property
in the Property filter first if you do not want to collect every configured
property. The button opens the same visible browser as the command-line
collector and reports its real local status. It cannot start a second run while
one is active, and incomplete results are not published.

No machine-specific browser path is embedded. After the install commands above,
the collector uses Playwright's managed Chromium on Windows, macOS, or Linux.
An installed Chrome path is an optional override, not a requirement.

To start the two processes separately:

```bash
npm run dashboard:api
npm run dashboard:dev
```

## Running the collector

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
missing reviews. The dashboard's **Reload dashboard** button only reloads the
latest accepted SQLite publication; it never starts a scrape.

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
- The retrievable inventory must match the advertised total or satisfy the
  bounded, disclosed source-gap rule above.
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
npm test                         # 228 scraper/backend tests
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

- Root suite: **228 tests**, **222 passed**, **0 failed**, **6 skipped**.
  The skipped cases require the original private HAR captures; equivalent
  sanitized contract fixtures run in the normal suite.
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
  silently publishing partial data. Use `--headed --interactive-challenge` if
  a normal verification screen is shown.
- A disclosed source gap means Booking advertised reviews that its own list did
  not return; those rows cannot be collected without being served by Booking.
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
