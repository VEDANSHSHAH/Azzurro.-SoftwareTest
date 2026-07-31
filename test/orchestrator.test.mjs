import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import {
  executeCanary,
  executeFullProperty,
  executeIncrementalProperty,
} from "../src/orchestrator.mjs";
import { collectExportRecords } from "../src/exporter.mjs";
import {
  REVIEW_SCORE_RANGE_VALUES,
  reviewScoreMatchesRange,
} from "../src/live-template.mjs";
import { ReviewStorage } from "../src/storage.mjs";

const property = {
  key: "orchestrator_hotel",
  businessName: "Orchestrator Hotel",
  bookingName: "Orchestrator Hotel",
  hotelId: 777,
  canonicalUrl: "https://www.booking.com/hotel/au/orchestrator.html",
  countryCode: "au",
  timeZone: "Australia/Sydney",
};

const centralProperty = {
  key: "central_sydney",
  businessName: "Central Sydney",
  bookingName: "Central Sydney Budget Stay - Near Central Station",
  hotelId: 9888182,
  canonicalUrl:
    "https://www.booking.com/hotel/au/venus-surry-hills.html",
  countryCode: "au",
  timeZone: "Australia/Sydney",
};

function card(index, score = (index % 10) + 1) {
  return {
    __typename: "ReviewCard",
    reviewUrl: `token-${String(index).padStart(4, "0")}`,
    reviewedDate: 1_700_000_000 + index,
    reviewScore: score,
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
  };
}

function centralSession() {
  const bucketDefinitions = [
    ["REVIEW_ADJ_SUPERB", 500, 9.5],
    ["REVIEW_ADJ_GOOD", 700, 8],
    ["REVIEW_ADJ_AVERAGE_PASSABLE", 322, 6],
    ["REVIEW_ADJ_POOR", 500, 4],
    ["REVIEW_ADJ_VERY_POOR", 514, 2],
  ];
  const all = [];
  const advertisedScoreCounts = new Map();
  for (const [bucket, count, score] of bucketDefinitions) {
    advertisedScoreCounts.set(
      bucket,
      count +
        (bucket === "REVIEW_ADJ_AVERAGE_PASSABLE" ? 1 : 0),
    );
    for (let index = 0; index < count; index += 1) {
      all.push(card(all.length, score));
    }
  }
  assert.equal(all.length, 2536);
  return {
    capturedHotelId: centralProperty.hotelId,
    capturedHotelScore: 6.9,
    querySha256: "b".repeat(64),
    visibleReviewCount: 2537,
    displayedScore: 6.9,
    fetchRaw: async ({ skip, limit, sorter }) => {
      const ordered =
        sorter === "OLDEST_FIRST" ? all : [...all].reverse();
      const text = JSON.stringify(
        response(
          ordered.slice(skip, skip + limit),
          2536,
          advertisedScoreCounts,
          2537,
        ),
      );
      return {
        status: 200,
        contentType: "application/json",
        text,
        elapsedMs: 1,
        responseBytes: Buffer.byteLength(text),
        retryAfter: null,
      };
    },
  };
}

