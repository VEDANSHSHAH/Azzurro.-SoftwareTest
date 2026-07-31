import { createHash } from "node:crypto";

import {
  classifyHttpBody,
  ContractError,
  stableStringify,
  validateReviewListResponse,
} from "./review-contract.mjs";
import {
  isSemanticallyUnfiltered,
  REVIEW_SCORE_RANGE_VALUES,
  reviewScoreMatchesRange,
} from "./live-template.mjs";
import { retryDecision } from "./retry.mjs";
import {
  assertSourceGap,
  identifySourceGap,
  maxAllowedSourceGap,
} from "./source-discrepancy.mjs";

const PAGE_SIZE = 10;
const EMPTY_FILTERS = Object.freeze({ text: "" });

export class CollectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CollectionError";
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function categoryDigest(ratingScores) {
  const canonical = [...ratingScores]
    .map((score) => ({
      name: score?.name ?? null,
      translation: score?.translation ?? null,
      value: score?.value ?? null,
      ufiScoresAverage: score?.ufiScoresAverage ?? null,
      typename: score?.__typename ?? null,
    }))
    .sort((left, right) =>
      String(left.name).localeCompare(String(right.name)),
    );
  return sha256(stableStringify(canonical));
}

const TRUSTED_TOTAL_SOURCES = Object.freeze([
  "customerTypeFilter.ALL",
  "languageFilter.empty",
  "reviewScoreFilter.ALL",
  "timeOfYearFilter.ALL",
]);

function authoritativeAggregateEvidence(
  page,
  {
    visibleReviewCount = null,
    requireVisibleReviewCount = false,
  } = {},
) {
  const totals = page?.totalConsistency?.totals ?? [];
  const sources = totals.map((item) => item?.source).sort();
  const totalStatus = page?.totalConsistency?.status ?? null;
  if (
    !["consistent", "inconsistent"].includes(totalStatus) ||
    stableStringify(sources) !==
      stableStringify(TRUSTED_TOTAL_SOURCES)
  ) {
    throw new CollectionError(
      "INSUFFICIENT_COUNT_EVIDENCE",
      "Authoritative collection requires all four trusted All totals",
      {
        totalStatus,
        observedSources: sources,
      },
    );
  }

  const scoreFilters = page?.filters?.reviewScores ?? [];
  const scoreCounts = new Map(
    scoreFilters.map((item) => [item?.value, item?.count]),
  );
  const expectedScoreValues = [
    "ALL",
    ...REVIEW_SCORE_RANGE_VALUES,
  ].sort();
  const observedScoreValues = [...scoreCounts.keys()].sort();
  if (
    stableStringify(observedScoreValues) !==
      stableStringify(expectedScoreValues)
  ) {
    throw new CollectionError(
      "SCORE_BUCKET_CONTRACT",
      "Authoritative collection requires the exact proven score buckets",
      { observedScoreValues },
    );
  }
  const bucketCounts = REVIEW_SCORE_RANGE_VALUES.map((value) => ({
    value,
    count: scoreCounts.get(value),
  }));
  const advertisedCount = scoreCounts.get("ALL");
  const sourceGap = Number.isSafeInteger(advertisedCount)
    ? advertisedCount - page.reviewsCount
    : null;
  if (
    sourceGap === null ||
    sourceGap < 0 ||
    sourceGap > maxAllowedSourceGap(advertisedCount)
  ) {
    throw new CollectionError(
      "SOURCE_COUNT_GAP_OUT_OF_BOUNDS",
      "Booking's advertised and retrievable review counts differ by more than the tolerated source gap",
      {
        structuredReviewCount: page.reviewsCount,
        advertisedReviewCount: advertisedCount ?? null,
        maximumGap: maxAllowedSourceGap(advertisedCount),
      },
    );
  }
  if (
    bucketCounts.some(
      ({ count }) =>
        !Number.isSafeInteger(count) || count < 0,
    ) ||
    scoreCounts.get("ALL") !== advertisedCount ||
    bucketCounts.reduce((sum, item) => sum + item.count, 0) !==
      advertisedCount
  ) {
    throw new CollectionError(
      "SCORE_BUCKET_COUNT_MISMATCH",
      "Score-bucket counts do not reconcile to the review inventory",
      {
        reviewsCount: page.reviewsCount,
        advertisedCount,
        allCount: scoreCounts.get("ALL") ?? null,
        bucketCounts,
      },
    );
  }
  if (
    page.reviewsCount > 0 &&
    (!Array.isArray(page.ratingScores) ||
      page.ratingScores.length === 0)
  ) {
    throw new CollectionError(
      "EMPTY_CATEGORY_PROFILE",
      "A non-empty property requires category scores for authoritative collection",
    );
  }
  if (
    requireVisibleReviewCount &&
    (!Number.isSafeInteger(visibleReviewCount) ||
      visibleReviewCount < 0)
  ) {
    throw new CollectionError(
      "VISIBLE_COUNT_UNAVAILABLE",
      "The visible review count is required for authoritative collection",
    );
  }
  if (
    visibleReviewCount !== null &&
    visibleReviewCount !== advertisedCount
  ) {
    throw new CollectionError(
      "VISIBLE_COUNT_MISMATCH",
      "Visible modal count does not match structured count",
      {
        visibleReviewCount,
        structuredReviewCount: page.reviewsCount,
        advertisedReviewCount: advertisedCount,
      },
    );
  }

  return {
    reviewsCount: advertisedCount,
    retrievableReviewCount: page.reviewsCount,
    trustedTotals: totals
      .map(({ source, count }) => ({ source, count }))
      .sort((left, right) =>
        left.source.localeCompare(right.source),
      ),
    scoreBuckets: bucketCounts,
  };
}

