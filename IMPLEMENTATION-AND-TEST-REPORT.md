# Azzurro Booking.com Review Collector - Implementation and Test Report

Date: 31 July 2026

Scope: collection, validation, persistence, export, analytics, dashboard, and
release verification

## Executive status

The implementation is on the right technical path for the stated priority:
accuracy before speed.

The collector captures Booking's structured `ReviewList` response in a
temporary anonymous Chrome context, validates every accepted page, reads a full
inventory twice in opposite directions, and requires independent SQLite
attestations before a property can be published.

Current evidence:

- Four current Azzurro properties are configured and Olympic Paddington has
  replaced the old `sydney-city-stay` target.
- Parser and semantic hash contract `2.4.0` is implemented.
- Olympic Paddington published 12/12, Potts Point published 2,516/2,516, and
  Darling Harbour published 4,248/4,248. Each completed two exact inventories.
- The included SQLite database contains 6,776 accepted reviews and passes
  `PRAGMA integrity_check`.
- Central Sydney's verified 2,537-advertised/2,536-retrievable baseline has a
  narrow persisted attestation contract. The contract can follow a later live
  count upward only when the same exact one-review 5-7-bucket discrepancy and
  every independent proof still reconcile; its final live publication remains
  pending. The current SQLite database contains 0 Central rows.
- The disputed Central 5-7 score bucket advertises 323 but exhaustively returns
  322. No 2,537th record is invented.
- Incremental authoritative collection is disabled; updates use a complete
  reconciled rerun.
- Versioned deterministic classifier `1.0.1` is integrated with the local data
  service and dashboard. It excludes explicit no-problem wording from negative
  feedback and leaves unsupported-language topics unclassified rather than
  guessing.
- The Azzuro-inspired dashboard includes six operations workspaces, advanced
  review filters, source category scores, animations, reduced-motion support,
  and a data-quality surface.
- Portfolio status is based on accepted publications. With Central unpublished,
  the header reports `3 of 4 properties verified`; it does not claim a scraper
  process is running.
- Once a qualifying Central `source-gap` generation is accepted, it counts as a
  verified publication and is labelled exactly **Verified with 1-review
  disclosure**. The amber treatment remains to disclose the one-review source
  gap; it does not mean the accepted generation failed verification.
- The root suite reports 224 tests: 218 passed, 0 failed, and 6 optional
  HAR-only checks skipped. Dashboard lint, typecheck, build, 2/2 rendered tests,
  API checks, and live Chrome checks also pass.
- The rebuilt deterministic release passed allowlist, checksum, secret and
  extracted-SQLite checks; its fresh extraction also passed the root and
  dashboard suites against dependency installations with matching lockfiles.
- No complete four-property authoritative publication is claimed.

The Central contract does not choose a convenient count or invent a review. A
qualifying future run may publish only the live retrievable inventory and must
store the separate live advertised total and exact one-review source gap. The
observed 2,537/2,536 result is evidence and a minimum baseline, not a permanently
hard-coded future count.

## Paste-ready interview update

- I confirmed that Booking loads public reviews through a structured
  `ReviewList` GraphQL response.
- I tested direct HTTP because it is faster, but Booking can return a challenge
  or a structured review error even when the HTTP response looks successful.
- I built a browser-assisted collector that uses a temporary anonymous Chrome
  context, captures Booking's current review request, and validates the hotel ID
  before reading structured pages.
- The four required URLs and hotel IDs are stored in configuration, so normal
  runs skip unnecessary property discovery.
- Olympic Paddington replaced the old Surry Hills investigation target.
- Every page is checked for schema, property identity, count evidence,
  pagination, sort direction, duplicates, and valid review identity.
- A full property run reads the entire review inventory oldest-first and
  newest-first, reaches explicit terminal pages, and requires exact identity and
  semantic-record parity.
- SQLite recomputes count and inventory evidence from stored rows instead of
  trusting the in-memory scraper result.
- Three live canaries passed: Olympic Paddington, Potts Point, and Darling
  Harbour.
- Central Sydney exposes a repeatable source discrepancy: Booking shows and
  advertises 2,537 reviews while the unfiltered list returns 2,536.
- I isolated the disagreement to the 5-7 score bucket: it advertises 323 but
  returns 322. Both sort directions return the same 322 review identities and
  semantic records.
