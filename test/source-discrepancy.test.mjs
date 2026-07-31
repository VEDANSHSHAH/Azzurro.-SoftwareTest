import test from "node:test";
import assert from "node:assert/strict";

import {
  assertKnownSourceDiscrepancy,
  identifyKnownSourceDiscrepancy,
  KNOWN_SOURCE_DISCREPANCY,
  safeSourceDiscrepancyEvidence,
  SourceDiscrepancyError,
} from "../src/source-discrepancy.mjs";

const TRUSTED_TOTALS = [
  { source: "timeOfYearFilter.ALL", count: 2537 },
  { source: "reviewScoreFilter.ALL", count: 2537 },
  { source: "languageFilter.empty", count: 2537 },
  { source: "customerTypeFilter.ALL", count: 2537 },
];

const ADVERTISED_BUCKETS = [
  { value: "REVIEW_ADJ_VERY_POOR", count: 414 },
  { value: "REVIEW_ADJ_POOR", count: 600 },
  { value: "REVIEW_ADJ_AVERAGE_PASSABLE", count: 323 },
  { value: "REVIEW_ADJ_GOOD", count: 700 },
  { value: "REVIEW_ADJ_SUPERB", count: 500 },
];

const RETRIEVABLE_BUCKETS = ADVERTISED_BUCKETS.map((bucket) => ({
  ...bucket,
  count:
    bucket.value === "REVIEW_ADJ_AVERAGE_PASSABLE"
      ? 322
      : bucket.count,
}));

function aggregateEvidence(overrides = {}) {
  return {
    reviewsCount: 2537,
    trustedTotals: TRUSTED_TOTALS.map((item) => ({ ...item })),
    scoreBuckets: ADVERTISED_BUCKETS.map((item) => ({ ...item })),
    ...overrides,
  };
}

function fullEvidence(overrides = {}) {
  return {
    propertyKey: "central_sydney",
    bookingHotelId: 9888182,
    advertisedReviewCount: 2537,
    retrievableReviewCount: 2536,
    advertisedTrustedTotals:
      TRUSTED_TOTALS.map((item) => ({ ...item })),
    advertisedScoreBuckets:
      ADVERTISED_BUCKETS.map((item) => ({ ...item })),
    retrievableScoreBuckets:
      RETRIEVABLE_BUCKETS.map((item) => ({ ...item })),
    contractKind:
      KNOWN_SOURCE_DISCREPANCY.contractKind,
    ...overrides,
  };
}

function expectCode(code, callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof SourceDiscrepancyError);
    assert.equal(error.code, code);
    return true;
  });
}

test("identifies only the exact Central property and advertised evidence", () => {
  const identified = identifyKnownSourceDiscrepancy({
    propertyKey: "central_sydney",
    bookingHotelId: 9888182,
    aggregateEvidence: aggregateEvidence(),
  });

  assert.equal(Object.isFrozen(identified), true);
  assert.equal(
    identified.contractKind,
    "central_sydney_known_source_gap_v1",
  );
  assert.equal(identified.advertisedReviewCount, 2537);
  assert.equal(identified.retrievableReviewCount, 2536);
  assert.equal(identified.gapCount, 1);
  assert.deepEqual(
    identified.advertisedTrustedTotals.map(({ source }) => source),
    KNOWN_SOURCE_DISCREPANCY.trustedTotalSources,
  );
  assert.deepEqual(
    identified.scoreBucketGap,
    {
      value: "REVIEW_ADJ_AVERAGE_PASSABLE",
      advertisedCount: 323,
      retrievableCount: 322,
      gapCount: 1,
    },
  );
  assert.equal(
    Object.isFrozen(identified.advertisedScoreBuckets),
    true,
  );
  assert.equal(
    Object.isFrozen(identified.advertisedScoreBuckets[0]),
    true,
  );
});

