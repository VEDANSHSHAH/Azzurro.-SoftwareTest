import test from "node:test";
import assert from "node:assert/strict";

import {
  assertExactInventoryParity,
  collectInventoryPhase,
  collectIncrementalWindow,
  CollectionError,
  fetchValidatedPage,
  runPropertyCanary,
} from "../src/collector.mjs";
import {
  REVIEW_SCORE_RANGE_VALUES,
  reviewScoreMatchesRange,
} from "../src/live-template.mjs";

const property = {
  key: "test_property",
  hotelId: 12345,
};

function card(index, overrides = {}) {
  return {
    __typename: "ReviewCard",
    reviewUrl: `review-${String(index).padStart(4, "0")}`,
    reviewedDate: 1_700_000_000 + index,
    reviewScore: (index % 10) + 1,
    textDetails: {
      __typename: "TextDetails",
      title: `Title ${index}`,
      positiveText: `Positive ${index}`,
      negativeText: null,
      lang: "en",
      textTrivialFlag: 0,
    },
    bookingDetails: null,
    guestDetails: null,
    partnerReply: null,
    photos: null,
    positiveHighlights: null,
    negativeHighlights: null,
    helpfulVotesCount: null,
    isApproved: true,
    isTranslatable: false,
    editUrl: null,
    ...overrides,
  };
}

function body(cards, count) {
  return {
    data: {
      reviewListFrontend: {
        __typename: "ReviewListFrontendResult",
        reviewsCount: count,
        reviewCard: cards,
        ratingScores: [
          {
            __typename: "RatingScore",
            name: "hotel_clean",
            translation: "Cleanliness",
            value: 8.5,
            ufiScoresAverage: null,
          },
        ],
        topicFilters: [],
        reviewScoreFilter: [],
        languageFilter: [],
        timeOfYearFilter: [],
        customerTypeFilter: [],
        roomTypeFilter: [],
        sorters: [
          {
            __typename: "ReviewSorter",
            value: "NEWEST_FIRST",
            name: "Newest first",
          },
          {
            __typename: "ReviewSorter",
            value: "OLDEST_FIRST",
            name: "Oldest first",
          },
        ],
      },
    },
  };
}

function raw(json, overrides = {}) {
  const text = JSON.stringify(json);
  return {
    status: 200,
    contentType: "application/json",
    text,
    responseBytes: Buffer.byteLength(text),
    elapsedMs: 10,
    retryAfter: null,
    ...overrides,
  };
}

function stableTransport(count, transform = (value) => value) {
  const all = Array.from({ length: count }, (_, index) => card(index));
  return async ({ skip, limit, sorter }) => {
    const ordered =
      sorter === "OLDEST_FIRST" ? all : [...all].reverse();
    return raw(body(transform(ordered.slice(skip, skip + limit), {
      skip,
      sorter,
      all: ordered,
    }), count));
  };
}

function authoritativeBody(cards, allCards, overrides = {}) {
  const response = body(cards, allCards.length);
  const list = response.data.reviewListFrontend;
  const scoreCounts = new Map(
    REVIEW_SCORE_RANGE_VALUES.map((value) => [value, 0]),
  );
  for (const review of allCards) {
    const scoreRange = REVIEW_SCORE_RANGE_VALUES.find((value) =>
      reviewScoreMatchesRange(review.reviewScore, value),
    );
    if (scoreRange) {
      scoreCounts.set(scoreRange, scoreCounts.get(scoreRange) + 1);
    }
  }
  list.reviewScoreFilter = [
    {
      __typename: "ReviewScoreFilter",
      name: `All (${allCards.length})`,
      value: "ALL",
      count: allCards.length,
    },
    ...REVIEW_SCORE_RANGE_VALUES.map((value) => ({
      __typename: "ReviewScoreFilter",
      name: value,
      value,
      count: scoreCounts.get(value),
    })),
  ];
  list.languageFilter = [
    {
      __typename: "LanguageFilter",
      name: `All (${allCards.length})`,
      value: "",
      count: allCards.length,
      countryFlag: null,
    },
  ];
  list.timeOfYearFilter = [
    {
      __typename: "TimeOfYearFilter",
      name: `All (${allCards.length})`,
      value: "ALL",
      count: allCards.length,
    },
  ];
  list.customerTypeFilter = [
    {
      __typename: "CustomerTypeFilter",
      name: `All (${allCards.length})`,
      value: "ALL",
      count: allCards.length,
    },
  ];
  Object.assign(list, overrides);
  return response;
}