- I added a Central-only fail-closed attestation. It requires live advertised
  evidence at or above the independently verified 2,537 baseline, an exact
  one-review gap only in the 5-7 bucket, two matching full inventories, and
  terminal-page and final-head proofs. Later live growth is allowed only when
  every count and bucket reconciles again.
- Booking rotates the CDN hostname for some review photos. I canonicalized only
  that hostname; photo path, query, port, fragment, metadata, and all other
  review fields remain accuracy-checked.
- Incremental publication is disabled. The accepted update path is a complete
  full rerun.
- A full refresh reports progress, reconciles stable identities, inserts new
  reviews, versions changed reviews, detects missing reviews, and leaves the
  last accepted generation intact if collection stops or fails.
- Default paths are based on the extracted project location, Playwright's
  installed Chromium is the browser default, and the app launcher is
  platform-aware rather than tied to this computer.
- The root suite reports 224 tests: 218 passed, 0 failed, and 6 optional
  HAR-only checks skipped.
- No partial four-property dataset has been presented as finished.
- I connected the accepted SQLite publications to a reusable operations
  dashboard with overview, trend, property, insight, review, and quality pages.
- Booking's source category scores are displayed separately from review-text
  topic tags, with an animated fixed 0-10 cross-property comparison and an
  exact accessible value table.
- All eight requested topic filters are visible above the review feed, and the
  full review drawer retains source text, stay context, replies, and evidence.
- The all-zero Insights chart now becomes an explanatory empty state; non-zero
  periods continue to use the animated topic-ranking chart.
- The final root suite has 224 tests: 218 passed, 0 failed, and 6 optional
  HAR-only checks skipped.

## Fixed property scope

| Property key | Booking hotel ID | Clean configured URL | Configured discovery score | Configured visible count |
|---|---:|---|---:|---:|
| `olympic_paddington` | `16211291` | `https://www.booking.com/hotel/au/olympic-paddington.html` | 8.8 | 12 |
| `potts_point` | `9491412` | `https://www.booking.com/hotel/au/venus-potts-point-sydney.html` | 6.7 | 2,516 |
| `central_sydney` | `9888182` | `https://www.booking.com/hotel/au/venus-surry-hills.html` | 6.9 | 2,537 |
| `darling_harbour` | `10753881` | `https://www.booking.com/hotel/au/chateau-de-venus.html` | 6.9 | 4,248 |

The score and visible-count values are capture expectations and evidence, not a
substitute for live source validation. Every accepted run must derive and
validate its current structured values again.

Historical Surry Hills capture data remains useful as an offline response
fixture. It is not one of the four current configured properties and cannot be
included in a current all-property export.

## Why this collection method was selected

### Static DOM scraping

Useful for visible corroboration, but not selected as the main source because:

- the modal exposes fewer structured fields;
- virtualized content can omit off-screen reviews;
- selectors and visible labels are more presentation-dependent; and
- completeness is harder to prove.

### Direct anonymous HTTP

Potentially faster, but live tests showed:

- HTTP 200 can contain `ReviewsFrontendError`;
- HTTP 202 can represent a challenge; and
- a request copied outside the page context can lose required transient state.

Direct HTTP remains useful for diagnostics, but it is not accepted as the
authoritative path when its response contract is uncertain.

### Selected browser-assisted structured collection

The accepted flow is:

```text
configured clean URL and hotel ID
  -> temporary anonymous Chrome context
  -> capture current ReviewList request
  -> verify property identity and visible evidence
  -> replay structured pages in the same context
  -> validate and stage each page transactionally
  -> reconcile two full opposite-sort inventories
  -> independently attest count and inventory evidence in SQLite
  -> promote one property atomically
```

This uses the source's structured review representation while avoiding a
persistent user profile.

## Implemented components

| Component | Current behavior |
|---|---|
| Property registry | Four clean URLs and hotel IDs; no rediscovery on normal runs |
| Browser capture | Installed Chrome, anonymous temporary context, optional visible human handoff |
| GraphQL isolation | Selects only `ReviewList`, including supported batched transport |
| Query provenance | Validates full or persisted-query form and stores a SHA-256 fingerprint |
| Response contract | Strict required keys, types, property identity, aggregates, and review-card fields |
| Pagination | Offset/limit checks, expected page sizes, terminal-page proof, repeated-page rejection |
| Sort validation | Oldest/newest date monotonicity and non-degenerate canary samples |
| Identity | Booking hotel ID plus source review token |
| Semantic record hashing | Full source-card projection with only validated photo CDN hostname canonicalized |
| SQLite staging | Transactional page, checkpoint, count evidence, and review staging |
| Publication | Per-property full promotion after persisted attestations |
| Export | Sample export or strict all-property current-parser export |
| Incremental mode | Rejected at CLI/orchestration boundary for authoritative use |
| Review insights | Versioned pure classifier `1.0.1` with retained match evidence, computed consistently by the local data service |
| UI | Six-workspace local React dashboard with reusable charts, filters, review drawer, empty/error/loading states, and data-quality evidence |