test("unrelated properties receive no exception or source-gap exception", () => {
  assert.equal(
    identifyKnownSourceDiscrepancy({
      propertyKey: "olympic_paddington",
      bookingHotelId: 16211291,
      aggregateEvidence: null,
    }),
    null,
  );
});

test("partial Central identity collisions fail closed", () => {
  expectCode("PROPERTY_IDENTITY_MISMATCH", () =>
    identifyKnownSourceDiscrepancy({
      propertyKey: "central_sydney",
      bookingHotelId: 1,
      aggregateEvidence: aggregateEvidence(),
    }),
  );
  expectCode("PROPERTY_IDENTITY_MISMATCH", () =>
    identifyKnownSourceDiscrepancy({
      propertyKey: "other",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence(),
    }),
  );
});

test("advertised evidence requires four totals matching the live count", () => {
  const missing = TRUSTED_TOTALS.slice(1);
  expectCode("TRUSTED_TOTALS_MISMATCH", () =>
    identifyKnownSourceDiscrepancy({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        trustedTotals: missing,
      }),
    }),
  );

  const wrong = TRUSTED_TOTALS.map((item, index) => ({
    ...item,
    count: index === 0 ? 2536 : item.count,
  }));
  expectCode("TRUSTED_TOTALS_MISMATCH", () =>
    identifyKnownSourceDiscrepancy({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        trustedTotals: wrong,
      }),
    }),
  );

  const duplicate = TRUSTED_TOTALS.map((item) => ({ ...item }));
  duplicate[0].source = duplicate[1].source;
  expectCode("TRUSTED_TOTALS_MISMATCH", () =>
    identifyKnownSourceDiscrepancy({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        trustedTotals: duplicate,
      }),
    }),
  );
});

test("advertised evidence rejects internally inconsistent live totals and buckets", () => {
  expectCode("ADVERTISED_COUNT_MISMATCH", () =>
    identifyKnownSourceDiscrepancy({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        reviewsCount: 2536,
      }),
    }),
  );

  const targetDrift = ADVERTISED_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_AVERAGE_PASSABLE"
        ? 0
        : item.value === "REVIEW_ADJ_SUPERB"
          ? 823
          : item.count,
  }));
  expectCode("TARGET_BUCKET_MISMATCH", () =>
    identifyKnownSourceDiscrepancy({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        scoreBuckets: targetDrift,
      }),
    }),
  );

  const sumDrift = ADVERTISED_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_SUPERB"
        ? item.count - 1
        : item.count,
  }));
  expectCode("ADVERTISED_BUCKET_SUM_MISMATCH", () =>
    identifyKnownSourceDiscrepancy({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        scoreBuckets: sumDrift,
      }),
    }),
  );
});

test("asserts the exact one-review target-bucket discrepancy", () => {
  const evidence = assertKnownSourceDiscrepancy(fullEvidence());

  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(evidence.advertisedReviewCount, 2537);
  assert.equal(evidence.retrievableReviewCount, 2536);
  assert.equal(evidence.gapCount, 1);
  assert.deepEqual(evidence.scoreBucketGap, {
    value: "REVIEW_ADJ_AVERAGE_PASSABLE",
    advertisedCount: 323,
    retrievableCount: 322,
    gapCount: 1,
  });
  assert.deepEqual(
    safeSourceDiscrepancyEvidence(evidence),
    {
      sourceDiscrepancyKind:
        "central_sydney_known_source_gap_v1",
      advertisedReviews: 2537,
      retrievableReviews: 2536,
      sourceReviewGap: 1,
      sourceDiscrepancyScoreBucket:
        "REVIEW_ADJ_AVERAGE_PASSABLE",
      advertisedBucketReviews: 323,
      retrievableBucketReviews: 322,
    },
  );
});

