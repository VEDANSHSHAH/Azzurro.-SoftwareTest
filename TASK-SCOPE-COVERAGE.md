# Task scope coverage

This file maps the interview brief to the implemented evidence. Olympic
Paddington replaces the brief's original Surry Hills URL, following the later
interviewer instruction.

## 1. Review collection

| Requirement | Coverage |
| --- | --- |
| Collect public Booking reviews without official API access | Browser-assisted capture of Booking's public structured ReviewList request, followed by validated anonymous replay |
| Review text, rating, date, property, and useful fields | Stored and exported, including title, positive/negative text, date, score, property, guest/stay context, reply, helpful votes, language, photos and highlights when supplied |
| Avoid duplicates | Unique source identity, per-page duplicate rejection, full inventory uniqueness, immutable versions, and stable public export IDs |
| Support new reviews | `refresh:reviews` runs a new full reconciliation, inserts new IDs, versions changed rows, reuses unchanged rows, detects missing rows, and prevents duplicate appends |
| Handle changes and failures | Strict schema, property and query contracts; progress during both passes; rate-limit/challenge detection; Retry-After; bounded retry; circuit breaking; atomic staging; non-zero failure with sanitized summary; previous accepted publication retained |
| Document reliability and limitations | Root README and implementation report |

Collection results:

| Property | Published | Advertised | Result |
| --- | ---: | ---: | --- |
| Olympic Paddington | 12 | 12 | Exact |
| Potts Point | 2,516 | 2,516 | Exact |
| Central Sydney | 0 | 2,537 | Awaiting final live run |
| Darling Harbour | 4,248 | 4,248 | Exact |

Central's diagnostic showed 2,536 retrievable unique cards against 2,537
advertised, with the difference isolated to the 5-7 score bucket (322 versus
323). Those values are independently verified minimum baselines. A later live
total can be higher, but the implementation still requires all four advertised
totals and all five buckets to reconcile, exactly one missing review only in
that bucket, two exact inventories, explicit terminal evidence, and a persisted
attestation. A regression below the baseline, a larger gap, or a discrepancy
for any other property fails closed.

If Central later passes that full contract and is published, it counts as a
verified property and the frontend uses the exact label **Verified with
1-review disclosure**. Its badge remains amber to disclose the one-review
Booking gap. This is not the current data state: SQLite still contains 0
Central rows, and a qualifying unrestricted live run remains required.

If collection stops, no staged partial generation is published. The operator
reruns the affected property from the beginning; partial checkpoint resume is
deliberately omitted because it would weaken completeness and moving-source
checks. The dashboard reload control only refetches accepted SQLite data and
never starts a Booking scrape.

## 2. Operations dashboard

| Minimum requirement | Coverage |
| --- | --- |
| Current-week average | Overview KPI |
| Previous-week comparison | Same elapsed weekdays, with delta and direction |
| Property rating breakdown | Property cards, comparison chart, and matrix |
| Review feed | Paginated cards and full review drawer |
| Date and property filters | Global and review-specific controls |
| Positive and negative trends | Sentiment chart with positive, mixed, negative, and unclassified series |

Additional operations features:

- review volume, response rate, score distribution, and data-through date;
- custom equal-length period comparison;
- property top issue, negative share, response rate, and last review;
- exact Booking property category scores, a fixed-scale cross-property
  comparison, explicit missing-value handling, and an accessible value table;
- text, topic, sentiment, score, language, guest type, room type, and sort
  controls;
- always-visible topic quick filters;
- partner replies, stay context, guest country/type, and topic evidence;
- action queue and topic/property drill-downs;
- per-property data-quality evidence and SQLite integrity;
- URL-persisted state, responsive layouts, accessibility, reduced motion, and
  explicit loading/error/empty states.
- an explicit Insights zero-signal state, so zero matched negative topics are
  explained instead of appearing as a broken empty chart.

## 3. Review insights

All requested topics are implemented:

- Cleanliness
- Check-in experience
- Staff or receptionist behaviour
- Noise
- Facilities
- Location
- Room condition
- Value for money

Method:

- deterministic, versioned, multi-label phrase rules;
- separate positive and negative source channels;
- score-aware sentiment;
- local negation and contrast handling;
- retained matched-term evidence;
- no label when evidence is insufficient.
- classifier rules `1.0.1`, including explicit no-problem handling for text
  placed in Booking's negative-feedback channel.

