import {
  REVIEW_SCORE_RANGE_VALUES,
} from "./live-template.mjs";

const TARGET_SCORE_BUCKET = "REVIEW_ADJ_AVERAGE_PASSABLE";
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

export const KNOWN_SOURCE_DISCREPANCY = Object.freeze({
  contractKind: "central_sydney_known_source_gap_v1",
  contractVersion: 1,
  propertyKey: "central_sydney",
  bookingHotelId: 9888182,
  minimumAdvertisedReviewCount: 2537,
  gapCount: 1,
  targetScoreBucket: TARGET_SCORE_BUCKET,
  minimumAdvertisedTargetBucketCount: 323,
  trustedTotalSources: TRUSTED_TOTAL_SOURCES,
});

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

function propertyMatch(propertyKey, bookingHotelId) {
  const keyMatches =
    propertyKey === KNOWN_SOURCE_DISCREPANCY.propertyKey;
  const idMatches =
    bookingHotelId === KNOWN_SOURCE_DISCREPANCY.bookingHotelId;

  if (!keyMatches && !idMatches) return false;
  if (!keyMatches || !idMatches) {
    fail(
      "PROPERTY_IDENTITY_MISMATCH",
      "The known source discrepancy requires the exact configured property key and Booking hotel ID",
      {
        propertyKey,
        bookingHotelId,
        keyMatches,
        idMatches,
      },
    );
  }
  return true;
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
      "Known source discrepancy evidence requires all four trusted advertised totals",
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
  const counts = bucketMap(buckets);
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
  if (
    counts.get(TARGET_SCORE_BUCKET) <
    KNOWN_SOURCE_DISCREPANCY.minimumAdvertisedTargetBucketCount
  ) {
    fail(
      "TARGET_BUCKET_MISMATCH",
      "The advertised 5–7 score bucket cannot fall below the independently verified baseline",
      {
        observed: counts.get(TARGET_SCORE_BUCKET),
        minimum:
          KNOWN_SOURCE_DISCREPANCY.minimumAdvertisedTargetBucketCount,
      },
    );
  }
  return buckets;
}

function buildIdentifiedEvidence({
  trustedTotals,
  advertisedScoreBuckets,
  advertisedReviewCount,
}) {
  const contract = KNOWN_SOURCE_DISCREPANCY;
  const advertisedTargetCount = bucketMap(
    advertisedScoreBuckets,
  ).get(contract.targetScoreBucket);
  return Object.freeze({
    contractKind: contract.contractKind,
    contractVersion: contract.contractVersion,
    propertyKey: contract.propertyKey,
    bookingHotelId: contract.bookingHotelId,
    advertisedReviewCount,
    retrievableReviewCount:
      advertisedReviewCount - contract.gapCount,
    gapCount: contract.gapCount,
    advertisedTrustedTotals: trustedTotals,
    advertisedScoreBuckets,
    scoreBucketGap: Object.freeze({
      value: contract.targetScoreBucket,
      advertisedCount: advertisedTargetCount,
      retrievableCount:
        advertisedTargetCount - contract.gapCount,
      gapCount: contract.gapCount,
    }),
  });
}

export function identifyKnownSourceDiscrepancy({
  propertyKey,
  bookingHotelId,
  aggregateEvidence,
}) {
  if (!propertyMatch(propertyKey, bookingHotelId)) return null;

  assertExactKeys(
    aggregateEvidence,
    ["reviewsCount", "trustedTotals", "scoreBuckets"],
    "aggregateEvidence",
  );
  assertNonNegativeSafeInteger(
    aggregateEvidence.reviewsCount,
    "aggregateEvidence.reviewsCount",
  );
  if (
    aggregateEvidence.reviewsCount <
    KNOWN_SOURCE_DISCREPANCY.minimumAdvertisedReviewCount
  ) {
    fail(
      "ADVERTISED_COUNT_MISMATCH",
      "The advertised review count cannot fall below the independently verified Central baseline",
      {
        observed: aggregateEvidence.reviewsCount,
        minimum:
          KNOWN_SOURCE_DISCREPANCY.minimumAdvertisedReviewCount,
      },
    );
  }
  const trustedTotals = normalizeTrustedTotals(
    aggregateEvidence.trustedTotals,
    aggregateEvidence.reviewsCount,
  );
  const advertisedScoreBuckets =
    assertAdvertisedBuckets(
      aggregateEvidence.scoreBuckets,
      aggregateEvidence.reviewsCount,
    );

  return buildIdentifiedEvidence({
    trustedTotals,
    advertisedScoreBuckets,
    advertisedReviewCount: aggregateEvidence.reviewsCount,
  });
}