function authoritativeTransport(
  count,
  {
    transformCards = (value) => value,
    transformResponse = (value) => value,
  } = {},
) {
  const all = Array.from({ length: count }, (_, index) => card(index));
  return async ({ skip, limit, sorter }) => {
    const ordered =
      sorter === "OLDEST_FIRST" ? all : [...all].reverse();
    const cards = transformCards(
      ordered.slice(skip, skip + limit),
      { skip, sorter, all: ordered },
    );
    const response = authoritativeBody(cards, ordered);
    return raw(
      transformResponse(response, {
        skip,
        sorter,
        all: ordered,
      }),
    );
  };
}

test("canary proves property, count, sorters and category stability", async () => {
  const canary = await runPropertyCanary({
    property,
    fetchRaw: stableTransport(21),
    capturedHotelId: 12345,
    visibleReviewCount: 21,
  });
  assert.equal(canary.reviewsCount, 21);
  assert.equal(canary.newest.cardCount, 10);
  assert.equal(canary.oldest.cardCount, 10);
});

test("category stability ignores ancillary Booking benchmark metadata but not displayed scores", async () => {
  let calls = 0;
  const metadataOnlyChange = async ({ sorter }) => {
    calls += 1;
    const response = body(
      [card(sorter === "NEWEST_FIRST" ? 21 : 1)],
      21,
    );
    response.data.reviewListFrontend.ratingScores[0].ufiScoresAverage =
      calls === 1
        ? { __typename: "UfiScoreAverage", ufiScoreLowerBound: 7, ufiScoreHigherBound: 9 }
        : { __typename: "UfiScoreAverage", ufiScoreLowerBound: 6, ufiScoreHigherBound: 9 };
    return raw(response);
  };

  await runPropertyCanary({
    property,
    fetchRaw: metadataOnlyChange,
    capturedHotelId: 12345,
    visibleReviewCount: 21,
  });

  let newestCalls = 0;
  const displayedScoreChange = authoritativeTransport(21, {
    transformResponse(response, { sorter }) {
      if (sorter === "NEWEST_FIRST") newestCalls += 1;
      response.data.reviewListFrontend.ratingScores[0].value =
        sorter === "NEWEST_FIRST" && newestCalls > 1 ? 8.4 : 8.5;
      return response;
    },
  });

  const movingCanary = await runPropertyCanary({
    property,
    fetchRaw: displayedScoreChange,
    capturedHotelId: 12345,
    visibleReviewCount: 21,
  });
  await assert.rejects(
    collectInventoryPhase({
      property,
      fetchRaw: displayedScoreChange,
      sorter: "NEWEST_FIRST",
      reportedCount: 21,
      categoryDigest: movingCanary.categoryDigest,
      firstPage: movingCanary.newest,
    }),
    (error) => error.code === "MOVING_CATEGORY_SCORES",
  );
});

test("authoritative canary requires the full current count evidence profile", async () => {
  const canary = await runPropertyCanary({
    property,
    fetchRaw: authoritativeTransport(21),
    capturedHotelId: 12345,
    visibleReviewCount: 21,
    requireAuthoritativeEvidence: true,
  });
  assert.equal(canary.aggregateEvidence.trustedTotals.length, 4);
  assert.equal(canary.aggregateEvidence.scoreBuckets.length, 5);
  assert.match(canary.aggregateDigest, /^[a-f0-9]{64}$/);

  await assert.rejects(
    runPropertyCanary({
      property,
      fetchRaw: authoritativeTransport(21),
      capturedHotelId: 12345,
      requireAuthoritativeEvidence: true,
    }),
    (error) => error.code === "VISIBLE_COUNT_UNAVAILABLE",
  );

  await assert.rejects(
    runPropertyCanary({
      property,
      fetchRaw: stableTransport(21),
      capturedHotelId: 12345,
      visibleReviewCount: 21,
      requireAuthoritativeEvidence: true,
    }),
    (error) => error.code === "INSUFFICIENT_COUNT_EVIDENCE",
  );
});