function response(
  cards,
  count,
  scoreCounts,
  advertisedCount = count,
) {
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
        reviewScoreFilter: [
          {
            __typename: "ReviewScoreFilter",
            name: `All (${advertisedCount})`,
            value: "ALL",
            count: advertisedCount,
          },
          ...REVIEW_SCORE_RANGE_VALUES.map((value) => ({
            __typename: "ReviewScoreFilter",
            name: value,
            value,
            count: scoreCounts.get(value),
          })),
        ],
        languageFilter: [
          {
            __typename: "LanguageFilter",
            name: `All (${advertisedCount})`,
            value: "",
            count: advertisedCount,
            countryFlag: null,
          },
        ],
        timeOfYearFilter: [
          {
            __typename: "TimeOfYearFilter",
            name: `All (${advertisedCount})`,
            value: "ALL",
            count: advertisedCount,
          },
        ],
        customerTypeFilter: [
          {
            __typename: "CustomerTypeFilter",
            name: `All (${advertisedCount})`,
            value: "ALL",
            count: advertisedCount,
          },
        ],
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

function session(count) {
  const all = Array.from({ length: count }, (_, index) => card(index));
  const scoreCounts = new Map(
    REVIEW_SCORE_RANGE_VALUES.map((value) => [value, 0]),
  );
  for (const review of all) {
    const range = REVIEW_SCORE_RANGE_VALUES.find((value) =>
      reviewScoreMatchesRange(review.reviewScore, value),
    );
    scoreCounts.set(range, scoreCounts.get(range) + 1);
  }
  return {
    capturedHotelId: 777,
    capturedHotelScore: 8.5,
    querySha256: "a".repeat(64),
    visibleReviewCount: count,
    displayedScore: 8.5,
    fetchRaw: async ({ skip, limit, sorter }) => {
      const ordered =
        sorter === "OLDEST_FIRST" ? all : [...all].reverse();
      const text = JSON.stringify(
        response(
          ordered.slice(skip, skip + limit),
          count,
          scoreCounts,
        ),
      );
      return {
        status: 200,
        contentType: "application/json",
        text,
        elapsedMs: 1,
        responseBytes: Buffer.byteLength(text),
        retryAfter: null,
      };
    },
  };
}

async function database() {
  const directory = await mkdtemp(join(tmpdir(), "azzurro-orchestrator-"));
  const databasePath = join(directory, "reviews.sqlite");
  const storage = new ReviewStorage(databasePath);
  Object.defineProperty(storage, "testDatabasePath", {
    value: databasePath,
  });
  return storage;
}

test("full orchestration publishes only after two exact inventories", async () => {
  const storage = await database();
  try {
    const progress = [];
    const first = await executeFullProperty({
      property,
      session: session(11),
      storage,
      delayMs: 0,
      retryRandom: () => 0.5,
      onProgress: (event) => progress.push(event),
    });
    assert.equal(first.outcome, "published");
    assert.equal(first.structuredReviewCount, 11);
    assert.equal(first.inventoryPasses, 2);
    assert.equal(first.inventoryParity, "exact");
    assert.equal(first.inserted, 11);
    assert.equal(storage.getCurrentReviews(property.key).length, 11);
    const attestation = storage.getFullInventoryAttestation(
      first.runId,
    );
    assert.equal(attestation.expected_count, 11);
    assert.equal(attestation.oldest_unique_count, 11);
    assert.equal(attestation.newest_unique_count, 11);
    assert.equal(
      attestation.oldest_identity_sha256,
      attestation.newest_identity_sha256,
    );
    assert.equal(
      attestation.oldest_records_sha256,
      attestation.newest_records_sha256,
    );
    assert.equal(attestation.oldest_terminal_offset, 20);
    assert.equal(attestation.newest_terminal_offset, 20);
    assert.equal(
      first.inventoryIdentitySha256,
      attestation.oldest_identity_sha256,
    );
    assert.equal(storage.integrityCheck()[0].integrity_check, "ok");
    assert.deepEqual(
      progress
        .filter(({ terminal }) => terminal)
        .map(({ phaseKey, processedCount, expectedCount }) => ({
          phaseKey,
          processedCount,
          expectedCount,
        })),
      [
        {
          phaseKey: "inventory_oldest",
          processedCount: 11,
          expectedCount: 11,
        },
        {
          phaseKey: "inventory_newest",
          processedCount: 11,
          expectedCount: 11,
        },
        {
          phaseKey: "final_head",
          processedCount: 10,
          expectedCount: 11,
        },
      ],
    );
    assert.ok(
      progress.every(
        ({ runId, processedCount, expectedCount }) =>
          runId === first.runId && processedCount <= expectedCount,
      ),
    );

    const repeated = await executeFullProperty({
      property,
      session: session(11),
      storage,
      delayMs: 0,
      retryRandom: () => 0.5,
    });
    assert.equal(repeated.inserted, 0);
    assert.equal(repeated.updated, 0);
    assert.equal(repeated.unchanged, 11);
    assert.equal(storage.getCurrentReviews(property.key).length, 11);
    const authoritativeExport = collectExportRecords(
      storage,
      [property.key],
      { samplePerProperty: Infinity, strictAll: true },
    );
    assert.equal(authoritativeExport.properties.length, 1);
    assert.equal(authoritativeExport.records.length, 11);
    assert.equal(
      authoritativeExport.properties[0].authoritativeFullPublication,
      true,
    );
  } finally {
    storage.close();
  }
});

test("Central publishes 2,536 only under the exact persisted 2,537 source-gap attestation", async () => {
  const storage = await database();
  try {
    const result = await executeFullProperty({
      property: centralProperty,
      session: centralSession(),
      storage,
      delayMs: 0,
      retryRandom: () => 0.5,
    });
    assert.equal(result.outcome, "published");
    assert.equal(result.structuredReviewCount, 2536);
    assert.equal(result.advertisedReviewCount, 2537);
    assert.deepEqual(result.sourceDiscrepancy, {
      sourceDiscrepancyKind:
        "central_sydney_known_source_gap_v1",
      advertisedReviews: 2537,
      retrievableReviews: 2536,
      sourceReviewGap: 1,
      sourceDiscrepancyScoreBucket:
        "REVIEW_ADJ_AVERAGE_PASSABLE",
      advertisedBucketReviews: 323,
      retrievableBucketReviews: 322,
    });
    assert.equal(
      storage.getCurrentReviews(centralProperty.key).length,
      2536,
    );
    assert.equal(
      storage.getRun(result.runId).source_count_final,
      2536,
    );
    assert.equal(
      storage.getFullInventoryAttestation(result.runId)
        .expected_count,
      2536,
    );
    assert.equal(
      storage.getFullCountAttestation(result.runId)
        .expected_count,
      2536,
    );
    const discrepancy =
      storage.getSourceDiscrepancyAttestation(result.runId);
    assert.equal(
      discrepancy.contractKind,
      "central_sydney_known_source_gap_v1",
    );
    assert.equal(discrepancy.advertisedReviewCount, 2537);
    assert.equal(discrepancy.retrievableReviewCount, 2536);
    assert.equal(discrepancy.gapCount, 1);
    assert.equal(
      discrepancy.scoreBucket,
      "REVIEW_ADJ_AVERAGE_PASSABLE",
    );
    assert.equal(discrepancy.advertisedBucketCount, 323);
    assert.equal(discrepancy.retrievableBucketCount, 322);
    assert.equal(storage.integrityCheck()[0].integrity_check, "ok");

    const tamper = new DatabaseSync(storage.testDatabasePath);
    try {
      tamper
        .prepare(
          `UPDATE source_discrepancy_attestations
              SET gap_count = 2
            WHERE run_id = ?`,
        )
        .run(result.runId);
    } finally {
      tamper.close();
    }
    assert.throws(
      () => storage.promoteFull(result.runId),
      (error) =>
        error?.code ===
        "SOURCE_DISCREPANCY_ATTESTATION_MISMATCH",
    );
  } finally {
    storage.close();
  }
});

test("incremental orchestration is disabled before session or storage access", async () => {
  let sessionAccesses = 0;
  let storageAccesses = 0;
  const rejectingProxy = (onAccess) =>
    new Proxy(
      {},
      {
        get() {
          onAccess();
          throw new Error("disabled path touched a dependency");
        },
      },
    );

  await assert.rejects(
    executeIncrementalProperty({
      property,
      session: rejectingProxy(() => {
        sessionAccesses += 1;
      }),
      storage: rejectingProxy(() => {
        storageAccesses += 1;
      }),
    }),
    (error) =>
      error?.code === "INCREMENTAL_DISABLED" &&
      /complete full collection/.test(error.message),
  );
  assert.equal(sessionAccesses, 0);
  assert.equal(storageAccesses, 0);
});

test("authoritative orchestration requires matching visible score evidence", async () => {
  const missing = session(11);
  missing.displayedScore = null;
  await assert.rejects(
    executeCanary({
      property,
      session: missing,
      delayMs: 0,
    }),
    (error) => error?.code === "DISPLAY_SCORE_EVIDENCE_MISSING",
  );

  const mismatch = session(11);
  mismatch.displayedScore = 8.4;
  await assert.rejects(
    executeCanary({
      property,
      session: mismatch,
      delayMs: 0,
    }),
    (error) => error?.code === "DISPLAY_SCORE_MISMATCH",
  );
});
