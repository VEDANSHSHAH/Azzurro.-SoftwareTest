import {
  REVIEW_SCORE_RANGE_VALUES,
} from "./live-template.mjs";

const TRUSTED_TOTAL_SOURCES = Object.freeze([
  "customerTypeFilter.ALL",
  "languageFilter.empty",
  "reviewScoreFilter.ALL",
  "timeOfYearFilter.ALL",
]);

function frozenEntries(entries) {
  return Object.freeze(
    entries.map((entry) => Object.freeze({ ...entry })),
  );
}

// Booking's aggregate filter counts and its paginated ReviewList inventory can
// disagree by a small number of reviews. The gap is a property of the source,
// not of any one hotel, so it is tolerated within bounds and disclosed rather
// than required, pinned to a hotel, or pinned to a score bucket.
export const SOURCE_GAP_CONTRACT = Object.freeze({
  contractKind: "booking_source_count_gap_v1",
  contractVersion: 1,
  maxAbsoluteGap: 5,
  maxGapFraction: 0.01,
  trustedTotalSources: TRUSTED_TOTAL_SOURCES,
});

export function maxAllowedSourceGap(advertisedReviewCount) {
  if (
    !Number.isSafeInteger(advertisedReviewCount) ||
    advertisedReviewCount < 0
  ) {
    return 0;
  }
  // Floor, so a property too small for the fraction to reach one review
  // tolerates no gap at all rather than silently dropping a real share of it.
  return Math.min(
    SOURCE_GAP_CONTRACT.maxAbsoluteGap,
    Math.floor(
      advertisedReviewCount * SOURCE_GAP_CONTRACT.maxGapFraction,
    ),
  );
}

export class SourceDiscrepancyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SourceDiscrepancyError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new SourceDiscrepancyError(code, message, details);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value, expected, path) {
  if (!isPlainObject(value)) {
    fail(
      "INVALID_EVIDENCE_SHAPE",
      `${path} must be a plain object`,
    );
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(
      "INVALID_EVIDENCE_SHAPE",
      `${path} must contain only the required fields`,
      { path, expectedKeys: wanted, observedKeys: actual },
    );
  }
}

function assertNonNegativeSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "INVALID_COUNT",
      `${path} must be a non-negative safe integer`,
      { path, observed: value },
    );
  }
}

function assertPropertyIdentity(propertyKey, bookingHotelId) {
  if (typeof propertyKey !== "string" || propertyKey.trim() === "") {
    fail(
      "PROPERTY_IDENTITY_MISMATCH",
      "A source-gap attestation requires a property key",
      { propertyKey },
    );
  }
  if (
    !Number.isSafeInteger(bookingHotelId) ||
    bookingHotelId <= 0
  ) {
    fail(
      "PROPERTY_IDENTITY_MISMATCH",
      "A source-gap attestation requires a positive Booking hotel ID",
      { propertyKey, bookingHotelId },
    );
  }
}

function assertGapWithinBounds(
  advertisedReviewCount,
  retrievableReviewCount,
) {
  const gapCount = advertisedReviewCount - retrievableReviewCount;
  if (gapCount <= 0) {
    fail(
      "GAP_COUNT_MISMATCH",
      "A source-gap attestation requires at least one advertised but unretrievable review",
      { advertisedReviewCount, retrievableReviewCount },
    );
  }
  const maximumGap = maxAllowedSourceGap(advertisedReviewCount);
  if (gapCount > maximumGap) {
    fail(
      "GAP_COUNT_MISMATCH",
      "The advertised and retrievable review counts differ by more than the tolerated source gap",
      {
        advertisedReviewCount,
        retrievableReviewCount,
        gapCount,
        maximumGap,
      },
    );
  }
  return gapCount;
}