test("authoritative canary rejects incomplete buckets and empty categories", async () => {
  const missingBucket = authoritativeTransport(11, {
    transformResponse(response) {
      response.data.reviewListFrontend.reviewScoreFilter.pop();
      return response;
    },
  });
  await assert.rejects(
    runPropertyCanary({
      property,
      fetchRaw: missingBucket,
      capturedHotelId: 12345,
      visibleReviewCount: 11,
      requireAuthoritativeEvidence: true,
    }),
    (error) => error.code === "SCORE_BUCKET_CONTRACT",
  );

  const wrongBucketSum = authoritativeTransport(11, {
    transformResponse(response) {
      const bucket =
        response.data.reviewListFrontend.reviewScoreFilter[1];
      bucket.count += 1;
      return response;
    },
  });
  await assert.rejects(
    runPropertyCanary({
      property,
      fetchRaw: wrongBucketSum,
      capturedHotelId: 12345,
      visibleReviewCount: 11,
      requireAuthoritativeEvidence: true,
    }),
    (error) => error.code === "SCORE_BUCKET_COUNT_MISMATCH",
  );

  const emptyCategories = authoritativeTransport(11, {
    transformResponse(response) {
      response.data.reviewListFrontend.ratingScores = [];
      return response;
    },
  });
  await assert.rejects(
    runPropertyCanary({
      property,
      fetchRaw: emptyCategories,
      capturedHotelId: 12345,
      visibleReviewCount: 11,
      requireAuthoritativeEvidence: true,
    }),
    (error) => error.code === "EMPTY_CATEGORY_PROFILE",
  );
});

test("authoritative inventory verifies aggregate stability and score distribution", async () => {
  const fetchRaw = authoritativeTransport(21);
  const canary = await runPropertyCanary({
    property,
    fetchRaw,
    capturedHotelId: 12345,
    visibleReviewCount: 21,
    requireAuthoritativeEvidence: true,
  });
  const inventory = await collectInventoryPhase({
    property,
    fetchRaw,
    sorter: "OLDEST_FIRST",
    reportedCount: 21,
    categoryDigest: canary.categoryDigest,
    aggregateDigest: canary.aggregateDigest,
    firstPage: canary.oldest,
  });
  assert.equal(inventory.keys.size, 21);

  const movingAggregate = authoritativeTransport(21, {
    transformResponse(response, { skip }) {
      if (skip >= 10) {
        response.data.reviewListFrontend.reviewScoreFilter[1].count += 1;
        response.data.reviewListFrontend.reviewScoreFilter[2].count -= 1;
      }
      return response;
    },
  });
  await assert.rejects(
    collectInventoryPhase({
      property,
      fetchRaw: movingAggregate,
      sorter: "OLDEST_FIRST",
      reportedCount: 21,
      categoryDigest: canary.categoryDigest,
      aggregateDigest: canary.aggregateDigest,
      firstPage: canary.oldest,
    }),
    (error) => error.code === "MOVING_AGGREGATE_COUNTS",
  );

  const wrongDistribution = authoritativeTransport(11, {
    transformResponse(response) {
      const filters =
        response.data.reviewListFrontend.reviewScoreFilter;
      for (const filter of filters.slice(1)) filter.count = 0;
      filters[1].count = 11;
      return response;
    },
  });
  const wrongCanary = await runPropertyCanary({
    property,
    fetchRaw: wrongDistribution,
    capturedHotelId: 12345,
    visibleReviewCount: 11,
    requireAuthoritativeEvidence: true,
  });
  await assert.rejects(
    collectInventoryPhase({
      property,
      fetchRaw: wrongDistribution,
      sorter: "OLDEST_FIRST",
      reportedCount: 11,
      categoryDigest: wrongCanary.categoryDigest,
      aggregateDigest: wrongCanary.aggregateDigest,
      firstPage: wrongCanary.oldest,
    }),
    (error) =>
      error.code === "INVENTORY_SCORE_DISTRIBUTION_MISMATCH",
  );
});

