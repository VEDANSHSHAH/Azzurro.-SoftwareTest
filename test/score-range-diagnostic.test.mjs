import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

import { REVIEW_SCORE_RANGE_VALUES } from "../src/live-template.mjs";
import {
  deepScoreRangeDiagnosticPassed,
  parseDiagnosticArgs,
  runDeepScoreRangeDiagnostic,
  SCORE_RANGE_DIAGNOSTIC_PACE_MS,
  ScoreRangeDiagnosticError,
  summarizeRecordDifferences,
  summarizeSetParity,
} from "../src/score-range-diagnostic.mjs";

function recordHash(sourceCard) {
  return createHash("sha256")
    .update(JSON.stringify(sourceCard))
    .digest("hex");
}

function fixtureReviews({
  count = 12,
  score = 6,
} = {}) {
  return Array.from({ length: count }, (_, index) => {
    const token = `private-token-${String(index).padStart(3, "0")}`;
    const reviewedDateRaw = 1_700_000_000 + index;
    const sourceCard = {
      __typename: "ReviewCard",
      reviewUrl: token,
      reviewedDate: reviewedDateRaw,
      reviewScore: score,
      textDetails: null,
      photos: [],
    };
    return {
      sourceReviewToken: token,
      recordHash: recordHash(sourceCard),
      reviewedDateRaw,
      reviewScore: score,
      sourceCard,
    };
  });
}

function fakeValidatedPageFetcher({
  reviews = fixtureReviews(),
  advertisedCount = reviews.length,
  mutatePage = (page) => page,
} = {}) {
  const calls = [];
  const fetchPage = async ({
    skip,
    limit,
    sorter,
    filters,
  }) => {
    calls.push({
      skip,
      limit,
      sorter,
      filters: structuredClone(filters),
    });
    const ordered =
      sorter === "NEWEST_FIRST"
        ? [...reviews].reverse()
        : [...reviews];
    const cards = ordered.slice(skip, skip + limit);
    return mutatePage(
      {
        reviewsCount: reviews.length,
        cardCount: cards.length,
        reviews: cards,
        filters: {
          reviewScores: [
            {
              value: filters.scoreRange,
              count: advertisedCount,
            },
          ],
        },
        sorters: [
          { value: "NEWEST_FIRST" },
          { value: "OLDEST_FIRST" },
        ],
      },
      { skip, sorter },
    );
  };
  return { fetchPage, calls };
}

test("deep score diagnostic parses only the exact allowlisted CLI values", () => {
  for (const scoreRange of REVIEW_SCORE_RANGE_VALUES) {
    assert.deepEqual(
      parseDiagnosticArgs([
        "central_sydney",
        "--deep-score-range",
        scoreRange,
      ]),
      {
        propertyKey: "central_sydney",
        deepScoreRange: scoreRange,
      },
    );
    assert.deepEqual(
      parseDiagnosticArgs(["--deep-score-range", scoreRange]),
      {
        propertyKey: "central_sydney",
        deepScoreRange: scoreRange,
      },
    );
  }
  assert.throws(
    () =>
      parseDiagnosticArgs([
        "--deep-score-range",
        "REVIEW_ADJ_UNKNOWN",
      ]),
    (error) =>
      error instanceof ScoreRangeDiagnosticError &&
      error.code === "UNSUPPORTED_SCORE_RANGE",
  );
  assert.throws(
    () => parseDiagnosticArgs(["--deep-score-range"]),
    (error) =>
      error instanceof ScoreRangeDiagnosticError &&
      error.code === "MISSING_DEEP_SCORE_RANGE",
  );
  assert.throws(
    () =>
      parseDiagnosticArgs([
        "--deep-score-range",
        "REVIEW_ADJ_GOOD",
        "--deep-score-range",
        "REVIEW_ADJ_POOR",
      ]),
    (error) =>
      error instanceof ScoreRangeDiagnosticError &&
      error.code === "DUPLICATE_DEEP_SCORE_RANGE",
  );
});