function normalizeTrustedTotals(
  trustedTotals,
  advertisedReviewCount,
) {
  if (
    !Array.isArray(trustedTotals) ||
    trustedTotals.length !== TRUSTED_TOTAL_SOURCES.length
  ) {
    fail(
      "TRUSTED_TOTALS_MISMATCH",
      "Source-gap evidence requires all four trusted advertised totals",
      {
        observedLength: Array.isArray(trustedTotals)
          ? trustedTotals.length
          : null,
      },
    );
  }

  const bySource = new Map();
  for (const [index, item] of trustedTotals.entries()) {
    assertExactKeys(
      item,
      ["source", "count"],
      `trustedTotals[${index}]`,
    );
    if (
      !TRUSTED_TOTAL_SOURCES.includes(item.source) ||
      bySource.has(item.source)
    ) {
      fail(
        "TRUSTED_TOTALS_MISMATCH",
        "Trusted advertised totals contain an unknown or duplicate source",
        { source: item.source },
      );
    }
    assertNonNegativeSafeInteger(
      item.count,
      `trustedTotals[${index}].count`,
    );
    if (item.count !== advertisedReviewCount) {
      fail(
        "TRUSTED_TOTALS_MISMATCH",
        "Every trusted advertised total must equal the accepted live advertised count",
        {
          source: item.source,
          observed: item.count,
          advertisedReviewCount,
        },
      );
    }
    bySource.set(item.source, item.count);
  }

  for (const source of TRUSTED_TOTAL_SOURCES) {
    if (!bySource.has(source)) {
      fail(
        "TRUSTED_TOTALS_MISMATCH",
        "Trusted advertised totals are missing a required source",
        { source },
      );
    }
  }

  return frozenEntries(
    TRUSTED_TOTAL_SOURCES.map((source) => ({
      source,
      count: bySource.get(source),
    })),
  );
}

function normalizeScoreBuckets(scoreBuckets, path) {
  if (
    !Array.isArray(scoreBuckets) ||
    scoreBuckets.length !== REVIEW_SCORE_RANGE_VALUES.length
  ) {
    fail(
      "SCORE_BUCKETS_MISMATCH",
      `${path} must contain the exact five score buckets`,
      {
        path,
        observedLength: Array.isArray(scoreBuckets)
          ? scoreBuckets.length
          : null,
      },
    );
  }

  const byValue = new Map();
  for (const [index, item] of scoreBuckets.entries()) {
    assertExactKeys(
      item,
      ["value", "count"],
      `${path}[${index}]`,
    );
    if (
      !REVIEW_SCORE_RANGE_VALUES.includes(item.value) ||
      byValue.has(item.value)
    ) {
      fail(
        "SCORE_BUCKETS_MISMATCH",
        `${path} contains an unknown or duplicate bucket`,
        { path, value: item.value },
      );
    }
    assertNonNegativeSafeInteger(
      item.count,
      `${path}[${index}].count`,
    );
    byValue.set(item.value, item.count);
  }

  for (const value of REVIEW_SCORE_RANGE_VALUES) {
    if (!byValue.has(value)) {
      fail(
        "SCORE_BUCKETS_MISMATCH",
        `${path} is missing a required score bucket`,
        { path, value },
      );
    }
  }

  return frozenEntries(
    REVIEW_SCORE_RANGE_VALUES.map((value) => ({
      value,
      count: byValue.get(value),
    })),
  );
}

function sumBuckets(buckets, path) {
  let sum = 0;
  for (const { count } of buckets) {
    if (sum > Number.MAX_SAFE_INTEGER - count) {
      fail(
        "INVALID_COUNT",
        `${path} exceeds the safe integer range`,
        { path },
      );
    }
    sum += count;
  }
  return sum;
}

function bucketMap(buckets) {
  return new Map(
    buckets.map(({ value, count }) => [value, count]),
  );
}

function assertAdvertisedBuckets(
  advertisedScoreBuckets,
  advertisedReviewCount,
) {
  const buckets = normalizeScoreBuckets(
    advertisedScoreBuckets,
    "advertisedScoreBuckets",
  );
  const total = sumBuckets(
    buckets,
    "advertisedScoreBuckets",
  );
  if (total !== advertisedReviewCount) {
    fail(
      "ADVERTISED_BUCKET_SUM_MISMATCH",
      "Advertised score buckets must sum exactly to the accepted live advertised count",
      { observed: total, advertisedReviewCount },
    );
  }
  return buckets;
}