test("source discrepancy cannot bypass authoritative aggregate evidence", async () => {
  const fetchRaw = stableTransport(21);
  const canary = await runPropertyCanary({
    property,
    fetchRaw,
    capturedHotelId: 12345,
  });
  await assert.rejects(
    collectInventoryPhase({
      property,
      fetchRaw,
      sorter: "OLDEST_FIRST",
      reportedCount: 21,
      sourceDiscrepancy: {
        retrievableReviewCount: 21,
      },
      categoryDigest: canary.categoryDigest,
      firstPage: canary.oldest,
    }),
    (error) => error.code === "UNATTESTED_SOURCE_DISCREPANCY",
  );
});

test("two opposite complete inventories reconcile exact identities and hashes", async () => {
  const fetchRaw = stableTransport(21);
  const canary = await runPropertyCanary({
    property,
    fetchRaw,
    capturedHotelId: 12345,
  });
  const seen = [];
  const oldest = await collectInventoryPhase({
    property,
    fetchRaw,
    sorter: "OLDEST_FIRST",
    reportedCount: 21,
    categoryDigest: canary.categoryDigest,
    firstPage: canary.oldest,
    onPage: async (page) => seen.push(page),
  });
  const newest = await collectInventoryPhase({
    property,
    fetchRaw,
    sorter: "NEWEST_FIRST",
    reportedCount: 21,
    categoryDigest: canary.categoryDigest,
    firstPage: canary.newest,
  });
  assert.equal(assertExactInventoryParity(oldest, newest), true);
  assert.equal(oldest.keys.size, 21);
  assert.deepEqual(
    seen.map((page) => [page.skip, page.terminal, page.page.cardCount]),
    [
      [0, false, 10],
      [10, false, 10],
      [20, false, 1],
      [30, true, 0],
    ],
  );
});

for (const count of [0, 1, 9, 10, 11, 20, 21]) {
  test(`collector completes exact boundary inventory of ${count}`, async () => {
    const fetchRaw = stableTransport(count);
    const canary = await runPropertyCanary({
      property,
      fetchRaw,
      capturedHotelId: 12345,
    });
    const oldest = await collectInventoryPhase({
      property,
      fetchRaw,
      sorter: "OLDEST_FIRST",
      reportedCount: count,
      categoryDigest: canary.categoryDigest,
      firstPage: canary.oldest,
    });
    const newest = await collectInventoryPhase({
      property,
      fetchRaw,
      sorter: "NEWEST_FIRST",
      reportedCount: count,
      categoryDigest: canary.categoryDigest,
      firstPage: canary.newest,
    });
    assert.equal(oldest.keys.size, count);
    assert.equal(assertExactInventoryParity(oldest, newest), true);
  });
}

test("retry budget applies only to temporary transport failures", async () => {
  let calls = 0;
  const sleeps = [];
  const fetchRaw = async (request) => {
    calls += 1;
    if (calls === 1) {
      return raw({}, {
        status: 503,
        contentType: "application/json",
      });
    }
    return stableTransport(1)(request);
  };
  const page = await fetchValidatedPage({
    property,
    fetchRaw,
    sleep: async (delayMs) => sleeps.push(delayMs),
    retryRandom: () => 0.5,
  });
  assert.equal(page.cardCount, 1);
  assert.equal(page.request.retries, 1);
  assert.deepEqual(sleeps, [500]);
});

test("rate limits stop immediately and expose reschedule timing", async () => {
  let calls = 0;
  await assert.rejects(
    fetchValidatedPage({
      property,
      fetchRaw: async () => {
        calls += 1;
        return raw({}, {
          status: 429,
          contentType: "text/html",
          text: "limited",
          retryAfter: "60",
        });
      },
    }),
    (error) =>
      error instanceof CollectionError &&
      error.code === "RATE_LIMITED" &&
      error.details.rescheduleAfterMs === 60_000,
  );
  assert.equal(calls, 1);
});