## Review data contract

The collector retains:

- source review identity;
- raw review epoch, UTC time, and Sydney date;
- score;
- title, positive text, and negative text, including explicit nulls;
- source language and trivial-text flag;
- property response;
- helpful votes;
- booking, room, stay, and traveller details;
- public guest metadata provided by the response;
- review photos and highlights;
- approval and translation flags;
- complete validated raw source-card JSON; and
- query, parser, run, page, and attestation provenance.

Different source review tokens remain different reviews even if their visible
text and score are identical.

The response does not reliably provide per-review values for every aggregate
property category, a review-edit timestamp, a definitive deletion marker, or a
property-response timestamp. These fields are not invented.

## Deterministic review-insights contract

`src/review-insights.mjs` implements classifier version `1.0.1` without changing
the live scraper or source-fact export. It accepts a review score plus Booking's
separate positive and negative text and returns:

- a `positive`, `mixed`, or `negative` sentiment;
- a stable sentiment rule and plain-language reason;
- multi-label assignments for the eight required operational topics;
- positive, mixed, or negative topic polarity;
- matched terms and source fields; and
- detailed rule IDs, exact offsets, matched text, and negation flags.

The eight topic IDs are `cleanliness`, `check_in`, `staff_reception`, `noise`,
`facilities`, `location`, `room_condition`, and `value_for_money`.

Score-only sentiment is negative below 7, mixed from 7 to 7.9, and positive
from 8 upward. Substantive positive and negative fields produce mixed
sentiment. A high-score complaint and a low-score positive-only review also
produce mixed sentiment rather than hiding the contradiction.

Known no-comment and explicit no-problem phrases are treated as empty, including
the observed "didn't experience any issues; everything met my expectations"
shape in Booking's negative-text channel. Score and title never invent a topic.
Topic rules require explicit word/phrase evidence and include targeted negation,
punctuation, hyphenation, and Australian/UK spelling variants.

The classifier is deterministic and explainable, not a claim of human-level
language understanding. It may miss sarcasm, rare wording, or unsupported
languages. Results remain separate derived data. The dashboard computes them
through the versioned rules module and retains the evidence without mutating
source review facts. When an active period has negative-feedback reviews but no
supported negative topic match, Insights renders an explanatory empty state
instead of an apparently broken zero-width chart.

## Parser 2.4.0 photo URL contract

### Live finding

When the same 322 Central reviews were read using opposite sorters, the raw
review identities matched, but a small group initially produced different raw
record hashes. Field-path comparison showed:

- 7 affected review identities;
- 48 aligned photo URL pairs;
- 48 hostname changes;
- 0 protocol changes;
- 0 pathname changes;
- 0 query/search changes;
- 0 fragment changes; and
- 0 unparsable URLs.

The observed hosts were Booking `bstatic.com` CDN subdomains.

### Narrow canonicalization

Only `sourceCard.photos[].urls[].url` receives this treatment:

1. Parse and require an absolute HTTPS URL.
2. Reject credentials, malformed input, and non-`bstatic.com` hosts.
3. Replace only the raw authority hostname with
   `booking-photo-cdn.invalid`.
4. Preserve the explicit port, pathname, query order and values, and fragment
   byte-for-byte.
5. Hash and export the canonical photo URL.
6. Retain the untouched raw source card separately for audit.

A different photo path, query value, port, fragment, size, ID, tag, ordering,
or number of photos still changes the semantic record hash. The rule does not
ignore a whole URL and does not remove query parameters.

## Authoritative full-run algorithm

### 1. Canary

Before a full inventory, the collector requires:

- captured hotel ID equals configuration;
- visible count and score evidence are present where required;
- structured count evidence is valid;
- category and filter schema is valid;
- newest and oldest sample pages are valid; and
- the requested sorters are actually honored.

### 2. Oldest-first inventory