test("full assertion rejects gap, target-bucket, and other-bucket drift", () => {
  expectCode("CONTRACT_KIND_MISMATCH", () =>
    assertKnownSourceDiscrepancy(
      fullEvidence({ contractKind: "other" }),
    ),
  );
  expectCode("GAP_COUNT_MISMATCH", () =>
    assertKnownSourceDiscrepancy(
      fullEvidence({ retrievableReviewCount: 2535 }),
    ),
  );

  const targetDrift = RETRIEVABLE_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_AVERAGE_PASSABLE"
        ? 323
        : item.value === "REVIEW_ADJ_SUPERB"
          ? 499
          : item.count,
  }));
  expectCode("TARGET_BUCKET_MISMATCH", () =>
    assertKnownSourceDiscrepancy(
      fullEvidence({
        retrievableScoreBuckets: targetDrift,
      }),
    ),
  );

  const nonTargetDrift = RETRIEVABLE_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_SUPERB"
        ? 499
        : item.value === "REVIEW_ADJ_GOOD"
          ? 701
          : item.count,
  }));
  expectCode("NON_TARGET_BUCKET_MISMATCH", () =>
    assertKnownSourceDiscrepancy(
      fullEvidence({
        retrievableScoreBuckets: nonTargetDrift,
      }),
    ),
  );
});

test("accepts a later live snapshot while preserving the exact one-review shape", () => {
  const advertisedScoreBuckets = ADVERTISED_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_GOOD"
        ? item.count + 1
        : item.count,
  }));
  const retrievableScoreBuckets = RETRIEVABLE_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_GOOD"
        ? item.count + 1
        : item.count,
  }));
  const trustedTotals = TRUSTED_TOTALS.map((item) => ({
    ...item,
    count: item.count + 1,
  }));
  const identified = identifyKnownSourceDiscrepancy({
    propertyKey: "central_sydney",
    bookingHotelId: 9888182,
    aggregateEvidence: {
      reviewsCount: 2538,
      trustedTotals,
      scoreBuckets: advertisedScoreBuckets,
    },
  });
  assert.equal(identified.advertisedReviewCount, 2538);
  assert.equal(identified.retrievableReviewCount, 2537);

  const asserted = assertKnownSourceDiscrepancy({
    propertyKey: "central_sydney",
    bookingHotelId: 9888182,
    advertisedReviewCount: 2538,
    retrievableReviewCount: 2537,
    advertisedTrustedTotals: trustedTotals,
    advertisedScoreBuckets,
    retrievableScoreBuckets,
    contractKind: KNOWN_SOURCE_DISCREPANCY.contractKind,
  });
  assert.deepEqual(asserted.scoreBucketGap, {
    value: "REVIEW_ADJ_AVERAGE_PASSABLE",
    advertisedCount: 323,
    retrievableCount: 322,
    gapCount: 1,
  });
});

test("dynamic evidence cannot fall below the independently verified baseline", () => {
  const advertisedScoreBuckets = ADVERTISED_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_GOOD"
        ? item.count - 1
        : item.count,
  }));
  const trustedTotals = TRUSTED_TOTALS.map((item) => ({
    ...item,
    count: item.count - 1,
  }));
  expectCode("ADVERTISED_COUNT_MISMATCH", () =>
    identifyKnownSourceDiscrepancy({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: {
        reviewsCount: 2536,
        trustedTotals,
        scoreBuckets: advertisedScoreBuckets,
      },
    }),
  );
});

test("safe evidence derivation revalidates and rejects tampering", () => {
  const evidence = assertKnownSourceDiscrepancy(fullEvidence());
  expectCode("INVALID_ATTESTATION", () =>
    safeSourceDiscrepancyEvidence({
      ...evidence,
      gapCount: 2,
    }),
  );
  expectCode("RETRIEVABLE_BUCKET_SUM_MISMATCH", () =>
    safeSourceDiscrepancyEvidence({
      ...evidence,
      retrievableScoreBuckets:
        evidence.retrievableScoreBuckets.map((item) => ({
          ...item,
          count:
            item.value === "REVIEW_ADJ_SUPERB"
              ? item.count - 1
              : item.count,
        })),
    }),
  );
});