test("HTTP 202 is a non-retryable challenge signal", async () => {
  let calls = 0;
  await assert.rejects(
    fetchValidatedPage({
      property,
      fetchRaw: async () => {
        calls += 1;
        return raw({}, {
          status: 202,
          contentType: "text/html",
          text: "<html>challenge</html>",
        });
      },
    }),
    (error) =>
      error instanceof CollectionError &&
      error.code === "CHALLENGE",
  );
  assert.equal(calls, 1);
});

test("canary rejects ignored, reversed and unprovable sorter behavior", async () => {
  const ascending = Array.from({ length: 3 }, (_, index) => card(index));
  const ignoredSorter = async ({ skip, limit }) =>
    raw(body(ascending.slice(skip, skip + limit), ascending.length));
  await assert.rejects(
    runPropertyCanary({
      property,
      fetchRaw: ignoredSorter,
      capturedHotelId: 12345,
    }),
    (error) =>
      error instanceof CollectionError &&
      error.code === "NON_MONOTONIC_PAGINATION",
  );

  const tied = Array.from({ length: 3 }, (_, index) =>
    card(index, { reviewedDate: 1_700_000_000 }),
  );
  const sameOrderedPage = async ({ skip, limit }) =>
    raw(body(tied.slice(skip, skip + limit), tied.length));
  await assert.rejects(
    runPropertyCanary({
      property,
      fetchRaw: sameOrderedPage,
      capturedHotelId: 12345,
    }),
    (error) =>
      error instanceof CollectionError &&
      error.code === "SORTER_NOT_APPLIED",
  );
});

test("repeated pages and moving counts fail closed", async () => {
  const repeated = stableTransport(20, (slice, context) =>
    context.skip === 10 ? context.all.slice(0, 10) : slice,
  );
  const canary = await runPropertyCanary({
    property,
    fetchRaw: repeated,
    capturedHotelId: 12345,
  });
  await assert.rejects(
    collectInventoryPhase({
      property,
      fetchRaw: repeated,
      sorter: "OLDEST_FIRST",
      reportedCount: 20,
      categoryDigest: canary.categoryDigest,
      firstPage: canary.oldest,
    }),
    /repeated|appeared more than once|wrong direction/i,
  );

  const moving = async (request) => {
    const count = request.skip === 0 ? 11 : 12;
    return stableTransport(count)(request);
  };
  const movingCanary = await runPropertyCanary({
    property,
    fetchRaw: stableTransport(11),
    capturedHotelId: 12345,
  });
  await assert.rejects(
    collectInventoryPhase({
      property,
      fetchRaw: moving,
      sorter: "OLDEST_FIRST",
      reportedCount: 11,
      categoryDigest: movingCanary.categoryDigest,
      firstPage: movingCanary.oldest,
    }),
    /Count changed/,
  );
});

test("independent inventory detects same-count identity and record changes", async () => {
  const fetchRaw = stableTransport(11);
  const canary = await runPropertyCanary({
    property,
    fetchRaw,
    capturedHotelId: 12345,
  });
  const first = await collectInventoryPhase({
    property,
    fetchRaw,
    sorter: "OLDEST_FIRST",
    reportedCount: 11,
    categoryDigest: canary.categoryDigest,
    firstPage: canary.oldest,
  });
  const second = await collectInventoryPhase({
    property,
    fetchRaw,
    sorter: "NEWEST_FIRST",
    reportedCount: 11,
    categoryDigest: canary.categoryDigest,
    firstPage: canary.newest,
  });

  const missing = {
    ...second,
    keys: new Set([...second.keys].slice(1).concat("test_property:new")),
  };
  assert.throws(
    () => assertExactInventoryParity(first, missing),
    /different identity sets/,
  );

  const changed = {
    ...second,
    hashes: new Map(second.hashes),
  };
  changed.hashes.set([...changed.keys][0], "0".repeat(64));
  assert.throws(
    () => assertExactInventoryParity(first, changed),
    /changed between/,
  );
});

test("wrong configured property ID and visible count are rejected", async () => {
  await assert.rejects(
    runPropertyCanary({
      property,
      fetchRaw: stableTransport(1),
      capturedHotelId: 999,
    }),
    /hotel ID does not match/,
  );
  await assert.rejects(
    runPropertyCanary({
      property,
      fetchRaw: stableTransport(1),
      capturedHotelId: 12345,
      visibleReviewCount: 2,
    }),
    /Visible modal count/,
  );
});

