import test from "node:test";
import assert from "node:assert/strict";

import {
  assertSourceGap,
  identifySourceGap,
  maxAllowedSourceGap,
  safeSourceDiscrepancyEvidence,
  SOURCE_GAP_CONTRACT,
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
    retrievableReviewCount: 2536,
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
    contractKind: SOURCE_GAP_CONTRACT.contractKind,
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

test("a property whose advertised and retrievable counts agree has no gap", () => {
  assert.equal(
    identifySourceGap({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        retrievableReviewCount: 2537,
      }),
    }),
    null,
  );
});

test("identifies a bounded advertised/retrievable gap for any property", () => {
  const identified = identifySourceGap({
    propertyKey: "central_sydney",
    bookingHotelId: 9888182,
    aggregateEvidence: aggregateEvidence(),
  });

  assert.equal(Object.isFrozen(identified), true);
  assert.equal(
    identified.contractKind,
    "booking_source_count_gap_v1",
  );
  assert.equal(identified.advertisedReviewCount, 2537);
  assert.equal(identified.retrievableReviewCount, 2536);
  assert.equal(identified.gapCount, 1);
  assert.deepEqual(
    identified.advertisedTrustedTotals.map(({ source }) => source),
    SOURCE_GAP_CONTRACT.trustedTotalSources,
  );
  assert.equal(
    Object.isFrozen(identified.advertisedScoreBuckets),
    true,
  );
});

test("the tolerated gap scales down for small properties", () => {
  assert.equal(maxAllowedSourceGap(2537), 5);
  assert.equal(maxAllowedSourceGap(100), 1);
  assert.equal(maxAllowedSourceGap(99), 0);
  assert.equal(maxAllowedSourceGap(12), 0);
  assert.equal(maxAllowedSourceGap(0), 0);
  assert.equal(maxAllowedSourceGap(-1), 0);
  assert.equal(maxAllowedSourceGap(null), 0);
});

test("a gap wider than the tolerated bound fails closed", () => {
  expectCode("GAP_COUNT_MISMATCH", () =>
    identifySourceGap({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        retrievableReviewCount: 2500,
      }),
    }),
  );
});

test("a retrievable count above the advertised count fails closed", () => {
  expectCode("GAP_COUNT_MISMATCH", () =>
    identifySourceGap({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        retrievableReviewCount: 2538,
      }),
    }),
  );
});

test("an unusable property identity fails closed", () => {
  expectCode("PROPERTY_IDENTITY_MISMATCH", () =>
    identifySourceGap({
      propertyKey: "central_sydney",
      bookingHotelId: 0,
      aggregateEvidence: aggregateEvidence(),
    }),
  );
  expectCode("PROPERTY_IDENTITY_MISMATCH", () =>
    identifySourceGap({
      propertyKey: "",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence(),
    }),
  );
});

test("advertised evidence requires four totals matching the live count", () => {
  const missing = TRUSTED_TOTALS.slice(1);
  expectCode("TRUSTED_TOTALS_MISMATCH", () =>
    identifySourceGap({
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
    identifySourceGap({
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
    identifySourceGap({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        trustedTotals: duplicate,
      }),
    }),
  );
});

test("advertised buckets must sum to the advertised total", () => {
  const sumDrift = ADVERTISED_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_SUPERB"
        ? item.count - 1
        : item.count,
  }));
  expectCode("ADVERTISED_BUCKET_SUM_MISMATCH", () =>
    identifySourceGap({
      propertyKey: "central_sydney",
      bookingHotelId: 9888182,
      aggregateEvidence: aggregateEvidence({
        scoreBuckets: sumDrift,
      }),
    }),
  );
});

test("asserts a gap and reports its headline score bucket", () => {
  const evidence = assertSourceGap(fullEvidence());

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
      sourceDiscrepancyKind: "booking_source_count_gap_v1",
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

test("the gap may fall in any score bucket", () => {
  const retrievable = ADVERTISED_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_SUPERB"
        ? item.count - 1
        : item.count,
  }));
  const evidence = assertSourceGap(
    fullEvidence({ retrievableScoreBuckets: retrievable }),
  );
  assert.deepEqual(evidence.scoreBucketGap, {
    value: "REVIEW_ADJ_SUPERB",
    advertisedCount: 500,
    retrievableCount: 499,
    gapCount: 1,
  });
});

test("a gap spread across buckets reports the largest shortfall", () => {
  const retrievable = ADVERTISED_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_SUPERB"
        ? item.count - 2
        : item.value === "REVIEW_ADJ_POOR"
          ? item.count - 1
          : item.count,
  }));
  const evidence = assertSourceGap(
    fullEvidence({
      retrievableReviewCount: 2534,
      retrievableScoreBuckets: retrievable,
    }),
  );
  assert.equal(evidence.gapCount, 3);
  assert.equal(evidence.scoreBucketGap.value, "REVIEW_ADJ_SUPERB");
  assert.equal(evidence.scoreBucketGap.gapCount, 2);
});

test("full assertion rejects contract, gap, and bucket drift", () => {
  expectCode("CONTRACT_KIND_MISMATCH", () =>
    assertSourceGap(fullEvidence({ contractKind: "other" })),
  );
  expectCode("GAP_COUNT_MISMATCH", () =>
    assertSourceGap(
      fullEvidence({ retrievableReviewCount: 2537 }),
    ),
  );
  expectCode("RETRIEVABLE_BUCKET_SUM_MISMATCH", () =>
    assertSourceGap(
      fullEvidence({
        retrievableScoreBuckets: ADVERTISED_BUCKETS.map((item) => ({
          ...item,
        })),
      }),
    ),
  );

  const surplus = RETRIEVABLE_BUCKETS.map((item) => ({
    ...item,
    count:
      item.value === "REVIEW_ADJ_AVERAGE_PASSABLE"
        ? 324
        : item.value === "REVIEW_ADJ_SUPERB"
          ? 498
          : item.count,
  }));
  expectCode("BUCKET_SURPLUS", () =>
    assertSourceGap(
      fullEvidence({ retrievableScoreBuckets: surplus }),
    ),
  );
});

test("accepts a later live snapshot with a different total", () => {
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
  const identified = identifySourceGap({
    propertyKey: "central_sydney",
    bookingHotelId: 9888182,
    aggregateEvidence: {
      reviewsCount: 2538,
      retrievableReviewCount: 2537,
      trustedTotals,
      scoreBuckets: advertisedScoreBuckets,
    },
  });
  assert.equal(identified.advertisedReviewCount, 2538);
  assert.equal(identified.retrievableReviewCount, 2537);

  const asserted = assertSourceGap({
    propertyKey: "central_sydney",
    bookingHotelId: 9888182,
    advertisedReviewCount: 2538,
    retrievableReviewCount: 2537,
    advertisedTrustedTotals: trustedTotals,
    advertisedScoreBuckets,
    retrievableScoreBuckets,
    contractKind: SOURCE_GAP_CONTRACT.contractKind,
  });
  assert.deepEqual(asserted.scoreBucketGap, {
    value: "REVIEW_ADJ_AVERAGE_PASSABLE",
    advertisedCount: 323,
    retrievableCount: 322,
    gapCount: 1,
  });
});

test("safe evidence derivation revalidates and rejects tampering", () => {
  const evidence = assertSourceGap(fullEvidence());
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