// The gap can fall in any score bucket, and in more than one. Every bucket must
// be short or exact, and the shortfalls must account for the whole gap. The
// largest single shortfall is reported as the headline bucket for disclosure.
function resolveScoreBucketGap(
  advertisedScoreBuckets,
  retrievableScoreBuckets,
  gapCount,
) {
  const advertisedByValue = bucketMap(advertisedScoreBuckets);
  const retrievableByValue = bucketMap(retrievableScoreBuckets);
  let shortfallTotal = 0;
  let headline = null;

  for (const value of REVIEW_SCORE_RANGE_VALUES) {
    const advertisedCount = advertisedByValue.get(value);
    const retrievableCount = retrievableByValue.get(value);
    const shortfall = advertisedCount - retrievableCount;
    if (shortfall < 0) {
      fail(
        "BUCKET_SURPLUS",
        "A score bucket returned more reviews than Booking advertised for it",
        { value, advertisedCount, retrievableCount },
      );
    }
    shortfallTotal += shortfall;
    if (headline === null || shortfall > headline.gapCount) {
      headline = {
        value,
        advertisedCount,
        retrievableCount,
        gapCount: shortfall,
      };
    }
  }

  if (shortfallTotal !== gapCount) {
    fail(
      "BUCKET_GAP_MISMATCH",
      "Per-bucket score shortfalls do not account for the source review gap",
      { shortfallTotal, gapCount },
    );
  }
  return Object.freeze(headline);
}

export function identifySourceGap({
  propertyKey,
  bookingHotelId,
  aggregateEvidence,
}) {
  assertPropertyIdentity(propertyKey, bookingHotelId);
  assertExactKeys(
    aggregateEvidence,
    [
      "reviewsCount",
      "retrievableReviewCount",
      "trustedTotals",
      "scoreBuckets",
    ],
    "aggregateEvidence",
  );
  assertNonNegativeSafeInteger(
    aggregateEvidence.reviewsCount,
    "aggregateEvidence.reviewsCount",
  );
  assertNonNegativeSafeInteger(
    aggregateEvidence.retrievableReviewCount,
    "aggregateEvidence.retrievableReviewCount",
  );

  const advertisedReviewCount = aggregateEvidence.reviewsCount;
  const retrievableReviewCount =
    aggregateEvidence.retrievableReviewCount;
  if (advertisedReviewCount === retrievableReviewCount) {
    return null;
  }

  const gapCount = assertGapWithinBounds(
    advertisedReviewCount,
    retrievableReviewCount,
  );
  const trustedTotals = normalizeTrustedTotals(
    aggregateEvidence.trustedTotals,
    advertisedReviewCount,
  );
  const advertisedScoreBuckets = assertAdvertisedBuckets(
    aggregateEvidence.scoreBuckets,
    advertisedReviewCount,
  );

  return Object.freeze({
    contractKind: SOURCE_GAP_CONTRACT.contractKind,
    contractVersion: SOURCE_GAP_CONTRACT.contractVersion,
    propertyKey,
    bookingHotelId,
    advertisedReviewCount,
    retrievableReviewCount,
    gapCount,
    advertisedTrustedTotals: trustedTotals,
    advertisedScoreBuckets,
  });
}