The example "40% of negative reviews mentioned cleanliness" is calculated as:

```text
reviews with negative cleanliness evidence
------------------------------------------------- x 100
reviews containing any negative feedback
```

The denominator and current reporting period are displayed in plain language.
Topic shares may overlap because one review can mention several issues.

Limitations are explicit: unusual wording, sarcasm, and non-English comments
can remain unclassified; the empty state exposes this rather than inventing a
topic. Source category scores are not inferred review topics.

## 4. Technical freedom and decisions

| Decision | Reason |
| --- | --- |
| Node.js | One runtime for collector, tests, API, and release tools |
| Playwright | Browser-established public request contract and challenge detection |
| SQLite | Single portable local source of truth with transactional publication |
| React/vinext/Recharts | Reusable frontend components and responsive visual analysis |
| Deterministic rules | Explainable, testable, no API key, and no fabricated topic labels |

Portability controls resolve default paths from the extracted project rather
than the launch directory, use the canonical SQLite filename everywhere, use
Playwright's installed Chromium by default, and start the combined app with a
platform-aware npm command. Another supported laptop still needs Node.js 22.13
or newer, installed dependencies and browser binaries, disk space, and network
access capable of loading Booking; universal access or future contract
stability is not claimed.

The design follows DRY/KISS/YAGNI:

- domain calculations stay in `src/`, not in view components;
- shared cards, charts, states, filters, types, and formatting are reused;
- the dashboard API is read-only and local;
- no user accounts, cloud database, scheduler, or unnecessary admin system was
  added for the trial.

## 5. Deliverables

| Deliverable | Status |
| --- | --- |
| Complete source ZIP | Deterministic release rebuilt; fresh extraction passed root/dashboard tests, SQLite reconciliation, allowlist, and secret checks |
| README setup and architecture | Complete |
| Scraper and frontend run instructions | Complete |
| Collection explanation and limitations | Complete |
| Working local application | Complete, backed by included SQLite |
| Sample data | 62 JSONL/CSV rows plus manifest |
| No credentials/secrets | Collector is anonymous; current scan covered 113 source files / 1,727,671 bytes with zero sensitive content or filename matches |

## 6. Evaluation criteria

| Criterion | Evidence |
| --- | --- |
| Collection reliability | Two-pass parity, count/bucket/category proof, terminal and final-head checks |
| Code quality | Separated domain, storage, API, and reusable UI modules |
| Insight accuracy | Labelled fixtures, exact evidence, no forced topics |
| Usability | Six focused workspaces, visible filters, readable review drawer |
| Error/data controls | Fail-closed contracts, typed errors, atomic publication, quality page |
| Documentation | README, implementation report, interview status, checklist |
| Product thinking | Matched periods, action queue, property source scores, drill-downs, honest pending-verification state |

Current verification evidence:

- root suite: 224 total, 218 passed, 0 failed, 6 optional HAR-only checks
  skipped;
- dashboard data service: 6/6 passed;
- dashboard ESLint, TypeScript and production build passed;
- rendered dashboard checks: 2/2 passed;
- API health `200`, contract version 1, SQLite integrity `ok`, and error-method
  contract (`400` invalid date, `405` POST, `404` unknown route) passed; and
- Chrome QA covered all six workspaces, source category values/comparisons,
  review topic filtering and drawer, data-quality states, desktop overflow, and
  the new Insights empty state.
- the header now reports verified publication coverage instead of implying an
  active scrape; lint, TypeScript, build, and rendered regression checks passed.
- a fresh release extraction passed all 224 root tests, dashboard lint,
  TypeScript, the five-stage production build, and 2/2 rendered checks using
  dependency installs with matching lockfile hashes. The sandbox denied a new
  npm-cache read, so clean dependency download remains the documented setup
  step on another laptop.

## Honest completion statement

All requested product functions are implemented and verified against the 6,776
accepted reviews currently in SQLite. The only unfulfilled live-data item is
Central Sydney collection, which cannot be truthfully completed without one
final unrestricted Booking run. The current SQLite contains 0 Central rows.
The application exposes that limitation instead of masking it; only after a
qualifying accepted run will Central count as verified and display **Verified
with 1-review disclosure** in amber.