test("Central alone accepts a positive visible-to-structured gap up to five", async () => {
  const centralProperty = {
    key: "central_sydney",
    hotelId: 9888182,
  };
  const accepted = await runPropertyCanary({
    property: centralProperty,
    fetchRaw: authoritativeTransport(2),
    capturedHotelId: 9888182,
    visibleReviewCount: 4,
    requireAuthoritativeEvidence: true,
  });
  assert.equal(accepted.reviewsCount, 2);
  assert.equal(accepted.visibleCountDiscrepancy.gapCount, 2);

  await runPropertyCanary({
    property: centralProperty,
    fetchRaw: authoritativeTransport(2),
    capturedHotelId: 9888182,
    visibleReviewCount: 7,
    requireAuthoritativeEvidence: true,
  });

  for (const [candidateProperty, visibleReviewCount] of [
    [centralProperty, 8],
    [centralProperty, 1],
    [property, 4],
  ]) {
    await assert.rejects(
      runPropertyCanary({
        property: candidateProperty,
        fetchRaw: authoritativeTransport(2),
        capturedHotelId: candidateProperty.hotelId,
        visibleReviewCount,
        requireAuthoritativeEvidence: true,
      }),
      (error) => error.code === "VISIBLE_COUNT_MISMATCH",
    );
  }
});

test("incremental scan covers new reviews plus two known old pages", async () => {
  const fetchRaw = stableTransport(40);
  const canary = await runPropertyCanary({
    property,
    fetchRaw,
    capturedHotelId: 12345,
  });
  const knownSourceTokens = new Set(
    Array.from({ length: 35 }, (_, index) =>
      `review-${String(index).padStart(4, "0")}`,
    ),
  );
  const staged = [];
  const result = await collectIncrementalWindow({
    property,
    fetchRaw,
    reportedCount: 40,
    categoryDigest: canary.categoryDigest,
    knownSourceTokens,
    firstPage: canary.newest,
    nowEpochSeconds: 2_000_000_000,
    onPage: async ({ page }) => staged.push(...page.reviews),
  });
  assert.equal(result.stopReason, "known_rolling_window");
  assert.equal(result.pagesFetched, 3);
  assert.equal(staged.length, 30);
});

test("incremental scan fails on a moving head or unsafe page cap", async () => {
  const base = stableTransport(30);
  let headCalls = 0;
  const moving = async (request) => {
    const response = await base(request);
    if (request.skip === 0) {
      headCalls += 1;
      if (headCalls === 2) {
        const parsed = JSON.parse(response.text);
        parsed.data.reviewListFrontend.reviewCard[0].textDetails.title =
          "Changed during run";
        return raw(parsed);
      }
    }
    return response;
  };
  const firstPage = await fetchValidatedPage({
    property,
    fetchRaw: moving,
    sorter: "NEWEST_FIRST",
  });
  await assert.rejects(
    collectIncrementalWindow({
      property,
      fetchRaw: moving,
      reportedCount: 30,
      categoryDigest:
        (
          await runPropertyCanary({
            property,
            fetchRaw: base,
            capturedHotelId: 12345,
          })
        ).categoryDigest,
      knownSourceTokens: new Set(
        Array.from({ length: 30 }, (_, index) =>
          `review-${String(index).padStart(4, "0")}`,
        ),
      ),
      firstPage,
      nowEpochSeconds: 2_000_000_000,
    }),
    /newest review page changed/,
  );

  await assert.rejects(
    collectIncrementalWindow({
      property,
      fetchRaw: stableTransport(30),
      reportedCount: 30,
      categoryDigest:
        (
          await runPropertyCanary({
            property,
            fetchRaw: stableTransport(30),
            capturedHotelId: 12345,
          })
        ).categoryDigest,
      knownSourceTokens: new Set(),
      maxPages: 1,
      nowEpochSeconds: 2_000_000_000,
    }),
    /safe stop/,
  );
});
