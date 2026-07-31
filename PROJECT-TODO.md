# Azzuro Review Intelligence - completion checklist

Last updated: 31 July 2026, after scraper, dashboard, and browser QA.

## Accuracy-first collection

- [x] Configure Olympic Paddington, Potts Point, Central Sydney, and Darling
  Harbour with canonical URLs and fixed Booking hotel IDs.
- [x] Replace the original Surry Hills property with Olympic Paddington.
- [x] Capture Booking's public structured review request in a fresh anonymous
  browser context.
- [x] Restrict replay to the proven ReviewList document, property, neutral
  filters, variables, and safe headers.
- [x] Validate property identity, aggregate score, four count sources, five
  score buckets, category scores, and the full response schema.
- [x] Collect oldest-first and newest-first complete inventories.
- [x] Require explicit terminal pages, unique IDs, identical ID sets, and
  identical semantic-record hashes.
- [x] Repeat the head check and fail on moving source data.
- [x] Publish accepted generations transactionally to SQLite.
- [x] Version edits, detect additions/removals, and prevent duplicate appends.
- [x] Implement bounded retry, Retry-After handling, shared pacing, circuit
  breaking, typed failures, challenge detection, and sanitized logs.
- [x] Keep credentials, cookies, browser profiles, and session headers out of
  the implementation and release.
- [x] Publish Olympic Paddington: 12/12, exact two-pass parity.
- [x] Publish Potts Point: 2,516/2,516, exact two-pass parity.
- [x] Publish Darling Harbour: 4,248/4,248, exact two-pass parity.
- [x] Implement a strict Central-only one-review source-discrepancy contract.
  The independently verified 2,537 advertised / 2,536 retrievable result and
  323 / 322 target-bucket result are minimum baselines; a later live total may
  increase only when all four advertised totals, all five buckets, the exact
  one-review 5-7 gap, both inventories, and persisted evidence still reconcile.
- [ ] Run and publish Central Sydney from an unrestricted network. The delivery
  sandbox blocks the live Booking request, so no Central rows were fabricated
  or accepted. The current canonical SQLite database still contains 0 Central
  rows, and a qualifying live run remains required.
- [x] Add operator progress at the first verified page, every 100 reviews, and
  the end of both inventory passes.
- [x] Define recovery semantics: a normal failure exits non-zero with a
  sanitized summary, a forced stop cannot publish staging rows, the previous
  accepted generation remains readable, and rerunning starts a fresh full
  two-pass proof rather than resuming a stale partial crawl.
- [x] Add `refresh:reviews` as the explicit collection/refetch command. It
  reconciles stable IDs, adds new reviews, versions changed reviews, detects
  missing reviews, and never appends duplicates.

## SQLite and application data

- [x] Use `data/azzurro-reviews.sqlite` as the single authoritative local file.
- [x] Store properties, runs, pages, snapshots, inventory attestations,
  discrepancy attestations, publications, reviews, and immutable versions.
- [x] Align scraper, exporter, and dashboard defaults to the canonical database
  filename.
- [x] Resolve default config, database, summary, export, API, and app paths from
  the extracted project location instead of the caller's working directory.
- [x] Use Playwright's installed Chromium by default, retain an explicit Chrome
  override, and use a platform-aware application launcher so a fresh supported
  Windows, macOS, or Linux checkout is not tied to this development machine.
- [x] Keep source facts separate from derived sentiment and topics.
- [x] Add tested query services for overview, matched periods, trends,
  comparisons, topics, reviews, filter options, and data quality.
- [x] Cache deterministic review analysis in memory so labels cannot become
  stale relative to source text.
- [x] Verify SQLite integrity (`ok`) and exact publication counts (6,776).

## Review insights

- [x] Implement versioned positive, mixed, negative, and unclassified
  sentiment rules.
- [x] Implement explainable multi-label rules for Cleanliness, Check-in,
  Staff/reception, Noise, Facilities, Location, Room condition, and Value.
- [x] Handle positive/negative text channels, local negation, contrast,
  variants, empty comments, and score-only reviews.
- [x] Preserve matched terms as evidence and never force an unsupported topic.
- [x] Define negative-topic share against reviews containing negative feedback.
- [x] Test every topic and polarity with labelled fixtures.
- [x] Upgrade the classifier to rules `1.0.1` so explicit no-problem wording in
  Booking's negative-text field is not counted as negative feedback.
- [x] Replace the all-zero Insights chart with a clear empty state that reports
  the active-period negative-feedback count and honestly explains score-only
  and unsupported-language gaps; unsupported languages are still not inferred.
- [x] Document methodology, denominator, and limitations in the app and README.

## Operations dashboard

- [x] Create a reusable Azzuro-inspired design system with local fonts, navy,
  warm neutral, and pink accents.
- [x] Build persistent navigation with Overview, Trends, Properties, Review
  insights, Reviews, and Data quality.
- [x] Build current-week KPIs and same-elapsed-days previous-week comparison.
- [x] Add custom equal-length period comparisons.
- [x] Add animated rating, sentiment, score-distribution, volume, topic, and
  property-comparison charts.
- [x] Respect `prefers-reduced-motion`.
- [x] Add property cards, performance table, operational issue, exact Booking
  category-score panels, and a fixed 0-10 cross-property category comparison.