function authoritativeAggregateDigest(page) {
  return sha256(
    stableStringify(authoritativeAggregateEvidence(page)),
  );
}

function pageIdentityDigest(reviews) {
  return sha256(
    stableStringify(reviews.map((review) => review.sourceReviewToken)),
  );
}

function pageRecordDigest(reviews) {
  return sha256(
    stableStringify(
      reviews.map((review) => [
        review.sourceReviewToken,
        review.recordHash,
      ]),
    ),
  );
}

function sleepDefault(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function toCollectionError(classification, request) {
  const codeByKind = {
    challenge: "CHALLENGE",
    rate_limited: "RATE_LIMITED",
    access_denied: "ACCESS_DENIED",
    unexpected_content: "UNEXPECTED_CONTENT",
    invalid_json: "INVALID_JSON",
    temporary_server_error: "SERVER_ERROR",
    timeout: "TIMEOUT",
    network_error: "NETWORK_ERROR",
  };
  const kind = classification?.kind ?? "unknown";
  return new CollectionError(
    codeByKind[kind] ?? "TRANSPORT_ERROR",
    `ReviewList request failed: ${kind}`,
    {
      skip: request.skip,
      sorter: request.sorter,
      status: request.status ?? null,
      rescheduleAfterMs: request.rescheduleAfterMs ?? null,
    },
  );
}

function isUnfilteredFilterSet(filters) {
  return isSemanticallyUnfiltered(filters);
}

export async function fetchValidatedPage({
  property,
  fetchRaw,
  skip = 0,
  limit = PAGE_SIZE,
  sorter = "NEWEST_FIRST",
  filters = EMPTY_FILTERS,
  maxAttempts = 3,
  sleep = sleepDefault,
  retryRandom = Math.random,
}) {
  if (typeof fetchRaw !== "function") {
    throw new TypeError("fetchRaw must be a function");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let raw;
    try {
      raw = await fetchRaw({ skip, limit, sorter, filters });
    } catch (error) {
      raw = {
        status: null,
        contentType: "",
        text: "",
        elapsedMs: 0,
        responseBytes: 0,
        retryAfter: null,
        classification: {
          kind:
            error?.name === "AbortError" ? "timeout" : "network_error",
        },
      };
    }

    const classification =
      raw.classification ??
      classifyHttpBody({
        status: raw.status,
        contentType: raw.contentType,
        text: raw.text,
      });

    if (classification.kind === "json") {
      try {
        const validated = validateReviewListResponse(
          classification.body,
          {
            propertyKey: property.key,
            skip,
            limit,
            unfiltered: isUnfilteredFilterSet(filters),
          },
        );
        return {
          ...validated,
          request: {
            skip,
            limit,
            sorter,
            attempt,
            retries: attempt - 1,
            status: raw.status,
            elapsedMs: raw.elapsedMs ?? null,
            responseBytes:
              raw.responseBytes ??
              Buffer.byteLength(raw.text ?? "", "utf8"),
          },
        };
      } catch (error) {
        if (error instanceof ContractError) {
          throw new CollectionError(
            "CONTRACT_ERROR",
            error.message,
            {
              skip,
              sorter,
              contractDetails: error.details,
            },
          );
        }
        throw error;
      }
    }

    const decision = retryDecision({
      classification,
      attempt,
      maxAttempts,
      retryAfter: raw.retryAfter,
      random: retryRandom,
    });
    if (!decision.retry) {
      throw toCollectionError(classification, {
        skip,
        sorter,
        status: raw.status,
        rescheduleAfterMs: decision.rescheduleAfterMs,
      });
    }
    await sleep(decision.delayMs);
  }

  throw new CollectionError(
    "ATTEMPT_BUDGET_EXHAUSTED",
    "ReviewList attempt budget exhausted",
  );
}

function assertSorterSupport(page) {
  const values = new Set(page.sorters.map((sorter) => sorter?.value));
  for (const required of ["NEWEST_FIRST", "OLDEST_FIRST"]) {
    if (!values.has(required)) {
      throw new CollectionError(
        "UNSUPPORTED_SORTER",
        `Booking did not advertise ${required}`,
      );
    }
  }
}

export async function runPropertyCanary({
  property,
  fetchRaw,
  capturedHotelId,
  visibleReviewCount = null,
  maxAttempts = 3,
  sleep = sleepDefault,
  retryRandom = Math.random,
  betweenRequests = async () => {},
  requireAuthoritativeEvidence = false,
}) {
  if (Number(capturedHotelId) !== property.hotelId) {
    throw new CollectionError(
      "PROPERTY_IDENTITY_MISMATCH",
      "Captured ReviewList hotel ID does not match configuration",
      {
        configuredHotelId: property.hotelId,
        capturedHotelId: Number(capturedHotelId),
      },
    );
  }

  const common = {
    property,
    fetchRaw,
    maxAttempts,
    sleep,
    retryRandom,
  };
  const newest = await fetchValidatedPage({
    ...common,
    sorter: "NEWEST_FIRST",
    skip: 0,
  });
  await betweenRequests();
  const oldest = await fetchValidatedPage({
    ...common,
    sorter: "OLDEST_FIRST",
    skip: 0,
  });

  assertSorterSupport(newest);
  assertSorterSupport(oldest);
  assertMonotonic(null, newest, "NEWEST_FIRST");
  assertMonotonic(null, oldest, "OLDEST_FIRST");
  if (
    newest.reviewsCount > 1 &&
    newest.cardCount > 1 &&
    oldest.cardCount > 1 &&
    pageIdentityDigest(newest.reviews) ===
      pageIdentityDigest(oldest.reviews)
  ) {
    throw new CollectionError(
      "SORTER_NOT_APPLIED",
      "Newest and oldest canaries returned the same ordered review page",
    );
  }
  if (newest.reviewsCount !== oldest.reviewsCount) {
    throw new CollectionError(
      "MOVING_REVIEW_COUNT",
      "Newest and oldest canaries returned different review counts",
      {
        newestCount: newest.reviewsCount,
        oldestCount: oldest.reviewsCount,
      },
    );
  }
  const newestCategoryDigest = categoryDigest(newest.ratingScores);
  const oldestCategoryDigest = categoryDigest(oldest.ratingScores);
  if (newestCategoryDigest !== oldestCategoryDigest) {
    throw new CollectionError(
      "MOVING_CATEGORY_SCORES",
      "Property category scores changed between canaries",
    );
  }
  let aggregateDigest = null;
  let aggregateEvidence = null;
  let sourceDiscrepancy = null;
  if (requireAuthoritativeEvidence) {
    aggregateEvidence = authoritativeAggregateEvidence(newest, {
      visibleReviewCount,
      requireVisibleReviewCount: true,
    });
    const oldestAggregateEvidence =
      authoritativeAggregateEvidence(oldest, {
        visibleReviewCount,
        requireVisibleReviewCount: true,
      });
    aggregateDigest = sha256(stableStringify(aggregateEvidence));
    if (
      aggregateDigest !==
      sha256(stableStringify(oldestAggregateEvidence))
    ) {
      throw new CollectionError(
        "MOVING_AGGREGATE_COUNTS",
        "Trusted aggregate counts changed between canaries",
      );
    }
    try {
      sourceDiscrepancy = identifySourceGap({
        propertyKey: property.key,
        bookingHotelId: property.hotelId,
        aggregateEvidence,
      });
    } catch (error) {
      throw new CollectionError(
        "SOURCE_COUNT_GAP_INVALID",
        "Booking's advertised review evidence does not support a tolerated source gap",
        { causeCode: error?.code ?? "INVALID_EVIDENCE" },
      );
    }
  } else if (
    visibleReviewCount !== null &&
    visibleReviewCount !== newest.reviewsCount
  ) {
    throw new CollectionError(
      "VISIBLE_COUNT_MISMATCH",
      "Visible modal count does not match structured count",
      {
        visibleReviewCount,
        structuredReviewCount: newest.reviewsCount,
      },
    );
  }

  return {
    reviewsCount: newest.reviewsCount,
    categoryDigest: newestCategoryDigest,
    ratingScores: newest.ratingScores,
    filters: newest.filters,
    aggregateDigest,
    aggregateEvidence,
    sourceDiscrepancy,
    newest,
    oldest,
  };
}

function assertPageShape(page, { skip, count, limit }) {
  const expected = Math.max(0, Math.min(limit, count - skip));
  if (page.cardCount !== expected) {
    throw new CollectionError(
      "PAGE_SHAPE_MISMATCH",
      `Offset ${skip} returned ${page.cardCount} cards; expected ${expected}`,
      { skip, expected, actual: page.cardCount, count },
    );
  }
}

function assertMonotonic(previousEpoch, page, sorter) {
  let prior = previousEpoch;
  for (const review of page.reviews) {
    if (
      prior !== null &&
      ((sorter === "OLDEST_FIRST" && review.reviewedDateRaw < prior) ||
        (sorter === "NEWEST_FIRST" && review.reviewedDateRaw > prior))
    ) {
      throw new CollectionError(
        "NON_MONOTONIC_PAGINATION",
        `${sorter} review dates moved in the wrong direction`,
        { sorter, reviewedDateRaw: review.reviewedDateRaw, prior },
      );
    }
    prior = review.reviewedDateRaw;
  }
  return prior;
}

export async function collectInventoryPhase({
  property,
  fetchRaw,
  sorter,
  reportedCount,
  sourceDiscrepancy = null,
  categoryDigest: expectedCategoryDigest,
  aggregateDigest: expectedAggregateDigest = null,
  firstPage = null,
  onPage = async () => {},
  delay = async () => {},
  maxAttempts = 3,
  maxPages = null,
  sleep = sleepDefault,
  retryRandom = Math.random,
}) {
  if (!["NEWEST_FIRST", "OLDEST_FIRST"].includes(sorter)) {
    throw new TypeError("sorter must be NEWEST_FIRST or OLDEST_FIRST");
  }
  if (
    sourceDiscrepancy !== null &&
    expectedAggregateDigest === null
  ) {
    throw new CollectionError(
      "UNATTESTED_SOURCE_DISCREPANCY",
      "A known source discrepancy requires authoritative aggregate evidence",
    );
  }
  const retrievableCount =
    sourceDiscrepancy?.retrievableReviewCount ?? reportedCount;
  if (
    !Number.isSafeInteger(retrievableCount) ||
    retrievableCount < 0
  ) {
    throw new TypeError(
      "sourceDiscrepancy.retrievableReviewCount must be a non-negative safe integer",
    );
  }
  if (
    sourceDiscrepancy === null &&
    retrievableCount !== reportedCount
  ) {
    throw new CollectionError(
      "UNATTESTED_SOURCE_DISCREPANCY",
      "A retrievable count may differ only under an exact known-source discrepancy contract",
    );
  }
  const dataPageCount = Math.ceil(retrievableCount / PAGE_SIZE);
  if (maxPages !== null && dataPageCount > maxPages) {
    throw new CollectionError(
      "PAGE_SAFETY_CAP",
      `Required ${dataPageCount} pages, exceeding cap ${maxPages}`,
    );
  }

  const keys = new Set();
  const hashes = new Map();
  const pageDigests = new Set();
  const pages = [];
  const observedScoreBuckets = new Map(
    REVIEW_SCORE_RANGE_VALUES.map((value) => [value, 0]),
  );
  let expectedScoreBuckets = null;
  let previousEpoch = null;

  for (let pageNumber = 0; pageNumber < dataPageCount; pageNumber += 1) {
    const skip = pageNumber * PAGE_SIZE;
    const page =
      pageNumber === 0 && firstPage
        ? firstPage
        : await fetchValidatedPage({
            property,
            fetchRaw,
            skip,
            limit: PAGE_SIZE,
            sorter,
            maxAttempts,
            sleep,
            retryRandom,
          });

    if (page.reviewsCount !== reportedCount) {
      throw new CollectionError(
        "MOVING_REVIEW_COUNT",
        `Count changed from ${reportedCount} to ${page.reviewsCount}`,
        { skip, sorter },
      );
    }
    if (categoryDigest(page.ratingScores) !== expectedCategoryDigest) {
      throw new CollectionError(
        "MOVING_CATEGORY_SCORES",
        `Category scores changed at offset ${skip}`,
      );
    }
    if (
      expectedAggregateDigest !== null &&
      authoritativeAggregateDigest(page) !==
        expectedAggregateDigest
    ) {
      throw new CollectionError(
        "MOVING_AGGREGATE_COUNTS",
        `Trusted aggregate counts changed at offset ${skip}`,
      );
    }
    if (expectedAggregateDigest !== null) {
      expectedScoreBuckets ??= new Map(
        authoritativeAggregateEvidence(page).scoreBuckets.map(
          ({ value, count }) => [value, count],
        ),
      );
    }
    assertPageShape(page, {
      skip,
      count: retrievableCount,
      limit: PAGE_SIZE,
    });
    previousEpoch = assertMonotonic(previousEpoch, page, sorter);

    const digest = pageIdentityDigest(page.reviews);
    if (pageDigests.has(digest)) {
      throw new CollectionError(
        "REPEATED_PAGE",
        `A page identity sequence repeated at offset ${skip}`,
      );
    }
    pageDigests.add(digest);

    for (const review of page.reviews) {
      if (keys.has(review.sourceKey)) {
        throw new CollectionError(
          "DUPLICATE_IN_INVENTORY",
          "A review identity appeared more than once in one inventory",
          { skip },
        );
      }
      keys.add(review.sourceKey);
      hashes.set(review.sourceKey, review.recordHash);
      if (expectedAggregateDigest !== null) {
        const matchingRanges = REVIEW_SCORE_RANGE_VALUES.filter(
          (scoreRange) =>
            reviewScoreMatchesRange(
              review.reviewScore,
              scoreRange,
            ),
        );
        if (matchingRanges.length !== 1) {
          throw new CollectionError(
            "REVIEW_SCORE_OUTSIDE_PROVEN_BUCKETS",
            "A review score does not belong to exactly one proven score bucket",
            { reviewScore: review.reviewScore },
          );
        }
        const scoreRange = matchingRanges[0];
        observedScoreBuckets.set(
          scoreRange,
          observedScoreBuckets.get(scoreRange) + 1,
        );
      }
    }

    await onPage({
      page,
      pageNumber,
      skip,
      sorter,
      terminal: false,
      identityDigest: digest,
    });
    pages.push(page);
    await delay();
  }

  if (retrievableCount === 0) {
    const empty =
      firstPage ??
      (await fetchValidatedPage({
        property,
        fetchRaw,
        skip: 0,
        limit: PAGE_SIZE,
        sorter,
        maxAttempts,
        sleep,
        retryRandom,
      }));
    assertPageShape(empty, {
      skip: 0,
      count: retrievableCount,
      limit: PAGE_SIZE,
    });
    if (
      categoryDigest(empty.ratingScores) !==
        expectedCategoryDigest
    ) {
      throw new CollectionError(
        "MOVING_CATEGORY_SCORES",
        "Category scores changed on the zero-review terminal page",
      );
    }
    if (
      expectedAggregateDigest !== null &&
      authoritativeAggregateDigest(empty) !==
        expectedAggregateDigest
    ) {
      throw new CollectionError(
        "MOVING_AGGREGATE_COUNTS",
        "Trusted aggregate counts changed on the zero-review terminal page",
      );
    }
    if (expectedAggregateDigest !== null) {
      expectedScoreBuckets ??= new Map(
        authoritativeAggregateEvidence(empty).scoreBuckets.map(
          ({ value, count }) => [value, count],
        ),
      );
    }
    await onPage({
      page: empty,
      pageNumber: 0,
      skip: 0,
      sorter,
      terminal: true,
      identityDigest: pageIdentityDigest(empty.reviews),
    });
  } else {
    const afterEndSkip = dataPageCount * PAGE_SIZE;
    const terminal = await fetchValidatedPage({
      property,
      fetchRaw,
      skip: afterEndSkip,
      limit: PAGE_SIZE,
      sorter,
      maxAttempts,
      sleep,
      retryRandom,
    });
    if (
      terminal.reviewsCount !== reportedCount ||
      terminal.cardCount !== 0
    ) {
      throw new CollectionError(
        "AFTER_END_NOT_EMPTY",
        `After-end offset ${afterEndSkip} was not an empty stable page`,
        {
          count: terminal.reviewsCount,
          cards: terminal.cardCount,
        },
      );
    }
    if (
      categoryDigest(terminal.ratingScores) !==
        expectedCategoryDigest
    ) {
      throw new CollectionError(
        "MOVING_CATEGORY_SCORES",
        `Category scores changed at terminal offset ${afterEndSkip}`,
      );
    }
    if (
      expectedAggregateDigest !== null &&
      authoritativeAggregateDigest(terminal) !==
        expectedAggregateDigest
    ) {
      throw new CollectionError(
        "MOVING_AGGREGATE_COUNTS",
        `Trusted aggregate counts changed at terminal offset ${afterEndSkip}`,
      );
    }
    await onPage({
      page: terminal,
      pageNumber: dataPageCount,
      skip: afterEndSkip,
      sorter,
      terminal: true,
      identityDigest: pageIdentityDigest(terminal.reviews),
    });
  }

  let discrepancyEvidence = null;
  if (expectedAggregateDigest !== null) {
    const advertisedScoreBuckets = [
      ...expectedScoreBuckets,
    ].map(([value, count]) => ({ value, count }));
    const retrievableScoreBuckets = [
      ...observedScoreBuckets,
    ].map(([value, count]) => ({ value, count }));
    if (sourceDiscrepancy !== null) {
      try {
        discrepancyEvidence = assertSourceGap({
          propertyKey: property.key,
          bookingHotelId: property.hotelId,
          advertisedReviewCount:
            sourceDiscrepancy.advertisedReviewCount,
          retrievableReviewCount: retrievableCount,
          advertisedTrustedTotals:
            sourceDiscrepancy.advertisedTrustedTotals,
          advertisedScoreBuckets,
          retrievableScoreBuckets,
          contractKind: sourceDiscrepancy.contractKind,
        });
      } catch (error) {
        throw new CollectionError(
          "SOURCE_COUNT_GAP_INVALID",
          "The collected inventory does not reconcile with Booking's advertised source gap",
          { cause: error?.message ?? String(error) },
        );
      }
    } else if (
      stableStringify([...observedScoreBuckets]) !==
      stableStringify([...expectedScoreBuckets])
    ) {
      throw new CollectionError(
        "INVENTORY_SCORE_DISTRIBUTION_MISMATCH",
        "Collected review scores do not reconcile to the advertised score buckets",
        {
          observedScoreBuckets: Object.fromEntries(
            observedScoreBuckets,
          ),
          expectedScoreBuckets: Object.fromEntries(
            expectedScoreBuckets,
          ),
        },
      );
    }
  }

  if (keys.size !== retrievableCount) {
    throw new CollectionError(
      "INVENTORY_COUNT_MISMATCH",
      `Collected ${keys.size} unique identities; expected ${retrievableCount}`,
    );
  }
  return {
    sorter,
    reportedCount,
    retrievableCount,
    keys,
    hashes,
    pages,
    sourceDiscrepancy: discrepancyEvidence,
  };
}

export function assertExactInventoryParity(first, second) {
  if (first.reportedCount !== second.reportedCount) {
    throw new CollectionError(
      "INVENTORY_COUNT_MISMATCH",
      "Independent inventories reported different counts",
    );
  }
  if (first.retrievableCount !== second.retrievableCount) {
    throw new CollectionError(
      "INVENTORY_COUNT_MISMATCH",
      "Independent inventories have different retrievable counts",
    );
  }
  if (first.keys.size !== second.keys.size) {
    throw new CollectionError(
      "INVENTORY_IDENTITY_MISMATCH",
      "Independent inventories have different unique-key counts",
    );
  }
  for (const key of first.keys) {
    if (!second.keys.has(key)) {
      throw new CollectionError(
        "INVENTORY_IDENTITY_MISMATCH",
        "Independent inventories have different identity sets",
      );
    }
    if (first.hashes.get(key) !== second.hashes.get(key)) {
      throw new CollectionError(
        "INVENTORY_RECORD_MISMATCH",
        "A review changed between independent inventories",
      );
    }
  }
  return true;
}

export async function collectIncrementalWindow({
  property,
  fetchRaw,
  reportedCount,
  categoryDigest: expectedCategoryDigest,
  knownSourceTokens,
  firstPage = null,
  rollingWindowDays = 90,
  requiredKnownPages = 2,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
  onPage = async () => {},
  delay = async () => {},
  maxAttempts = 3,
  maxPages = 100,
  sleep = sleepDefault,
  retryRandom = Math.random,
}) {
  if (!(knownSourceTokens instanceof Set)) {
    throw new TypeError("knownSourceTokens must be a Set");
  }
  if (
    !Number.isInteger(rollingWindowDays) ||
    rollingWindowDays < 1 ||
    rollingWindowDays > 3650
  ) {
    throw new TypeError("rollingWindowDays must be from 1 to 3650");
  }
  if (
    !Number.isInteger(requiredKnownPages) ||
    requiredKnownPages < 1 ||
    requiredKnownPages > 10
  ) {
    throw new TypeError("requiredKnownPages must be from 1 to 10");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new TypeError("maxPages must be a positive integer");
  }

  const cutoff =
    nowEpochSeconds - rollingWindowDays * 24 * 60 * 60;
  const stagedKeys = new Set();
  const pageDigests = new Set();
  let consecutiveKnownOldPages = 0;
  let previousEpoch = null;
  let firstDigest = null;
  let stopReason = null;
  let pagesFetched = 0;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const skip = pageNumber * PAGE_SIZE;
    const page =
      pageNumber === 0 && firstPage
        ? firstPage
        : await fetchValidatedPage({
            property,
            fetchRaw,
            skip,
            limit: PAGE_SIZE,
            sorter: "NEWEST_FIRST",
            maxAttempts,
            sleep,
            retryRandom,
          });
    pagesFetched += 1;

    if (page.reviewsCount !== reportedCount) {
      throw new CollectionError(
        "MOVING_REVIEW_COUNT",
        `Count changed from ${reportedCount} to ${page.reviewsCount}`,
        { skip, sorter: "NEWEST_FIRST" },
      );
    }
    if (categoryDigest(page.ratingScores) !== expectedCategoryDigest) {
      throw new CollectionError(
        "MOVING_CATEGORY_SCORES",
        `Category scores changed at offset ${skip}`,
      );
    }
    assertPageShape(page, {
      skip,
      count: reportedCount,
      limit: PAGE_SIZE,
    });
    previousEpoch = assertMonotonic(
      previousEpoch,
      page,
      "NEWEST_FIRST",
    );

    const identityDigest = pageIdentityDigest(page.reviews);
    const recordDigest = pageRecordDigest(page.reviews);
    if (pageDigests.has(identityDigest)) {
      throw new CollectionError(
        "REPEATED_PAGE",
        `A page identity sequence repeated at offset ${skip}`,
      );
    }
    pageDigests.add(identityDigest);
    if (pageNumber === 0) firstDigest = recordDigest;

    for (const review of page.reviews) {
      if (stagedKeys.has(review.sourceKey)) {
        throw new CollectionError(
          "DUPLICATE_IN_INCREMENTAL",
          "A review identity appeared on multiple incremental pages",
          { skip },
        );
      }
      stagedKeys.add(review.sourceKey);
    }

    await onPage({
      page,
      pageNumber,
      skip,
      sorter: "NEWEST_FIRST",
      terminal: page.cardCount === 0,
      identityDigest,
    });

    const pageAllKnown = page.reviews.every((review) =>
      knownSourceTokens.has(review.sourceReviewToken),
    );
    const pageEntirelyOlder =
      page.reviews.length > 0 &&
      page.reviews.every(
        (review) => review.reviewedDateRaw < cutoff,
      );
    consecutiveKnownOldPages =
      pageAllKnown && pageEntirelyOlder
        ? consecutiveKnownOldPages + 1
        : 0;

    if (page.cardCount === 0 || skip + page.cardCount >= reportedCount) {
      stopReason = "source_end";
      break;
    }
    if (consecutiveKnownOldPages >= requiredKnownPages) {
      stopReason = "known_rolling_window";
      break;
    }
    await delay();
  }

  if (stopReason === null) {
    throw new CollectionError(
      "INCREMENTAL_PAGE_CAP",
      `Incremental scan did not reach a safe stop within ${maxPages} pages`,
    );
  }

  await delay();
  const finalHead = await fetchValidatedPage({
    property,
    fetchRaw,
    skip: 0,
    limit: PAGE_SIZE,
    sorter: "NEWEST_FIRST",
    maxAttempts,
    sleep,
    retryRandom,
  });
  if (
    finalHead.reviewsCount !== reportedCount ||
    categoryDigest(finalHead.ratingScores) !== expectedCategoryDigest ||
    pageRecordDigest(finalHead.reviews) !== firstDigest
  ) {
    throw new CollectionError(
      "MOVING_HEAD",
      "The newest review page changed during the incremental scan",
    );
  }

  return {
    reportedCount,
    stagedKeys,
    pagesFetched,
    stopReason,
    finalHead,
  };
}

export const collectorInternals = Object.freeze({
  PAGE_SIZE,
  categoryDigest,
  authoritativeAggregateDigest,
  authoritativeAggregateEvidence,
  pageIdentityDigest,
  pageRecordDigest,
});