The collector reads every page in `OLDEST_FIRST` order, validates each page,
stages it transactionally, and requests an explicit empty terminal page after
the last data offset.

### 3. Newest-first inventory

The collector independently repeats the complete inventory using
`NEWEST_FIRST` and again requires an explicit terminal page.

### 4. Exact reconciliation

The two passes must have:

- the same expected count;
- no duplicates;
- the same unique identity set;
- the same semantic record hash for every identity;
- valid offset coverage; and
- stable aggregate/category evidence.

### 5. Final-head check

The newest page is observed again. It must match the accepted newest inventory
head.

### 6. Independent SQLite attestation

SQLite rebuilds evidence from persisted pages and staged records:

- authoritative page count;
- expected source count;
- count-evidence digest;
- oldest and newest unique counts;
- identity-set digests;
- semantic-record digests;
- terminal offsets; and
- final-head response digest.

It stores a separate full count attestation and full inventory attestation.
Promotion requires both. This prevents an orchestrator bug or stale in-memory
summary from being the only proof of completeness.

## Central Sydney live diagnostic

### Unfiltered evidence

| Observation | Result |
|---|---:|
| Visible/configured count | 2,537 |
| `reviewScoreFilter.ALL` | 2,537 |
| `languageFilter` all value | 2,537 |
| `timeOfYearFilter.ALL` | 2,537 |
| `customerTypeFilter.ALL` | 2,537 |
| Sum of five non-ALL score buckets | 2,537 |
| `ReviewList.reviewsCount` | 2,536 |
| Last unfiltered data page | Offset 2,530 with 6 cards |
| Explicit unfiltered terminal | Offset 2,540 with 0 cards |

The structured list therefore exhausts at 2,536 even though all independent
advertised totals say 2,537.

### 5-7 score-bucket evidence

| Observation | Result |
|---|---:|
| Advertised bucket count | 323 |
| Newest-first returned identities | 322 |
| Oldest-first returned identities | 322 |
| Newest/oldest identity parity | 322/322 |
| Newest/oldest semantic record parity | 322/322 |
| Explicit terminal page | Empty in both directions |

This validates all 322 reachable reviews in the bucket. It does not prove what
the missing advertised item is, whether it is hidden, delayed, removed, or a
Booking count defect. The collector therefore never represents 2,536 as
Booking's advertised total and never fabricates a 2,537th record.

### Central-only publication attestation

The implemented exception is an evidence contract, not a relaxed count check.
It applies only to property key `central_sydney` and Booking hotel ID `9888182`.
It requires:

- a live advertised total no lower than the independently verified 2,537
  baseline, with all four trusted totals equal to that live value;
- five advertised score buckets that sum to the live advertised total, with the
  5-7 bucket no lower than its independently verified 323 baseline;
- exactly one fewer live retrievable record than the live advertised total in
  both complete sort directions;
- exact identity and semantic-record parity between those two inventories;
- only `REVIEW_ADJ_AVERAGE_PASSABLE` to be short by exactly one, with every
  other live score bucket exact;
- an explicit terminal after the current live inventory and an unchanged final
  newest head; and
- SQLite recomputation of the count, bucket, identity, record, terminal, and
  final-head evidence before attestation, finalization, promotion, and export.

SQLite persists advertised count, retrievable count, gap, target bucket,
advertised/retrievable bucket vectors, and the canonical count-evidence hash in
`source_discrepancy_attestations`. Dashboard and export surfaces expose only the
safe counts and bucket summary. Any property, count, bucket, page, identity,
record, baseline regression, or persisted-attestation drift fails closed.
Normal properties retain the original exact advertised-equals-retrievable
rule. Central remains unpublished until one unrestricted live run satisfies
this complete dynamic contract.

For frontend status semantics, a Central generation that passes this contract
is verified and uses the exact label **Verified with 1-review disclosure**.
Its badge remains amber to keep the one-review discrepancy explicit. This
describes the accepted future state only: the current SQLite database still
contains 0 Central rows, so one qualifying live run remains required.

## Live canary record

| Property | Hotel ID | Structured / visible count | Score | Categories | Sorter cards | Result |
|---|---:|---:|---:|---:|---:|---|
| Olympic Paddington | `16211291` | 12 / 12 | 8.8 | 6 | 10 / 10 | Passed |
| Potts Point | `9491412` | 2,516 / 2,516 | 6.7 | 7 | 10 / 10 | Passed |
| Darling Harbour | `10753881` | 4,248 / 4,248 | 6.9 | 7 | 10 / 10 | Passed |
| Central Sydney | `9888182` | 2,536 / 2,537 | 6.9 | Validated during diagnostic | N/A | Rejected count mismatch |