test("deep score diagnostic crawls both sorters through an explicit terminal with shared pacing", async () => {
  const { fetchPage, calls } = fakeValidatedPageFetcher({
    advertisedCount: 13,
  });
  const delays = [];
  const result = await runDeepScoreRangeDiagnostic({
    property: { key: "fixture_property" },
    fetchRaw: async () => {
      throw new Error("fetchRaw is not used by the offline fixture");
    },
    scoreRange: "REVIEW_ADJ_AVERAGE_PASSABLE",
    fetchPage,
    delay: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  assert.deepEqual(
    calls.map(({ sorter, skip }) => [sorter, skip]),
    [
      ["NEWEST_FIRST", 0],
      ["NEWEST_FIRST", 10],
      ["NEWEST_FIRST", 20],
      ["OLDEST_FIRST", 0],
      ["OLDEST_FIRST", 10],
      ["OLDEST_FIRST", 20],
    ],
  );
  assert.equal(delays.length, calls.length - 1);
  assert.deepEqual(
    new Set(delays),
    new Set([SCORE_RANGE_DIAGNOSTIC_PACE_MS]),
  );

  for (const summary of [
    result.newestFirst,
    result.oldestFirst,
  ]) {
    assert.deepEqual(summary.reportedCounts, {
      reviewsCount: 12,
      advertisedScoreRangeCount: 13,
      agree: false,
    });
    assert.equal(summary.dataPageCount, 2);
    assert.equal(summary.requestCount, 3);
    assert.equal(summary.occurrenceCount, 12);
    assert.equal(summary.uniqueIdentityCount, 12);
    assert.equal(summary.uniqueTokenRecordHashCount, 12);
    assert.match(summary.identitySetSha256, /^[a-f0-9]{64}$/);
    assert.match(
      summary.tokenRecordHashSetSha256,
      /^[a-f0-9]{64}$/,
    );
    assert.equal(summary.allCardsInRange, true);
    assert.deepEqual(summary.terminalEvidence, {
      offset: 20,
      reviewsCount: 12,
      advertisedScoreRangeCount: 13,
      cardCount: 0,
      empty: true,
      stableReportedCount: true,
    });
  }
  assert.equal(
    result.newestFirst.identitySetSha256,
    result.oldestFirst.identitySetSha256,
  );
  assert.equal(
    result.newestFirst.tokenRecordHashSetSha256,
    result.oldestFirst.tokenRecordHashSetSha256,
  );
  assert.equal(
    result.oldestNewestParity.reportedReviewsCount,
    true,
  );
  assert.equal(
    result.oldestNewestParity.advertisedScoreRangeCount,
    true,
  );
  assert.equal(result.oldestNewestParity.identities.parity, true);
  assert.equal(result.oldestNewestParity.records.parity, true);
  assert.equal(
    result.oldestNewestParity.recordMismatchIdentityCount,
    0,
  );
  assert.deepEqual(
    result.oldestNewestParity.recordDifferencePathCounts,
    [],
  );

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private-token-"), false);
  assert.equal(serialized.includes("record:private-token-"), false);
  assert.equal(
    deepScoreRangeDiagnosticPassed(result),
    false,
    "an advertised/returned bucket mismatch must never pass",
  );
});

test("set parity reports only intersection, union and difference counts", () => {
  assert.deepEqual(
    summarizeSetParity(
      new Set(["private-a", "private-b", "private-c"]),
      new Set(["private-b", "private-c", "private-d"]),
    ),
    {
      parity: false,
      intersectionCount: 2,
      unionCount: 4,
      newestOnlyCount: 1,
      oldestOnlyCount: 1,
      symmetricDifferenceCount: 2,
    },
  );
  assert.deepEqual(
    summarizeSetParity(new Set(["private-a"]), new Set(["private-a"])),
    {
      parity: true,
      intersectionCount: 1,
      unionCount: 1,
      newestOnlyCount: 0,
      oldestOnlyCount: 0,
      symmetricDifferenceCount: 0,
    },
  );
});

test("record differences expose only sanitized paths and per-identity counts", () => {
  const secretTokenA = "secret-review-token-a";
  const secretTokenB = "secret-review-token-b";
  const newestRecords = new Map([
    [
      secretTokenA,
      {
        recordHash: "a".repeat(64),
        sourceCard: {
          reviewUrl: secretTokenA,
          textDetails: {
            positiveText: "private newest positive text a",
          },
          photos: [
            {
              url: "https://private.invalid/newest-photo-a.jpg",
            },
          ],
          "email@example.com": "newest private dynamic value",
        },
      },
    ],
    [
      secretTokenB,
      {
        recordHash: "b".repeat(64),
        sourceCard: {
          reviewUrl: secretTokenB,
          textDetails: {
            positiveText: "private newest positive text b",
          },
          guestDetails: {
            username: "newest private username",
          },
        },
      },
    ],
  ]);
  const oldestRecords = new Map([
    [
      secretTokenA,
      {
        recordHash: "c".repeat(64),
        sourceCard: {
          reviewUrl: secretTokenA,
          textDetails: {
            positiveText: "private oldest positive text a",
          },
          photos: [
            {
              url: "https://private.invalid/oldest-photo-a.jpg",
            },
          ],
          "email@example.com": "oldest private dynamic value",
        },
      },
    ],
    [
      secretTokenB,
      {
        recordHash: "d".repeat(64),
        sourceCard: {
          reviewUrl: secretTokenB,
          textDetails: {
            positiveText: "private oldest positive text b",
          },
          guestDetails: {
            username: "oldest private username",
          },
        },
      },
    ],
  ]);

  const summary = summarizeRecordDifferences(
    newestRecords,
    oldestRecords,
  );
  assert.deepEqual(summary, {
    recordMismatchIdentityCount: 2,
    recordMismatchIdentityCountCapped: false,
    recordDifferencePathCounts: [
      {
        path: "sourceCard.textDetails.positiveText",
        count: 2,
      },
      {
        path: "sourceCard.guestDetails.username",
        count: 1,
      },
      {
        path: "sourceCard.other",
        count: 1,
      },
      {
        path: "sourceCard.photos.items.url",
        count: 1,
      },
    ],
    recordDifferencePathCountsTruncated: false,
    photoUrlComponentChangeCounts: {
      parseablePairCount: 0,
      protocolChanged: 0,
      hostnameChanged: 0,
      pathnameChanged: 0,
      searchChanged: 0,
      hashChanged: 0,
      queryKeySetChanged: 0,
      queryValueChanged: 0,
      equalAfterDroppingSearchAndHash: 0,
      unparsablePairCount: 0,
    },
  });
  for (const { path } of summary.recordDifferencePathCounts) {
    for (const component of path.split(".")) {
      assert.match(component, /^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
    }
  }

  const serialized = JSON.stringify(summary);
  for (const privateValue of [
    secretTokenA,
    secretTokenB,
    "private newest positive text a",
    "private oldest positive text a",
    "newest private username",
    "oldest private username",
    "newest-photo-a.jpg",
    "oldest-photo-a.jpg",
    "email@example.com",
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("photo URL differences expose component counts without URL data", () => {
  const newestPrivateUrls = [
    "https://same.example/private/photo.jpg",
    "https://new-host.example/private/photo.jpg",
    "https://same.example/private/new-photo.jpg",
    "https://same.example/private/photo.jpg?newKey=private",
    "https://same.example/private/photo.jpg?size=new-private",
    "https://same.example/private/photo.jpg#new-private",
    "https://same.example/private/photo.jpg?a=1&b=2",
    "newest-private-unparseable-url",
  ];
  const oldestPrivateUrls = [
    "http://same.example/private/photo.jpg",
    "https://old-host.example/private/photo.jpg",
    "https://same.example/private/old-photo.jpg",
    "https://same.example/private/photo.jpg?oldKey=private",
    "https://same.example/private/photo.jpg?size=old-private",
    "https://same.example/private/photo.jpg#old-private",
    "https://same.example/private/photo.jpg?b=2&a=1",
    "oldest-private-unparseable-url",
  ];
  const sourceCard = (urls) => ({
    photos: [
      {
        urls: urls.map((url) => ({ url })),
      },
    ],
  });
  const summary = summarizeRecordDifferences(
    new Map([
      [
        "private-photo-review-token",
        {
          recordHash: "a".repeat(64),
          sourceCard: sourceCard(newestPrivateUrls),
        },
      ],
    ]),
    new Map([
      [
        "private-photo-review-token",
        {
          recordHash: "b".repeat(64),
          sourceCard: sourceCard(oldestPrivateUrls),
        },
      ],
    ]),
  );

  assert.deepEqual(summary.photoUrlComponentChangeCounts, {
    parseablePairCount: 7,
    protocolChanged: 1,
    hostnameChanged: 1,
    pathnameChanged: 1,
    searchChanged: 3,
    hashChanged: 1,
    queryKeySetChanged: 1,
    queryValueChanged: 1,
    equalAfterDroppingSearchAndHash: 4,
    unparsablePairCount: 1,
  });
  assert.deepEqual(summary.recordDifferencePathCounts, [
    {
      path: "sourceCard.photos.items.urls.items.url",
      count: 1,
    },
  ]);
  const serialized = JSON.stringify(summary);
  for (const privateValue of [
    "private-photo-review-token",
    "same.example",
    "new-host.example",
    "old-host.example",
    "/private/photo.jpg",
    "newKey",
    "oldKey",
    "new-private",
    "old-private",
    "unparseable-url",
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("record difference paths are bounded and deep values remain private", () => {
  const newestSourceCard = {};
  const oldestSourceCard = {};
  for (let index = 0; index < 80; index += 1) {
    newestSourceCard[`field_${index}`] =
      `newest-private-value-${index}`;
    oldestSourceCard[`field_${index}`] =
      `oldest-private-value-${index}`;
  }
  let newestDeep = newestSourceCard;
  let oldestDeep = oldestSourceCard;
  for (let depth = 0; depth < 12; depth += 1) {
    newestDeep.nested = {};
    oldestDeep.nested = {};
    newestDeep = newestDeep.nested;
    oldestDeep = oldestDeep.nested;
  }
  newestDeep.privateLeaf = "deep-newest-private-value";
  oldestDeep.privateLeaf = "deep-oldest-private-value";

  const summary = summarizeRecordDifferences(
    new Map([
      [
        "private-token",
        {
          recordHash: "a".repeat(64),
          sourceCard: newestSourceCard,
        },
      ],
    ]),
    new Map([
      [
        "private-token",
        {
          recordHash: "b".repeat(64),
          sourceCard: oldestSourceCard,
        },
      ],
    ]),
  );

  assert.equal(summary.recordMismatchIdentityCount, 1);
  assert.equal(
    summary.recordDifferencePathCounts.length,
    64,
  );
  assert.equal(
    summary.recordDifferencePathCountsTruncated,
    true,
  );
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("private-token"), false);
  assert.equal(serialized.includes("private-value"), false);
});

test("deep score diagnostic reports range violations without exposing cards", async () => {
  const reviews = fixtureReviews();
  const sourceCard = {
    ...reviews[4].sourceCard,
    reviewScore: 9,
  };
  reviews[4] = {
    ...reviews[4],
    reviewScore: 9,
    sourceCard,
    recordHash: recordHash(sourceCard),
  };
  const { fetchPage } = fakeValidatedPageFetcher({ reviews });
  const result = await runDeepScoreRangeDiagnostic({
    property: { key: "fixture_property" },
    fetchRaw: async () => {},
    scoreRange: "REVIEW_ADJ_AVERAGE_PASSABLE",
    fetchPage,
    delay: async () => {},
  });

  assert.equal(result.newestFirst.allCardsInRange, false);
  assert.equal(result.oldestFirst.allCardsInRange, false);
  assert.equal(
    JSON.stringify(result).includes(reviews[4].sourceReviewToken),
    false,
  );
});

test("deep score diagnostic rejects a non-empty explicit terminal", async () => {
  const extra = fixtureReviews({ count: 1 })[0];
  const { fetchPage } = fakeValidatedPageFetcher({
    mutatePage: (page, { skip }) =>
      skip === 20
        ? {
            ...page,
            cardCount: 1,
            reviews: [extra],
          }
        : page,
  });

  await assert.rejects(
    runDeepScoreRangeDiagnostic({
      property: { key: "fixture_property" },
      fetchRaw: async () => {},
      scoreRange: "REVIEW_ADJ_AVERAGE_PASSABLE",
      fetchPage,
      delay: async () => {},
    }),
    (error) =>
      error instanceof ScoreRangeDiagnosticError &&
      error.code === "PAGE_SHAPE_MISMATCH",
  );
});