- [x] Keep missing Booking categories blank, omit properties without accepted
  category evidence, expose an exact screen-reader table, and animate both the
  comparison bars and selected-property source bars.
- [x] Add full review feed, text search, sorting, pagination, review drawer,
  partner replies, stay context, and topic evidence.
- [x] Add property, date, sentiment, topic, score, language, guest type, and
  room type filters.
- [x] Add always-visible quick topic filters so Cleanliness and the other seven
  requested selections are not hidden.
- [x] Persist dashboard and review state in the URL.
- [x] Keep dashboard reload separate from collection: **Reload dashboard**
  refetches the latest accepted SQLite publication, while `refresh:reviews` is
  the only operator command here that contacts Booking.
- [x] Add loading, empty, stale-data, error, and no-publication states.
- [x] Add truthful Verified, **Verified with 1-review disclosure**, Evidence
  error, and Pending verification states. An accepted Central `source-gap`
  publication counts as verified, while its disclosure badge remains amber.
- [x] Replace the ambiguous **Collection in progress** header with computed
  publication coverage (**3 of 4 properties verified**) and explicitly state
  that it does not mean a scraper process is running.
- [x] Add accessible dialog semantics, Escape close, focus restore, names, and
  visible focus behaviour.
- [x] Add responsive single-column layouts and horizontal quick-filter scrolling.
- [x] Add a desktop-collapsible sidebar that retains labelled, keyboard-accessible
  icon navigation and re-expands from the same fixed navigation rail.
- [x] Tighten the shared workspace gutter from a maximum 48px to 32px so
  cards use more of the available desktop width without crowding smaller screens.

## Verification completed

- [x] Root suite: 224 tests; 218 passed, 0 failed, 6 skipped optional HAR-only
  checks.
- [x] Central strict-attestation focused tests passed, including later live
  growth and minimum-baseline rejection cases.
- [x] Dashboard data tests: 6/6 passed.
- [x] Dashboard ESLint and TypeScript checks passed.
- [x] Five-stage production build passed.
- [x] Rendered production checks: 2/2 passed.
- [x] Status-copy regression checks confirm that a pending publication is never
  presented as an active scrape and that only an accepted Central `source-gap`
  publication receives the exact **Verified with 1-review disclosure** label.
- [x] Chrome QA loaded all six workspaces.
- [x] Chrome QA confirmed Olympic source category values: Staff 9.4,
  Facilities 9.2, Cleanliness 9.4, Comfort 9.4, Value 9.6, Location 9.4.
- [x] Chrome QA confirmed the category comparison shows exact Olympic, Potts
  Point, and Darling Harbour values, leaves Olympic Free Wifi unpublished, and
  explicitly omits unpublished Central Sydney rather than plotting a zero.
- [x] Chrome QA confirmed Cleanliness quick filter: 6,776 reviews reduced to
  1,062 exact topic matches and URL state updated.
- [x] Chrome QA confirmed review drawer, Escape close, quality statuses, and no
  desktop horizontal overflow.
- [x] Local interaction QA confirmed the sidebar collapses and expands, keeps
  all six navigation destinations accessible by name, and preserves the normal
  expanded layout after a second toggle.
- [x] Chrome QA confirmed the Insights zero-signal period now shows an
  explanatory empty state instead of an apparently broken blank chart, while
  non-zero topic periods retain the animated ranking chart.
- [x] API health, local CORS, invalid-query `400`, and warm response timings
  checked (approximately 80-96 ms after cache preparation).

## Documentation and handoff

- [x] Replace starter frontend documentation.
- [x] Document setup, scraper and frontend commands, architecture, collection
  method, insight method, limitations, and assumptions.
- [x] Generate 62 public sample rows in JSONL and CSV with a manifest.
- [x] Include the working SQLite dataset so the local application starts with
  real accepted data.
- [x] Run the final secret/session scan; no credentials, session artifacts,
  HARs, environment files, or recognizable private-token formats were found.
- [x] Build the deterministic ZIP and SHA-256 manifest, then verify every
  archived file against its in-memory source hash.
- [x] Rebuild the release ZIP after the portability, dynamic Central, and
  Insights `1.0.1` changes. A fresh extraction passed the 224-test root suite,
  dashboard lint, TypeScript, production build, 2/2 rendered checks, SQLite
  integrity/count reconciliation, 62/62 unique sample IDs, archive allowlist,
  and secret scan. Dependency lockfiles matched the tested installations; this
  restricted runner could not exercise a new `npm ci` because it was denied
  access to its npm cache.
- [x] Verify a fresh clone from the submitted repository: root dependencies
  installed cleanly, the 224-test suite passed (218 executed; 6 optional HAR
  checks skipped), and the dashboard production build plus 2/2 rendered checks
  passed. The final staged-content scan found no prohibited assistant-brand
  references or credentials.
- [x] Repair the Windows local-app launcher so it starts the dashboard command
  through a Windows shell; this prevents the `spawn EINVAL` startup failure.

## Deliberate non-goals

- No credentials, login sessions, CAPTCHA bypass, proxy rotation, or account
  automation.
- No optimistic publication of a partial or one-pass inventory.
- No claim that Central Sydney is complete before a qualifying live run.
- No AI-generated topic claim without deterministic text evidence.
- No scheduler or hosted production deployment for this local interview trial.