Potts Point used the opt-in visible manual challenge handoff. The collector did
not click, type into, solve, or bypass the challenge. The resulting anonymous
session remained temporary.

Canary mode publishes nothing. These results prove that the capture and canary
contract worked at those times; they are not four complete review inventories.

## SQLite persistence and versioning

The storage layer uses:

- WAL mode and `synchronous=FULL`;
- foreign keys and strict tables;
- one serialized writer;
- immediate page and promotion transactions;
- immutable review versions;
- idempotent replay checks;
- unique property/review identity;
- stale-base rejection;
- persisted page-level count evidence; and
- independent count and inventory attestation tables.

The first raw source observation remains available in the stored source card.
Canonical photos are stored for stable semantic comparison and export. A
hostname-only CDN rotation does not create a new review version, while any
other retained review change does.

## Export rules

`npm run export:sample` can inspect available published records. It is not proof
that the full configured scope is complete.

`npm run export:all` enables strict all-property validation. Before reading
review rows, every configured property must have:

- a current publication;
- a succeeded `full` or `reconcile` run;
- `complete_inventory = 1`;
- parser version `2.4.0`;
- a source count equal to the current published count;
- a valid full-inventory attestation; and
- the latest successful publication also recorded as the latest successful
  full publication.

Missing or non-authoritative properties cause one explicit
`INCOMPLETE_AUTHORITATIVE_EXPORT` failure. The export does not quietly omit
them.

## Incremental mode decision

The codebase contains older overlap-scan logic and tests, but incremental
authoritative operation is disabled.

- `--mode incremental` fails with `INCREMENTAL_DISABLED`.
- CLI help exposes only `canary` and `full`.
- The production orchestrator never publishes an incremental update.

An overlap window cannot prove that an old review outside the window was
edited, replaced, or removed. The accepted update strategy is therefore a full
two-pass rerun.

## Failure, retry, and traffic policy

| Condition | Action |
|---|---|
| Timeout, network error, temporary 5xx | Bounded retry with capped backoff |
| Repeated capture timeout | Open circuit |
| HTTP 429 | Stop and retain sanitized reschedule timing |
| HTTP 401/403 | Stop property |
| HTTP 202 or challenge | Stop unless visible human handoff is enabled |
| Human-handoff timeout | Stop without publication |
| HTML or invalid JSON | Fail page |
| GraphQL error or `ReviewsFrontendError` | Fail page |
| Wrong hotel ID | Fail property |
| Schema drift | Fail page |
| Count, order, identity, or hash mismatch | Fail run |

Default property concurrency is one with application-level pacing. Accuracy
takes priority over throughput.

## Refresh, progress, and recovery semantics

`npm run refresh:reviews -- --property <key>` runs the same authoritative full
two-pass collection as `scrape --mode full`; it is not a shallow append. Stable
source identities prevent duplicate insertion, unchanged rows are reused,
changed records create immutable versions, new identities are inserted, and
missing identities are detected before promotion.

The terminal reports the verified source count after the first page, progress
every 100 processed reviews, and completion of both independent passes. A
normal failure exits non-zero and records a sanitized last-run summary. A
forced process stop may leave staging rows, but those rows cannot become the
current publication. The last accepted property generation remains readable.
The supported recovery action is to rerun that property from the beginning;
partial checkpoint resume is intentionally absent because it would weaken the
moving-source proof.

The dashboard's **Reload dashboard** action only refetches the latest accepted
SQLite state. It does not contact Booking or start collection in the
background, keeping operator intent and network traffic explicit.

## Navigation and workspace density

The desktop navigation rail can collapse from 264px to an 86px icon rail and
expand again in place. The compact state keeps an accessible name and tooltip
for every destination, preserves the active indicator, and does not reuse the
mobile drawer behaviour. The mobile breakpoint still uses the existing menu
and close controls.

The shared desktop content gutter now scales from 18px to 32px, rather than
growing to 48px. Header, filters, cards, charts, quality panels, and the stale
data banner use the same value, keeping their edges aligned while giving the
cards materially more horizontal room.