export function assertKnownSourceDiscrepancy({
  propertyKey,
  bookingHotelId,
  advertisedReviewCount,
  retrievableReviewCount,
  advertisedScoreBuckets,
  retrievableScoreBuckets,
  contractKind,
  advertisedTrustedTotals = undefined,
}) {
  if (!propertyMatch(propertyKey, bookingHotelId)) {
    fail(
      "PROPERTY_NOT_ELIGIBLE",
      "This property has no known source discrepancy contract",
      { propertyKey, bookingHotelId },
    );
  }

  const contract = KNOWN_SOURCE_DISCREPANCY;
  if (contractKind !== contract.contractKind) {
    fail(
      "CONTRACT_KIND_MISMATCH",
      "The known source discrepancy contract kind does not match",
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
  if (
    advertisedReviewCount <
    contract.minimumAdvertisedReviewCount
  ) {
    fail(
      "ADVERTISED_COUNT_MISMATCH",
      "The advertised review count cannot fall below the independently verified Central baseline",
      {
        observed: advertisedReviewCount,
        minimum: contract.minimumAdvertisedReviewCount,
      },
    );
  }
  if (
    advertisedReviewCount - retrievableReviewCount !==
    contract.gapCount
  ) {
    fail(
      "GAP_COUNT_MISMATCH",
      "The source discrepancy gap must be exactly one review",
      {
        advertisedReviewCount,
        retrievableReviewCount,
      },
    );
  }

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

  const advertisedByValue = bucketMap(normalizedAdvertised);
  const retrievableByValue = bucketMap(normalizedRetrievable);
  const advertisedTarget =
    advertisedByValue.get(TARGET_SCORE_BUCKET);
  const retrievableTarget =
    retrievableByValue.get(TARGET_SCORE_BUCKET);
  if (
    advertisedTarget - retrievableTarget !== contract.gapCount
  ) {
    fail(
      "TARGET_BUCKET_MISMATCH",
      "Only the 5–7 score bucket may be short, and its live advertised/retrievable gap must be exactly one",
      {
        value: TARGET_SCORE_BUCKET,
        advertised: advertisedTarget,
        retrievable: retrievableTarget,
      },
    );
  }
  for (const value of REVIEW_SCORE_RANGE_VALUES) {
    if (value === TARGET_SCORE_BUCKET) continue;
    const advertised = advertisedByValue.get(value);
    const retrievable = retrievableByValue.get(value);
    if (advertised !== retrievable) {
      fail(
        "NON_TARGET_BUCKET_MISMATCH",
        "Every non-target score bucket must have exact advertised/retrievable parity",
        { value, advertised, retrievable },
      );
    }
  }

  const normalizedTrustedTotals =
    advertisedTrustedTotals === undefined
      ? null
      : normalizeTrustedTotals(
          advertisedTrustedTotals,
          advertisedReviewCount,
        );

  return Object.freeze({
    contractKind: contract.contractKind,
    contractVersion: contract.contractVersion,
    propertyKey: contract.propertyKey,
    bookingHotelId: contract.bookingHotelId,
    advertisedReviewCount,
    retrievableReviewCount,
    gapCount: contract.gapCount,
    advertisedTrustedTotals: normalizedTrustedTotals,
    advertisedScoreBuckets: normalizedAdvertised,
    retrievableScoreBuckets: normalizedRetrievable,
    scoreBucketGap: Object.freeze({
      value: contract.targetScoreBucket,
      advertisedCount: advertisedTarget,
      retrievableCount: retrievableTarget,
      gapCount: contract.gapCount,
    }),
  });
}

export function safeSourceDiscrepancyEvidence(evidence) {
  if (!isPlainObject(evidence)) {
    fail(
      "INVALID_ATTESTATION",
      "Known source discrepancy attestation must be a plain object",
    );
  }
  if (
    evidence.contractVersion !==
      KNOWN_SOURCE_DISCREPANCY.contractVersion ||
    evidence.gapCount !== KNOWN_SOURCE_DISCREPANCY.gapCount ||
    !isPlainObject(evidence.scoreBucketGap) ||
    evidence.scoreBucketGap.value !==
      KNOWN_SOURCE_DISCREPANCY.targetScoreBucket ||
    evidence.scoreBucketGap.gapCount !==
      KNOWN_SOURCE_DISCREPANCY.gapCount
  ) {
    fail(
      "INVALID_ATTESTATION",
      "Known source discrepancy attestation metadata has drifted",
    );
  }

  const normalized = assertKnownSourceDiscrepancy({
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
    evidence.scoreBucketGap.advertisedCount !==
      normalized.scoreBucketGap.advertisedCount ||
    evidence.scoreBucketGap.retrievableCount !==
      normalized.scoreBucketGap.retrievableCount
  ) {
    fail(
      "INVALID_ATTESTATION",
      "Known source discrepancy target-bucket metadata does not match its persisted bucket evidence",
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