export function assertSourceGap({
  propertyKey,
  bookingHotelId,
  advertisedReviewCount,
  retrievableReviewCount,
  advertisedScoreBuckets,
  retrievableScoreBuckets,
  contractKind,
  advertisedTrustedTotals = undefined,
}) {
  assertPropertyIdentity(propertyKey, bookingHotelId);
  if (contractKind !== SOURCE_GAP_CONTRACT.contractKind) {
    fail(
      "CONTRACT_KIND_MISMATCH",
      "The source-gap contract kind does not match",
      { observed: contractKind },
    );
  }
  assertNonNegativeSafeInteger(
    advertisedReviewCount,
    "advertisedReviewCount",
  );
  assertNonNegativeSafeInteger(
    retrievableReviewCount,
    "retrievableReviewCount",
  );
  const gapCount = assertGapWithinBounds(
    advertisedReviewCount,
    retrievableReviewCount,
  );

  const normalizedAdvertised = assertAdvertisedBuckets(
    advertisedScoreBuckets,
    advertisedReviewCount,
  );
  const normalizedRetrievable = normalizeScoreBuckets(
    retrievableScoreBuckets,
    "retrievableScoreBuckets",
  );
  const retrievableTotal = sumBuckets(
    normalizedRetrievable,
    "retrievableScoreBuckets",
  );
  if (retrievableTotal !== retrievableReviewCount) {
    fail(
      "RETRIEVABLE_BUCKET_SUM_MISMATCH",
      "Retrievable score buckets must sum exactly to the accepted live retrievable count",
      { observed: retrievableTotal, retrievableReviewCount },
    );
  }

  const scoreBucketGap = resolveScoreBucketGap(
    normalizedAdvertised,
    normalizedRetrievable,
    gapCount,
  );
  const normalizedTrustedTotals =
    advertisedTrustedTotals === undefined
      ? null
      : normalizeTrustedTotals(
          advertisedTrustedTotals,
          advertisedReviewCount,
        );

  return Object.freeze({
    contractKind: SOURCE_GAP_CONTRACT.contractKind,
    contractVersion: SOURCE_GAP_CONTRACT.contractVersion,
    propertyKey,
    bookingHotelId,
    advertisedReviewCount,
    retrievableReviewCount,
    gapCount,
    advertisedTrustedTotals: normalizedTrustedTotals,
    advertisedScoreBuckets: normalizedAdvertised,
    retrievableScoreBuckets: normalizedRetrievable,
    scoreBucketGap,
  });
}

export function safeSourceDiscrepancyEvidence(evidence) {
  if (!isPlainObject(evidence)) {
    fail(
      "INVALID_ATTESTATION",
      "A source-gap attestation must be a plain object",
    );
  }
  if (
    evidence.contractVersion !==
      SOURCE_GAP_CONTRACT.contractVersion ||
    !isPlainObject(evidence.scoreBucketGap)
  ) {
    fail(
      "INVALID_ATTESTATION",
      "Source-gap attestation metadata has drifted",
    );
  }

  const normalized = assertSourceGap({
    propertyKey: evidence.propertyKey,
    bookingHotelId: evidence.bookingHotelId,
    advertisedReviewCount: evidence.advertisedReviewCount,
    retrievableReviewCount: evidence.retrievableReviewCount,
    advertisedScoreBuckets: evidence.advertisedScoreBuckets,
    retrievableScoreBuckets: evidence.retrievableScoreBuckets,
    contractKind: evidence.contractKind,
    advertisedTrustedTotals:
      evidence.advertisedTrustedTotals ?? undefined,
  });
  if (
    evidence.gapCount !== normalized.gapCount ||
    evidence.scoreBucketGap.value !==
      normalized.scoreBucketGap.value ||
    evidence.scoreBucketGap.gapCount !==
      normalized.scoreBucketGap.gapCount ||
    evidence.scoreBucketGap.advertisedCount !==
      normalized.scoreBucketGap.advertisedCount ||
    evidence.scoreBucketGap.retrievableCount !==
      normalized.scoreBucketGap.retrievableCount
  ) {
    fail(
      "INVALID_ATTESTATION",
      "Source-gap target-bucket metadata does not match its persisted bucket evidence",
    );
  }

  return Object.freeze({
    sourceDiscrepancyKind: normalized.contractKind,
    advertisedReviews: normalized.advertisedReviewCount,
    retrievableReviews: normalized.retrievableReviewCount,
    sourceReviewGap: normalized.gapCount,
    sourceDiscrepancyScoreBucket:
      normalized.scoreBucketGap.value,
    advertisedBucketReviews:
      normalized.scoreBucketGap.advertisedCount,
    retrievableBucketReviews:
      normalized.scoreBucketGap.retrievableCount,
  });
}