Likewise, an internal `collecting` quality value means that a configured
property does not yet have an accepted publication. User-facing copy calls this
**Pending verification** and shows the verified-property ratio so an operations
user cannot mistake it for live process activity. An accepted Central
`source-gap` publication is instead included in that verified ratio and shown
as **Verified with 1-review disclosure**, with the amber disclosure retained.

## Portability boundary

Default config, database, summary, export, dashboard API, and application paths
are resolved from each script's project location rather than from the caller's
current working directory. The canonical default database is
`data/azzurro-reviews.sqlite` across collector, exporter, and dashboard.

Playwright's installed Chromium is the default browser; an installed Chrome
path is only an explicit CLI or environment override. The combined launcher
uses the platform-appropriate npm executable and starts both services with
project-relative working directories. The package is therefore not tied to
this development machine, but another laptop still needs Node.js 22.13 or
newer, installed dependencies and Playwright Chromium, sufficient local disk,
and network access that can load Booking's public property pages. Booking
access or an unchanged future page contract is not universally guaranteed.

## Credentials and access-control boundary

The implementation:

- does not request or store a Booking username/password;
- does not use a personal logged-in Chrome profile;
- does not copy cookies or tokens from the user's browser;
- does not rotate accounts or proxies;
- does not use stealth patches;
- does not solve CAPTCHAs; and
- does not attempt to bypass access controls.

A visible manual handoff is allowed only when explicitly enabled. The user may
resolve the challenge; the scraper waits and then revalidates the canonical
property page.

## Atomicity limitations

### What is atomic

A single property's SQLite promotion is atomic. Readers see the previous
attested generation or the new attested generation, never a half-written
promotion.

### What is not atomic

Booking provides no public snapshot token for the full review inventory. A
crawl is a sequence of observations over time, not one source-side transaction.
Two opposite passes and a final-head check detect many changes, but they cannot
mathematically guarantee that an unobserved deep item did not change after its
last observation.

Multi-property publication is also not one transaction:

- properties are processed sequentially;
- each successful property commits independently;
- full mode stops after the first failure; and
- an already committed earlier property is not rolled back when a later one
  fails.

Strict all-property export is the deliverable-level safeguard. It refuses to
produce the final combined export until every configured property independently
meets the current full-publication contract.

## Automated verification

Current clean result:

- Root `npm test`: 224 tests, 218 passed, 0 failed, 6 optional HAR-only
  checks skipped.
- The six skipped checks require the original private HAR captures; normal test
  execution uses sanitized Olympic and Surry contract fixtures instead.
- Central discrepancy focus passed, including later-live-growth and baseline
  regression cases.
- Dashboard data/query service: 6/6 passed.
- Dashboard ESLint: passed.
- Dashboard TypeScript `--noEmit`: passed.
- Five-environment vinext production build: passed.
- Rendered production shell/source tests: 2/2 passed.
- Status-copy regression checks passed: no **Collection in progress** label
  remains, and pending publication is explicitly separated from active scraping.
- SQLite integrity: `ok`.
- Browser checks: six workspaces, exact Olympic category scores, visible topic
  filters, Cleanliness filter result, review drawer, Escape close, URL state,
  data-quality states, desktop overflow, and the Insights all-zero empty state
  passed in Chrome.
- API checks: health `200`; contract version 1; JSON, `no-store`, and `nosniff`
  response controls; invalid date `400`; unsupported POST `405`; unknown route
  `404`; and repeated query performance passed. The API returned 6,776
  unfiltered reviews and 11 review-feed rows for 27-31 July 2026. Review-feed
  date parameters are intentionally separate from global reporting filters.
- The extracted database returned `ok` from `PRAGMA integrity_check` and
  retained exactly 12 Olympic, 2,516 Potts Point, and 4,248 Darling Harbour
  current reviews.
- The current source credential scan covered 113 files and 1,727,671 bytes with
  zero sensitive-content or sensitive-filename matches.
- The rebuilt deterministic archive contains 113 allowlisted files. A fresh
  extraction passed the 224-test root suite, dashboard lint, TypeScript, the
  five-environment production build, 2/2 rendered tests, SQLite integrity and
  exact 12 + 2,516 + 4,248 reconciliation, 62/62 unique public sample IDs,
  checksum verification, and a second secret scan.
- The extracted package's root and dashboard lockfiles exactly matched the
  dependency installations used for testing. A fully new `npm ci` could not be
  exercised because this restricted runner was denied access to its external
  npm cache; another laptop must perform the documented install commands.

Covered behavior includes:

- CLI safety and incremental rejection;
- property configuration and onboarding validation;
- GraphQL capture, batching, persisted queries, and hydration retry;
- challenge and circuit behavior;
- schema and aggregate contracts;
- exact pagination boundaries;
- two-sorter reconciliation;
- photo-host-only semantic parity;
- non-host URL mutation detection;
- transaction rollback and idempotency;
- independent count and inventory attestation;
- immutable versions and presence states;
- current-parser strict all-property export; and
- sanitized logging and release packaging boundaries;
- matched week-to-date and equal-length custom comparisons;
- review/property/topic query combinations;
- exact source category-score propagation; and
- strict dashboard revalidation of Central source-gap evidence.

No old coverage percentages are repeated here because a fresh coverage report
was not part of this documentation update.

## Dashboard and operations analytics

The frontend uses React 19, vinext, Recharts, local Poppins/Fraunces fonts, and
reusable Azzuro-styled components. It is split into Overview, Trends,
Properties, Review insights, Reviews, and Data quality so operations staff do
not face one overloaded page.

The read-only local service in `src/dashboard-data.mjs` reads only current
accepted publications from SQLite. It computes:

- matched elapsed-day current/previous weekly metrics;
- equal-length custom-period comparisons;
- property averages, movement, volume, negative share, response rate, top
  negative topic, last review, and source category scores;
- score distribution and weekly rating/sentiment/volume trends;
- deterministic topic concentration and movement;
- paginated full review search/filter/sort results; and
- per-property confidence status.

Source category scores such as Booking's Cleanliness 9.4 remain separate from
review-text Cleanliness labels. The latter require exact configured phrase
evidence. Charts and cards animate, while `prefers-reduced-motion` disables all
non-essential motion.

For the verified 27-31 July review-feed scope, the API returned 11 reviews and
all eight current negative-topic mention counts were zero under rules `1.0.1`.
That is a valid zero-signal result, not a chart transport failure. Insights now
replaces the zero-width ranking bars with a plain-language empty state. It
reports that no configured operational phrase matched and explicitly keeps
score-only and unsupported-language feedback unclassified. The all-time topic
total is labelled separately so it is not confused with the active-period
negative concentration.

The Properties workspace compares accepted Booking category aggregates on one
fixed 0-10 axis. Missing source values remain blank rather than becoming zero,
properties without an accepted category snapshot are explicitly omitted, and
unknown future Booking categories are appended instead of silently discarded.
The comparison is current-source data and intentionally does not claim a
historical category-score series.

The dashboard exposes no Booking source review tokens. Public review IDs are
one-way hashes, and the API exposes only safe Central source-gap fields.

## Not implemented

- Final authoritative Central Sydney live publication
- Final strict four-property export (correctly blocked until Central qualifies)
- Automatic scheduler
- Public hosted deployment
- Credentialed collection or challenge bypass

## Honest completion assessment

The collector, SQLite layer, insight engine, local API, and operations dashboard
are implemented and well-tested. Three properties have complete, accepted live
publications. Central has a repeatable, evidence-backed source-count
contradiction, and the system can preserve it as a property-specific
attestation instead of hiding it.

It would be inaccurate to claim the four-property dataset is complete until:

1. each property's current source evidence satisfies the full completeness
   contract;
2. each property completes both inventory passes and SQLite attestations;
3. all four current-parser publications exist;
4. database integrity checks pass; and
5. the strict all-property export succeeds.

No such final four-property publication is claimed in this report. Product
functions operate against the 6,776 accepted rows, while Central is displayed
as Pending verification. The current SQLite contains 0 Central rows; a
qualifying live run is still required before the verified amber disclosure
state can appear.

## Recommended next steps

1. Run Central from an unrestricted network through the exact discrepancy
   contract and reject any advertised total, bucket, identity, record,
   terminal-page, or final-head drift.
2. Verify its stored attestation and `PRAGMA integrity_check`.
3. Run `npm run export:all` only after all four current-parser publications
   qualify.
4. Add a scheduler only after Azzurro decides an approved refresh frequency and
   operating policy.

## Responsible-use boundary

This interview implementation targets public review data without an official
API, but it does not attempt to defeat Booking access controls. Production or
recurring use should be reviewed under Azzurro's Booking relationship,
retention policy, privacy obligations, and permitted reuse terms.
