import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import {
  ReviewStorage,
  StorageError,
} from "../src/storage.mjs";
import {
  contentHash as contractContentHash,
  normalizeReview,
  recordHash as contractRecordHash,
} from "../src/review-contract.mjs";
import {
  canonicalizeReviewPhotosForParity,
} from "../src/photo-url-parity.mjs";

const QUERY_HASH = "a".repeat(64);
const TRUSTED_TOTAL_SOURCES = [
  "reviewScoreFilter.ALL",
  "languageFilter.empty",
  "timeOfYearFilter.ALL",
  "customerTypeFilter.ALL",
];
const SCORE_BUCKET_VALUES = [
  "REVIEW_ADJ_SUPERB",
  "REVIEW_ADJ_GOOD",
  "REVIEW_ADJ_AVERAGE_PASSABLE",
  "REVIEW_ADJ_POOR",
  "REVIEW_ADJ_VERY_POOR",
];

function countEvidence(
  reviewsCount,
  {
    trustedCounts = TRUSTED_TOTAL_SOURCES.map(
      () => reviewsCount,
    ),
    bucketCounts = [reviewsCount, 0, 0, 0, 0],
  } = {},
) {
  return {
    reviewsCount,
    trustedTotals: TRUSTED_TOTAL_SOURCES.map((source, index) => ({
      source,
      count: trustedCounts[index],
    })),
    scoreBuckets: SCORE_BUCKET_VALUES.map((value, index) => ({
      value,
      count: bucketCounts[index],
    })),
  };
}

function storageFixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "azzurro-storage-"));
  const databasePath = join(directory, "reviews.sqlite");
  const storage = new ReviewStorage(
    databasePath,
    options,
  );
  Object.defineProperty(storage, "testDatabasePath", {
    value: databasePath,
  });
  t.after(() => {
    storage.close();
    rmSync(directory, { recursive: true, force: true });
  });
  storage.registerProperty({
    propertyKey: "olympic_paddington",
    bookingHotelId: 16211291,
    canonicalUrl:
      "https://www.booking.com/hotel/au/olympic-paddington.html",
    businessName: "Olympic Paddington",
    bookingName: "Olympic Paddington Budget Hotel",
    countryCode: "au",
    timeZone: "Australia/Sydney",
  });
  return storage;
}

function review(token, {
  score = 8.8,
  title = `Title ${token}`,
  positiveText = `Positive ${token}`,
  negativeText = null,
  partnerReply = null,
  reviewedDate = 1_775_000_000,
} = {}) {
  const textDetails = {
    title,
    positiveText,
    negativeText,
    lang: "en",
  };
  return {
    sourceReviewToken: token,
    reviewedDateRaw: reviewedDate,
    reviewScore: score,
    title,
    positiveText,
    negativeText,
    sourceLanguage: "en",
    partnerReply,
    bookingDetails: {
      customerType: "COUPLE",
      roomName: "Double Room",
    },
    guestDetails: {
      username: `Guest ${token}`,
      countryCode: "au",
    },
    photos: [],
    helpfulVotesCount: 0,
    sourceCard: {
      reviewUrl: token,
      reviewedDate,
      reviewScore: score,
      textDetails,
      partnerReply:
        partnerReply == null ? null : { reply: partnerReply },
      bookingDetails: {
        customerType: "COUPLE",
        roomName: "Double Room",
      },
      guestDetails: {
        username: `Guest ${token}`,
        countryCode: "au",
      },
      photos: [],
      helpfulVotesCount: 0,
    },
  };
}

function reviewWithPhoto(token, url, {
  photoOverrides = {},
  ...reviewOverrides
} = {}) {
  const normalized = review(token, reviewOverrides);
  const rawPhotos = [
    {
      __typename: "ReviewPhoto",
      id: 42,
      kind: null,
      mlTagHighestProbability: null,
      urls: [
        {
          __typename: "ReviewPhotoUrl",
          size: "square80",
          url,
        },
      ],
      ...photoOverrides,
    },
  ];
  normalized.sourceCard.photos = rawPhotos;
  normalized.photos = canonicalizeReviewPhotosForParity(rawPhotos);
  normalized.recordHash = contractRecordHash(normalized);
  return normalized;
}

function stageInventoryPhase(storage, {
  runId,
  phaseKey,
  sorter,
  reviews,
  reportedCount = reviews.length,
  terminal = true,
  terminalReportedCount = reportedCount,
  stopReason = "stable_after_end",
  countEvidenceForPage = ({
    reportedReviewCount: pageReportedCount,
  }) => countEvidence(pageReportedCount),
}) {
  storage.createPhase({ runId, phaseKey, sorter });
  for (
    let sourceOffset = 0;
    sourceOffset < reviews.length;
    sourceOffset += 10
  ) {
    storage.stagePage({
      runId,
      phaseKey,
      sourceOffset,
      requestedLimit: 10,
      reportedReviewCount: reportedCount,
      reviews: reviews.slice(sourceOffset, sourceOffset + 10),
      countEvidence: countEvidenceForPage({
        phaseKey,
        sourceOffset,
        reportedReviewCount: reportedCount,
        terminal: false,
      }),
    });
  }
  if (terminal) {
    storage.stagePage({
      runId,
      phaseKey,
      sourceOffset: Math.ceil(reportedCount / 10) * 10,
      requestedLimit: 10,
      reportedReviewCount: terminalReportedCount,
      reviews: [],
      countEvidence: countEvidenceForPage({
        phaseKey,
        sourceOffset:
          Math.ceil(reportedCount / 10) * 10,
        reportedReviewCount: terminalReportedCount,
        terminal: true,
      }),
    });
  }
  storage.finishPhase({
    runId,
    phaseKey,
    expectedCountEnd: reportedCount,
    stopReason,
  });
}

function stageFinalHead(storage, {
  runId,
  reviews,
  reportedCount = reviews.length,
  sorter = "NEWEST_FIRST",
  stopReason = "stable_final_head",
  pageCountEvidence = countEvidence(reportedCount),
}) {
  storage.createPhase({
    runId,
    phaseKey: "final_head",
    sorter,
  });
  storage.stagePage({
    runId,
    phaseKey: "final_head",
    sourceOffset: 0,
    requestedLimit: 10,
    reportedReviewCount: reportedCount,
    reviews: reviews.slice(0, 10),
    countEvidence: pageCountEvidence,
  });
  storage.finishPhase({
    runId,
    phaseKey: "final_head",
    expectedCountEnd: reportedCount,
    stopReason,
  });
}

function collectReadyRun(storage, {
  runId,
  reviews,
  mode = "full",
  finalCount = reviews.length,
  basePublicationRunId,
  propertyKey = "olympic_paddington",
  displayedReviewCount = finalCount,
}) {
  storage.createRun({
    runId,
    propertyKey,
    mode,
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
    basePublicationRunId,
  });
  if (["full", "reconcile"].includes(mode)) {
    const stageInventory = (phaseKey, sorter, orderedReviews) => {
      storage.createPhase({ runId, phaseKey, sorter });
      for (
        let sourceOffset = 0;
        sourceOffset < finalCount;
        sourceOffset += 10
      ) {
        storage.stagePage({
          runId,
          phaseKey,
          sourceOffset,
          requestedLimit: 10,
          reportedReviewCount: finalCount,
          countEvidence: countEvidence(finalCount),
          reviews: orderedReviews.slice(
            sourceOffset,
            sourceOffset + 10,
          ),
          latencyMs: 25,
          responseBytes: 512,
        });
      }
      storage.stagePage({
        runId,
        phaseKey,
        sourceOffset: Math.ceil(finalCount / 10) * 10,
        requestedLimit: 10,
        reportedReviewCount: finalCount,
        countEvidence: countEvidence(finalCount),
        reviews: [],
        latencyMs: 25,
        responseBytes: 128,
      });
      storage.finishPhase({
        runId,
        phaseKey,
        expectedCountEnd: finalCount,
        stopReason: "stable_after_end",
      });
    };
    stageInventory(
      "inventory_oldest",
      "OLDEST_FIRST",
      reviews,
    );
    const newestReviews = [...reviews].reverse();
    stageInventory(
      "inventory_newest",
      "NEWEST_FIRST",
      newestReviews,
    );
    storage.createPhase({
      runId,
      phaseKey: "final_head",
      sorter: "NEWEST_FIRST",
    });
    storage.stagePage({
      runId,
      phaseKey: "final_head",
      sourceOffset: 0,
      requestedLimit: 10,
      reportedReviewCount: finalCount,
      countEvidence: countEvidence(finalCount),
      reviews: newestReviews.slice(0, 10),
      latencyMs: 25,
      responseBytes: 512,
    });
    storage.finishPhase({
      runId,
      phaseKey: "final_head",
      expectedCountEnd: finalCount,
      stopReason: "stable_final_head",
    });
    storage.attestFullInventoryParity({
      runId,
      expectedCount: finalCount,
    });
  } else {
    storage.createPhase({
      runId,
      phaseKey: "primary",
      sorter: "NEWEST_FIRST",
    });
    storage.stagePage({
      runId,
      phaseKey: "primary",
      sourceOffset: 0,
      requestedLimit: 10,
      reportedReviewCount: finalCount,
      reviews,
      latencyMs: 25,
      responseBytes: 512,
    });
    storage.finishPhase({
      runId,
      phaseKey: "primary",
      expectedCountEnd: finalCount,
      stopReason: "terminal_page",
    });
  }
  storage.finalizeRun({
    runId,
    finalCount,
    snapshot: {
      displayedScore: 8.8,
      displayedReviewCount,
      ratingScores: [{ name: "Staff", score: 9.4 }],
    },
  });
  return storage.getRun(runId);
}

test("only Central can finalize with a positive visible count gap up to five", (t) => {
  const storage = storageFixture(t);
  storage.registerProperty({
    propertyKey: "central_sydney",
    bookingHotelId: 9888182,
    canonicalUrl:
      "https://www.booking.com/hotel/au/venus-surry-hills.html",
    businessName: "Central Sydney",
    bookingName: "Central Sydney Budget Stay",
    countryCode: "au",
    timeZone: "Australia/Sydney",
  });

  collectReadyRun(storage, {
    runId: "central-visible-gap",
    propertyKey: "central_sydney",
    reviews: [review("central-a"), review("central-b")],
    displayedReviewCount: 4,
  });
  const snapshot = storage.getSnapshot("central-visible-gap");
  assert.equal(snapshot.displayed_review_count, 4);
  assert.equal(snapshot.structured_review_count, 2);

  assert.throws(
    () =>
      collectReadyRun(storage, {
        runId: "central-gap-too-large",
        propertyKey: "central_sydney",
        reviews: [review("central-c"), review("central-d")],
        displayedReviewCount: 8,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "DISPLAYED_COUNT_MISMATCH",
  );
  assert.throws(
    () =>
      collectReadyRun(storage, {
        runId: "non-central-visible-gap",
        reviews: [review("olympic-a"), review("olympic-b")],
        displayedReviewCount: 4,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "DISPLAYED_COUNT_MISMATCH",
  );
});

test("a full run promotes atomically and promotion is idempotent", (t) => {
  const storage = storageFixture(t);
  collectReadyRun(storage, {
    runId: "full-1",
    reviews: [review("a"), review("b")],
  });
  const countAttestation =
    storage.getFullCountAttestation("full-1");
  assert.equal(countAttestation.contract_version, 1);
  assert.equal(countAttestation.expected_count, 2);
  assert.equal(countAttestation.authoritative_page_count, 5);
  assert.match(
    countAttestation.count_evidence_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(storage.getPageCountEvidence("full-1").length, 5);

  const first = storage.promoteRun("full-1");
  assert.equal(first.idempotent, false);
  assert.equal(storage.getCurrentReviews("olympic_paddington").length, 2);
  assert.equal(storage.getPublication("olympic_paddington").generation, 1);
  assert.equal(storage.getRun("full-1").inserted_count, 2);

  const second = storage.promoteRun("full-1");
  assert.equal(second.idempotent, true);
  assert.equal(storage.getCurrentReviews("olympic_paddington").length, 2);
  assert.equal(storage.getPublication("olympic_paddington").generation, 1);
  assert.equal(storage.getReviewVersions(
    "olympic_paddington",
    "a",
  ).length, 1);
  const stats = storage.getPublishedStats("olympic_paddington");
  assert.equal(stats.presentCount, 2);
  assert.equal(stats.suspectMissingCount, 0);
  assert.equal(stats.currentAverageScore, 8.8);
});

test("an attested zero-review full run retains terminal evidence", (t) => {
  const storage = storageFixture(t);
  collectReadyRun(storage, {
    runId: "empty-full",
    reviews: [],
  });
  const attestation =
    storage.getFullInventoryAttestation("empty-full");
  assert.equal(attestation.expected_count, 0);
  assert.equal(attestation.oldest_unique_count, 0);
  assert.equal(attestation.newest_unique_count, 0);
  assert.equal(attestation.oldest_terminal_offset, 0);
  assert.equal(attestation.newest_terminal_offset, 0);
  const countAttestation =
    storage.getFullCountAttestation("empty-full");
  assert.equal(countAttestation.expected_count, 0);
  assert.equal(countAttestation.authoritative_page_count, 3);
  assert.equal(
    storage.getPageCountEvidence("empty-full").length,
    3,
  );

  storage.promoteFull("empty-full");
  assert.equal(
    storage.getCurrentReviews("olympic_paddington").length,
    0,
  );
});

test("a non-zero reconcile run persists both authoritative attestations", (t) => {
  const storage = storageFixture(t);
  collectReadyRun(storage, {
    runId: "reconcile-count-evidence",
    mode: "reconcile",
    reviews: [review("a"), review("b")],
  });
  assert.equal(
    storage.getRun("reconcile-count-evidence").complete_inventory,
    1,
  );
  assert.equal(
    storage.getFullInventoryAttestation(
      "reconcile-count-evidence",
    ).expected_count,
    2,
  );
  assert.equal(
    storage.getFullCountAttestation(
      "reconcile-count-evidence",
    ).authoritative_page_count,
    5,
  );
  storage.promoteRun("reconcile-count-evidence");
  assert.equal(
    storage.getPublication("olympic_paddington")
      .last_successful_run_id,
    "reconcile-count-evidence",
  );
});

test("full and reconcile pages require count evidence before staging", (t) => {
  const storage = storageFixture(t);
  for (const mode of ["full", "reconcile"]) {
    const runId = `missing-evidence-${mode}`;
    storage.createRun({
      runId,
      propertyKey: "olympic_paddington",
      mode,
      querySha256: QUERY_HASH,
      parserVersion: "test-parser",
    });
    storage.createPhase({
      runId,
      phaseKey: "primary",
      sorter: "OLDEST_FIRST",
    });
    assert.throws(
      () =>
        storage.stagePage({
          runId,
          phaseKey: "primary",
          sourceOffset: 0,
          requestedLimit: 10,
          reportedReviewCount: 1,
          reviews: [review(`${mode}-a`)],
        }),
      (error) =>
        error instanceof StorageError &&
        error.code === "COUNT_EVIDENCE_REQUIRED",
    );
    assert.equal(storage.getPages(runId).length, 0);
    assert.equal(storage.getPageCountEvidence(runId).length, 0);
  }
});

test("count evidence rejects a one-total shape and score-bucket sum mismatch", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "invalid-count-evidence",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  storage.createPhase({
    runId: "invalid-count-evidence",
    phaseKey: "primary",
    sorter: "OLDEST_FIRST",
  });
  const oneTotal = countEvidence(2);
  oneTotal.trustedTotals = oneTotal.trustedTotals.slice(0, 1);
  assert.throws(
    () =>
      storage.stagePage({
        runId: "invalid-count-evidence",
        phaseKey: "primary",
        sourceOffset: 0,
        requestedLimit: 10,
        reportedReviewCount: 2,
        reviews: [review("a"), review("b")],
        countEvidence: oneTotal,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "INVALID_COUNT_EVIDENCE",
  );

  assert.throws(
    () =>
      storage.stagePage({
        runId: "invalid-count-evidence",
        phaseKey: "primary",
        sourceOffset: 0,
        requestedLimit: 10,
        reportedReviewCount: 2,
        reviews: [review("a"), review("b")],
        countEvidence: countEvidence(2, {
          bucketCounts: [1, 0, 0, 0, 0],
        }),
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "COUNT_EVIDENCE_MISMATCH",
  );
  assert.equal(storage.getPages("invalid-count-evidence").length, 0);
});

test("full count attestation rejects moving valid page evidence", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "moving-page-evidence",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  const oldest = [review("a"), review("b")];
  const newest = [...oldest].reverse();
  stageInventoryPhase(storage, {
    runId: "moving-page-evidence",
    phaseKey: "inventory_oldest",
    sorter: "OLDEST_FIRST",
    reviews: oldest,
    countEvidenceForPage: ({ reportedReviewCount, terminal }) =>
      terminal
        ? countEvidence(reportedReviewCount)
        : countEvidence(reportedReviewCount, {
            bucketCounts: [0, reportedReviewCount, 0, 0, 0],
          }),
  });
  stageInventoryPhase(storage, {
    runId: "moving-page-evidence",
    phaseKey: "inventory_newest",
    sorter: "NEWEST_FIRST",
    reviews: newest,
  });
  stageFinalHead(storage, {
    runId: "moving-page-evidence",
    reviews: newest,
  });

  assert.throws(
    () =>
      storage.attestFullInventoryParity({
        runId: "moving-page-evidence",
        expectedCount: 2,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "FULL_COUNT_EVIDENCE_MISMATCH",
  );
  assert.equal(
    storage.getFullCountAttestation("moving-page-evidence"),
    null,
  );
  assert.equal(
    storage.getFullInventoryAttestation("moving-page-evidence"),
    null,
  );
});

test("idempotent page replay requires the identical count evidence", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "count-replay",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  storage.createPhase({
    runId: "count-replay",
    phaseKey: "inventory_oldest",
    sorter: "OLDEST_FIRST",
  });
  const page = {
    runId: "count-replay",
    phaseKey: "inventory_oldest",
    sourceOffset: 0,
    requestedLimit: 10,
    reportedReviewCount: 1,
    reviews: [review("a")],
    countEvidence: countEvidence(1),
  };
  storage.stagePage(page);
  assert.throws(
    () =>
      storage.stagePage({
        ...page,
        countEvidence: countEvidence(1, {
          bucketCounts: [0, 1, 0, 0, 0],
        }),
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "PAGE_REPLAY_CONFLICT",
  );
  assert.equal(storage.getPages("count-replay").length, 1);
  assert.equal(storage.getPageCountEvidence("count-replay").length, 1);
});

test("finalize and promote recompute count evidence and its separate attestation", (t) => {
  const storage = storageFixture(t);
  collectReadyRun(storage, {
    runId: "tampered-page-count",
    reviews: [review("a")],
  });
  let tamper = new DatabaseSync(storage.testDatabasePath);
  try {
    tamper
      .prepare(
        `UPDATE scrape_page_count_evidence
            SET evidence_sha256 = ?
          WHERE page_id = (
            SELECT MIN(page_id)
              FROM scrape_page_count_evidence
             WHERE run_id = ?
          )`,
      )
      .run("0".repeat(64), "tampered-page-count");
  } finally {
    tamper.close();
  }
  for (const operation of [
    () =>
      storage.finalizeRun({
        runId: "tampered-page-count",
        finalCount: 1,
      }),
    () => storage.promoteRun("tampered-page-count"),
  ]) {
    assert.throws(
      operation,
      (error) =>
        error instanceof StorageError &&
        error.code === "FULL_COUNT_EVIDENCE_MISMATCH",
    );
  }

  collectReadyRun(storage, {
    runId: "tampered-count-attestation",
    reviews: [review("b")],
  });
  tamper = new DatabaseSync(storage.testDatabasePath);
  try {
    tamper
      .prepare(
        `UPDATE full_count_attestations
            SET count_evidence_sha256 = ?
          WHERE run_id = ?`,
      )
      .run("f".repeat(64), "tampered-count-attestation");
  } finally {
    tamper.close();
  }
  assert.throws(
    () => storage.promoteRun("tampered-count-attestation"),
    (error) =>
      error instanceof StorageError &&
      error.code === "FULL_COUNT_ATTESTATION_MISMATCH",
  );
  assert.equal(
    storage.getRun("tampered-count-attestation").status,
    "ready",
  );
});

test("the collector-facing aliases and page retry are idempotent", (t) => {
  const storage = storageFixture(t);
  storage.beginRun({
    runId: "alias-run",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  storage.beginPhase({
    runId: "alias-run",
    phaseKey: "inventory_oldest",
    sorter: "OLDEST_FIRST",
  });
  const page = {
    runId: "alias-run",
    phaseKey: "inventory_oldest",
    sourceOffset: 0,
    requestedLimit: 10,
    reportedReviewCount: 1,
    reviews: [review("a")],
    countEvidence: countEvidence(1),
  };
  const first = storage.stagePage(page);
  const replay = storage.stagePage(page);
  assert.equal(first.idempotent, false);
  assert.equal(replay.idempotent, true);
  assert.equal(storage.getPages("alias-run").length, 1);
  assert.equal(storage.getStagedReviews("alias-run")[0].occurrence_count, 1);
  assert.equal(storage.getRun("alias-run").requests_total, 1);

  storage.stagePage({
    ...page,
    sourceOffset: 10,
    reviews: [],
  });
  storage.finalizePhase({
    runId: "alias-run",
    phaseKey: "inventory_oldest",
    expectedCountEnd: 1,
    stopReason: "stable_after_end",
  });
  storage.beginPhase({
    runId: "alias-run",
    phaseKey: "inventory_newest",
    sorter: "NEWEST_FIRST",
  });
  storage.stagePage({
    ...page,
    phaseKey: "inventory_newest",
  });
  storage.stagePage({
    ...page,
    phaseKey: "inventory_newest",
    sourceOffset: 10,
    reviews: [],
  });
  storage.finalizePhase({
    runId: "alias-run",
    phaseKey: "inventory_newest",
    expectedCountEnd: 1,
    stopReason: "stable_after_end",
  });
  storage.beginPhase({
    runId: "alias-run",
    phaseKey: "final_head",
    sorter: "NEWEST_FIRST",
  });
  storage.stagePage({
    ...page,
    phaseKey: "final_head",
  });
  storage.finalizePhase({
    runId: "alias-run",
    phaseKey: "final_head",
    expectedCountEnd: 1,
    stopReason: "stable_final_head",
  });
  storage.attestFullInventoryParity({
    runId: "alias-run",
    expectedCount: 1,
  });
  storage.markReady({ runId: "alias-run", finalCount: 1 });
  storage.promoteFull("alias-run");
  assert.equal(storage.getCurrentReviews("olympic_paddington").length, 1);
});

test("storage verifies hashes produced by the response contract", (t) => {
  const storage = storageFixture(t);
  const card = {
    __typename: "ReviewCard",
    reviewUrl: "contract-token",
    reviewedDate: 1_775_000_000,
    reviewScore: 9.1,
    textDetails: {
      __typename: "TextDetails",
      title: "Accurate",
      positiveText: "Clean",
      negativeText: null,
      lang: "en",
      textTrivialFlag: 7,
    },
    bookingDetails: null,
    guestDetails: null,
    partnerReply: null,
    photos: [],
    helpfulVotesCount: 0,
    positiveHighlights: [],
    negativeHighlights: [],
    isApproved: true,
    isTranslatable: false,
    editUrl: null,
  };
  const normalized = normalizeReview(card, "olympic_paddington");
  const contracted = {
    ...normalized,
    contentHash: contractContentHash(normalized),
    recordHash: contractRecordHash(normalized),
  };

  storage.beginRun({
    runId: "contract-run",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  storage.beginPhase({
    runId: "contract-run",
    phaseKey: "primary",
    sorter: "OLDEST_FIRST",
  });
  storage.stagePage({
    runId: "contract-run",
    phaseKey: "primary",
    sourceOffset: 0,
    requestedLimit: 10,
    reportedReviewCount: 1,
    reviews: [contracted],
    countEvidence: countEvidence(1),
  });
  const staged = storage.getStagedReviews("contract-run")[0];
  assert.equal(staged.record_hash, contracted.recordHash);
  assert.equal(staged.content_hash, contracted.contentHash);
  assert.deepEqual(
    JSON.parse(staged.source_card_json),
    normalized.sourceCard,
  );
});

test("exact reconciliation rejects an incomplete full run", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "bad-count",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  storage.createPhase({
    runId: "bad-count",
    phaseKey: "primary",
    sorter: "OLDEST_FIRST",
  });
  storage.stagePage({
    runId: "bad-count",
    phaseKey: "primary",
    sourceOffset: 0,
    requestedLimit: 10,
    reportedReviewCount: 1,
    reviews: [review("a")],
    countEvidence: countEvidence(1),
  });
  storage.finishPhase({
    runId: "bad-count",
    phaseKey: "primary",
    expectedCountEnd: 2,
    stopReason: "test",
  });

  assert.throws(
    () => storage.finalizeRun({ runId: "bad-count", finalCount: 2 }),
    (error) =>
      error instanceof StorageError &&
      error.code === "RECONCILIATION_MISMATCH",
  );
  assert.equal(storage.getRun("bad-count").status, "collecting");
  assert.equal(storage.getSnapshot("bad-count"), null);
});

test("a full run cannot finalize with an arbitrary phase contract", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "arbitrary-phase",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  storage.createPhase({
    runId: "arbitrary-phase",
    phaseKey: "primary",
    sorter: "OLDEST_FIRST",
  });
  storage.stagePage({
    runId: "arbitrary-phase",
    phaseKey: "primary",
    sourceOffset: 0,
    requestedLimit: 10,
    reportedReviewCount: 1,
    reviews: [review("a")],
    countEvidence: countEvidence(1),
  });
  storage.finishPhase({
    runId: "arbitrary-phase",
    phaseKey: "primary",
    expectedCountEnd: 1,
    stopReason: "stable_after_end",
  });

  assert.throws(
    () =>
      storage.finalizeRun({
        runId: "arbitrary-phase",
        finalCount: 1,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "FULL_PUBLICATION_CONTRACT",
  );
  assert.equal(storage.getRun("arbitrary-phase").status, "collecting");
});

test("inventory attestation requires an explicit terminal page", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "no-terminal",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  stageInventoryPhase(storage, {
    runId: "no-terminal",
    phaseKey: "inventory_oldest",
    sorter: "OLDEST_FIRST",
    reviews: [review("a")],
    terminal: false,
  });

  assert.throws(
    () =>
      storage.attestFullInventoryParity({
        runId: "no-terminal",
        expectedCount: 1,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "FULL_PUBLICATION_CONTRACT" &&
      /terminal page/i.test(error.message),
  );
  assert.equal(
    storage.getFullInventoryAttestation("no-terminal"),
    null,
  );
});

test("inventory attestation rejects an unstable reported count", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "moving-count",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  stageInventoryPhase(storage, {
    runId: "moving-count",
    phaseKey: "inventory_oldest",
    sorter: "OLDEST_FIRST",
    reviews: [review("a")],
    terminalReportedCount: 2,
  });

  assert.throws(
    () =>
      storage.attestFullInventoryParity({
        runId: "moving-count",
        expectedCount: 1,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "FULL_PUBLICATION_CONTRACT" &&
      /page evidence/i.test(error.message),
  );
});

test("inventory attestation persists exact two-pass parity evidence", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "attested",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  const oldest = [review("a"), review("b")];
  const newest = [...oldest].reverse();
  stageInventoryPhase(storage, {
    runId: "attested",
    phaseKey: "inventory_oldest",
    sorter: "OLDEST_FIRST",
    reviews: oldest,
  });
  stageInventoryPhase(storage, {
    runId: "attested",
    phaseKey: "inventory_newest",
    sorter: "NEWEST_FIRST",
    reviews: newest,
  });
  stageFinalHead(storage, {
    runId: "attested",
    reviews: newest,
  });

  assert.throws(
    () =>
      storage.finalizeRun({
        runId: "attested",
        finalCount: 2,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "FULL_ATTESTATION_MISSING",
  );

  const attestation = storage.attestFullInventoryParity({
    runId: "attested",
    expectedCount: 2,
  });
  assert.equal(attestation.expected_count, 2);
  assert.equal(attestation.oldest_unique_count, 2);
  assert.equal(attestation.newest_unique_count, 2);
  assert.equal(
    attestation.oldest_identity_sha256,
    attestation.newest_identity_sha256,
  );
  assert.equal(
    attestation.oldest_records_sha256,
    attestation.newest_records_sha256,
  );
  assert.equal(attestation.oldest_terminal_offset, 10);
  assert.equal(attestation.newest_terminal_offset, 10);
  assert.equal(
    storage.attestFullInventoryParity({
      runId: "attested",
      expectedCount: 2,
    }).attested_at_utc,
    attestation.attested_at_utc,
  );
  storage.finalizeRun({
    runId: "attested",
    finalCount: 2,
  });
  assert.equal(storage.getRun("attested").status, "ready");
});

test("inventory attestation rejects unequal identity sets", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "parity-failure",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  stageInventoryPhase(storage, {
    runId: "parity-failure",
    phaseKey: "inventory_oldest",
    sorter: "OLDEST_FIRST",
    reviews: [review("a"), review("b")],
  });
  const newest = [review("c"), review("a")];
  stageInventoryPhase(storage, {
    runId: "parity-failure",
    phaseKey: "inventory_newest",
    sorter: "NEWEST_FIRST",
    reviews: newest,
  });
  stageFinalHead(storage, {
    runId: "parity-failure",
    reviews: newest,
  });

  assert.throws(
    () =>
      storage.attestFullInventoryParity({
        runId: "parity-failure",
        expectedCount: 2,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "FULL_PUBLICATION_CONTRACT" &&
      /parity/i.test(error.message),
  );
});

test("inventory attestation rejects a changed final head", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "moving-head",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  const oldest = [review("a"), review("b")];
  const newest = [...oldest].reverse();
  stageInventoryPhase(storage, {
    runId: "moving-head",
    phaseKey: "inventory_oldest",
    sorter: "OLDEST_FIRST",
    reviews: oldest,
  });
  stageInventoryPhase(storage, {
    runId: "moving-head",
    phaseKey: "inventory_newest",
    sorter: "NEWEST_FIRST",
    reviews: newest,
  });
  stageFinalHead(storage, {
    runId: "moving-head",
    reviews: oldest,
  });

  assert.throws(
    () =>
      storage.attestFullInventoryParity({
        runId: "moving-head",
        expectedCount: 2,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "FULL_PUBLICATION_CONTRACT" &&
      /final head/i.test(error.message),
  );
});

test("a page hash conflict rolls the whole page back and fails the run", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "conflict",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  storage.createPhase({
    runId: "conflict",
    phaseKey: "primary",
    sorter: "OLDEST_FIRST",
  });
  storage.stagePage({
    runId: "conflict",
    phaseKey: "primary",
    sourceOffset: 0,
    requestedLimit: 1,
    reportedReviewCount: 3,
    reviews: [review("a")],
    countEvidence: countEvidence(3),
  });

  assert.throws(
    () =>
      storage.stagePage({
        runId: "conflict",
        phaseKey: "primary",
        sourceOffset: 1,
        requestedLimit: 2,
        reportedReviewCount: 3,
        countEvidence: countEvidence(3),
        reviews: [
          review("b"),
          review("a", { positiveText: "Changed during scan" }),
        ],
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "STAGE_HASH_CONFLICT",
  );

  assert.deepEqual(
    storage.getStagedReviews("conflict").map(
      (item) => item.source_review_token,
    ),
    ["a"],
  );
  assert.equal(storage.getPages("conflict").length, 1);
  assert.equal(storage.getPhase("conflict", "primary").next_offset, 1);
  assert.equal(storage.getRun("conflict").status, "failed");
});

test("hostname-only photo rotation is idempotent for a page replay while raw source JSON is retained", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "photo-page-replay",
    propertyKey: "olympic_paddington",
    mode: "incremental",
    querySha256: QUERY_HASH,
    parserVersion: "2.3.0",
  });
  storage.createPhase({
    runId: "photo-page-replay",
    phaseKey: "primary",
    sorter: "NEWEST_FIRST",
  });
  const suffix =
    "/xdata/images/hotel/square80/42.jpg?k=asset&hp=1#crop";
  const firstUrl = `https://cf.bstatic.com${suffix}`;
  const rotatedUrl = `https://q-xx.bstatic.com${suffix}`;

  storage.stagePage({
    runId: "photo-page-replay",
    phaseKey: "primary",
    sourceOffset: 0,
    requestedLimit: 10,
    reportedReviewCount: 1,
    reviews: [reviewWithPhoto("photo-a", firstUrl)],
  });
  const replay = storage.stagePage({
    runId: "photo-page-replay",
    phaseKey: "primary",
    sourceOffset: 0,
    requestedLimit: 10,
    reportedReviewCount: 1,
    reviews: [reviewWithPhoto("photo-a", rotatedUrl)],
  });

  assert.equal(replay.idempotent, true);
  assert.equal(storage.getPages("photo-page-replay").length, 1);
  const staged = storage.getStagedReviews("photo-page-replay")[0];
  assert.equal(
    JSON.parse(staged.source_card_json).photos[0].urls[0].url,
    firstUrl,
  );
  assert.equal(
    staged.record_hash,
    reviewWithPhoto("photo-a", rotatedUrl).recordHash,
  );
});

test("raw Booking photo URLs are accepted when their semantic source-card form matches", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "raw-photo-attribution",
    propertyKey: "olympic_paddington",
    mode: "incremental",
    querySha256: QUERY_HASH,
    parserVersion: "2.3.0",
  });
  storage.createPhase({
    runId: "raw-photo-attribution",
    phaseKey: "primary",
    sorter: "NEWEST_FIRST",
  });
  const liveLikeReview = reviewWithPhoto(
    "raw-photo",
    "https://cf.bstatic.com/xdata/images/hotel/square80/42.jpg?k=asset",
  );
  liveLikeReview.photos = liveLikeReview.sourceCard.photos;
  delete liveLikeReview.contentHash;

  assert.doesNotThrow(() =>
    storage.stagePage({
      runId: "raw-photo-attribution",
      phaseKey: "primary",
      sourceOffset: 0,
      requestedLimit: 10,
      reportedReviewCount: 1,
      reviews: [liveLikeReview],
    }),
  );
});

test("omitted optional guest fields match their normalised null values", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "guest-optional-attribution",
    propertyKey: "olympic_paddington",
    mode: "incremental",
    querySha256: QUERY_HASH,
    parserVersion: "2.3.0",
  });
  storage.createPhase({
    runId: "guest-optional-attribution",
    phaseKey: "primary",
    sorter: "NEWEST_FIRST",
  });
  const reviewWithNormalisedGuestFields = review("guest-optional");
  reviewWithNormalisedGuestFields.guestDetails = {
    ...reviewWithNormalisedGuestFields.guestDetails,
    userReviewCount: null,
    joinedDate: null,
  };

  assert.doesNotThrow(() =>
    storage.stagePage({
      runId: "guest-optional-attribution",
      phaseKey: "primary",
      sourceOffset: 0,
      requestedLimit: 10,
      reportedReviewCount: 1,
      reviews: [reviewWithNormalisedGuestFields],
    }),
  );
});

test("hostname-only photo rotation preserves full-run parity and the first raw observation", (t) => {
  const storage = storageFixture(t);
  storage.createRun({
    runId: "photo-full-parity",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "2.3.0",
  });
  const suffix =
    ":443/xdata/images/hotel/square80/42.jpg?k=asset&hp=1#crop";
  const oldestUrl = `https://cf.bstatic.com${suffix}`;
  const newestUrl = `https://q-xx.bstatic.com${suffix}`;
  const finalHeadUrl = `https://r-xx.bstatic.com${suffix}`;

  stageInventoryPhase(storage, {
    runId: "photo-full-parity",
    phaseKey: "inventory_oldest",
    sorter: "OLDEST_FIRST",
    reviews: [reviewWithPhoto("photo-a", oldestUrl)],
  });
  stageInventoryPhase(storage, {
    runId: "photo-full-parity",
    phaseKey: "inventory_newest",
    sorter: "NEWEST_FIRST",
    reviews: [reviewWithPhoto("photo-a", newestUrl)],
  });
  stageFinalHead(storage, {
    runId: "photo-full-parity",
    reviews: [reviewWithPhoto("photo-a", finalHeadUrl)],
  });

  const attestation = storage.attestFullInventoryParity({
    runId: "photo-full-parity",
    expectedCount: 1,
  });
  assert.equal(
    attestation.oldest_records_sha256,
    attestation.newest_records_sha256,
  );
  storage.finalizeRun({
    runId: "photo-full-parity",
    finalCount: 1,
  });
  storage.promoteRun("photo-full-parity");

  const staged = storage.getStagedReviews("photo-full-parity")[0];
  const current =
    storage.getCurrentReviews("olympic_paddington")[0];
  assert.equal(staged.occurrence_count, 3);
  assert.equal(
    JSON.parse(staged.source_card_json).photos[0].urls[0].url,
    oldestUrl,
  );
  assert.equal(
    JSON.parse(current.source_card_json).photos[0].urls[0].url,
    oldestUrl,
  );
});

test("hostname-only photo rotation across runs does not create a new immutable version", (t) => {
  const storage = storageFixture(t);
  const suffix =
    "/xdata/images/hotel/square80/42.jpg?k=asset&hp=1#crop";
  const baselineUrl = `https://cf.bstatic.com${suffix}`;
  const rotatedUrl = `https://q-xx.bstatic.com${suffix}`;
  collectReadyRun(storage, {
    runId: "photo-baseline",
    reviews: [reviewWithPhoto("photo-a", baselineUrl)],
  });
  storage.promoteRun("photo-baseline");

  collectReadyRun(storage, {
    runId: "photo-rotated",
    mode: "incremental",
    finalCount: 1,
    reviews: [reviewWithPhoto("photo-a", rotatedUrl)],
  });
  storage.promoteRun("photo-rotated");

  const versions = storage.getReviewVersions(
    "olympic_paddington",
    "photo-a",
  );
  assert.equal(versions.length, 1);
  assert.equal(storage.getRun("photo-rotated").updated_count, 0);
  assert.equal(storage.getRun("photo-rotated").unchanged_count, 1);
  assert.equal(
    JSON.parse(versions[0].source_card_json).photos[0].urls[0].url,
    baselineUrl,
  );
  assert.equal(
    JSON.parse(
      storage.getStagedReviews("photo-rotated")[0].source_card_json,
    ).photos[0].urls[0].url,
    rotatedUrl,
  );
});

test("every non-host photo URL change remains a same-run conflict", (t) => {
  const storage = storageFixture(t);
  const baseline =
    "https://cf.bstatic.com:8443/xdata/images/hotel/square80/42.jpg" +
    "?k=asset&hp=1#crop";
  const changedUrls = [
    baseline.replace(":8443", ":8444"),
    baseline.replace("/42.jpg", "/43.jpg"),
    baseline.replace("k=asset", "k=other"),
    baseline.replace("?k=asset&hp=1", "?hp=1&k=asset"),
    baseline.replace("#crop", "#full"),
  ];

  for (const [index, changedUrl] of changedUrls.entries()) {
    const runId = `photo-component-conflict-${index}`;
    storage.createRun({
      runId,
      propertyKey: "olympic_paddington",
      mode: "incremental",
      querySha256: QUERY_HASH,
      parserVersion: "2.3.0",
    });
    storage.createPhase({
      runId,
      phaseKey: "primary",
      sorter: "NEWEST_FIRST",
    });
    storage.stagePage({
      runId,
      phaseKey: "primary",
      sourceOffset: 0,
      requestedLimit: 1,
      reportedReviewCount: 3,
      reviews: [reviewWithPhoto("photo-a", baseline)],
    });

    assert.throws(
      () =>
        storage.stagePage({
          runId,
          phaseKey: "primary",
          sourceOffset: 1,
          requestedLimit: 2,
          reportedReviewCount: 3,
          reviews: [
            review(`other-${index}`),
            reviewWithPhoto("photo-a", changedUrl),
          ],
        }),
      (error) =>
        error instanceof StorageError &&
        error.code === "STAGE_HASH_CONFLICT",
      changedUrl,
    );
    assert.equal(storage.getPages(runId).length, 1);
    assert.equal(storage.getRun(runId).status, "failed");
  }
});

test("changed source data creates an immutable current version", (t) => {
  const storage = storageFixture(t);
  collectReadyRun(storage, {
    runId: "baseline",
    reviews: [review("a")],
  });
  storage.promoteRun("baseline");

  collectReadyRun(storage, {
    runId: "edit",
    mode: "incremental",
    finalCount: 1,
    reviews: [
      review("a", {
        score: 7.1,
        positiveText: "Updated text",
        partnerReply: "Thanks for the feedback",
      }),
    ],
  });
  storage.promoteRun("edit");

  const versions = storage.getReviewVersions(
    "olympic_paddington",
    "a",
  );
  assert.equal(versions.length, 2);
  assert.equal(versions[0].is_current, 0);
  assert.equal(versions[1].is_current, 1);
  assert.equal(versions[1].score_tenths, 71);
  assert.equal(versions[1].positive_text, "Updated text");
  assert.equal(
    JSON.parse(versions[1].source_card_json).partnerReply.reply,
    "Thanks for the feedback",
  );
  assert.notEqual(versions[0].record_hash, versions[1].record_hash);
  assert.equal(storage.getRun("edit").updated_count, 1);
});

test("missing, tombstone, incremental safety, and reactivation states work", (t) => {
  const storage = storageFixture(t);
  collectReadyRun(storage, {
    runId: "baseline",
    reviews: [review("a"), review("b")],
  });
  storage.promoteRun("baseline");

  storage.createRun({
    runId: "failed-full",
    propertyKey: "olympic_paddington",
    mode: "full",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  storage.failRun("failed-full", "TEST_FAILURE");
  assert.equal(
    storage.getReviewIdentity("olympic_paddington", "b")
      .consecutive_missing_full_scans,
    0,
  );

  collectReadyRun(storage, {
    runId: "missing-once",
    reviews: [review("a")],
    finalCount: 1,
  });
  storage.promoteRun("missing-once");
  let identity = storage.getReviewIdentity(
    "olympic_paddington",
    "b",
  );
  assert.equal(identity.presence_state, "suspect_missing");
  assert.equal(identity.consecutive_missing_full_scans, 1);

  collectReadyRun(storage, {
    runId: "incremental",
    mode: "incremental",
    reviews: [review("a")],
    finalCount: 1,
  });
  storage.promoteRun("incremental");
  identity = storage.getReviewIdentity("olympic_paddington", "b");
  assert.equal(identity.presence_state, "suspect_missing");
  assert.equal(identity.consecutive_missing_full_scans, 1);

  collectReadyRun(storage, {
    runId: "missing-twice",
    reviews: [review("a")],
    finalCount: 1,
  });
  storage.promoteRun("missing-twice");
  identity = storage.getReviewIdentity("olympic_paddington", "b");
  assert.equal(identity.presence_state, "tombstoned");
  assert.equal(identity.consecutive_missing_full_scans, 2);
  assert.equal(storage.getCurrentReviews("olympic_paddington").length, 1);

  collectReadyRun(storage, {
    runId: "reappeared",
    reviews: [review("a"), review("b")],
    finalCount: 2,
  });
  storage.promoteRun("reappeared");
  identity = storage.getReviewIdentity("olympic_paddington", "b");
  assert.equal(identity.presence_state, "present");
  assert.equal(identity.consecutive_missing_full_scans, 0);
  assert.equal(identity.reactivation_count, 1);
  assert.equal(storage.getCurrentReviews("olympic_paddington").length, 2);
});

test("incremental collection cannot hide an unknown removal", (t) => {
  const storage = storageFixture(t);
  collectReadyRun(storage, {
    runId: "baseline",
    reviews: [review("a"), review("b")],
  });
  storage.promoteRun("baseline");

  storage.createRun({
    runId: "bad-incremental",
    propertyKey: "olympic_paddington",
    mode: "incremental",
    querySha256: QUERY_HASH,
    parserVersion: "test-parser",
  });
  storage.createPhase({
    runId: "bad-incremental",
    phaseKey: "primary",
    sorter: "NEWEST_FIRST",
  });
  storage.stagePage({
    runId: "bad-incremental",
    phaseKey: "primary",
    sourceOffset: 0,
    requestedLimit: 10,
    reportedReviewCount: 1,
    reviews: [review("a")],
  });
  storage.finishPhase({
    runId: "bad-incremental",
    phaseKey: "primary",
    expectedCountEnd: 1,
    stopReason: "known_overlap",
  });

  assert.throws(
    () =>
      storage.finalizeRun({
        runId: "bad-incremental",
        finalCount: 1,
      }),
    (error) =>
      error instanceof StorageError &&
      error.code === "INCREMENTAL_COUNT_MISMATCH",
  );
  assert.equal(
    storage.getReviewIdentity("olympic_paddington", "b").presence_state,
    "present",
  );
});

test("stale-base promotion is rejected without changing publication", (t) => {
  const storage = storageFixture(t);
  collectReadyRun(storage, {
    runId: "baseline",
    reviews: [review("a")],
  });
  storage.promoteRun("baseline");

  collectReadyRun(storage, {
    runId: "candidate-one",
    reviews: [review("a")],
  });
  collectReadyRun(storage, {
    runId: "candidate-two",
    reviews: [review("a")],
  });
  storage.promoteRun("candidate-one");

  assert.throws(
    () => storage.promoteRun("candidate-two"),
    (error) =>
      error instanceof StorageError &&
      error.code === "STALE_BASE_PUBLICATION",
  );
  assert.equal(
    storage.getPublication("olympic_paddington")
      .last_successful_run_id,
    "candidate-one",
  );
  assert.equal(storage.getRun("candidate-two").status, "ready");
});

test("an injected promotion crash leaves the previous state untouched", (t) => {
  let shouldCrash = true;
  const storage = storageFixture(t, {
    faultInjector(point) {
      if (shouldCrash && point === "promotion:before-publication") {
        throw new Error("simulated process failure");
      }
    },
  });
  collectReadyRun(storage, {
    runId: "crash-run",
    reviews: [review("a")],
  });

  assert.throws(
    () => storage.promoteRun("crash-run"),
    /simulated process failure/,
  );
  assert.equal(storage.getCurrentReviews("olympic_paddington").length, 0);
  assert.equal(storage.getPublication("olympic_paddington"), null);
  assert.equal(storage.getRun("crash-run").status, "ready");

  shouldCrash = false;
  storage.promoteRun("crash-run");
  assert.equal(storage.getCurrentReviews("olympic_paddington").length, 1);
  assert.equal(
    storage.getPublication("olympic_paddington")
      .last_successful_run_id,
    "crash-run",
  );
});

test("SQLite remains internally consistent after transactional tests", (t) => {
  const storage = storageFixture(t);
  collectReadyRun(storage, {
    runId: "integrity-run",
    reviews: [review("a")],
  });
  storage.promoteRun("integrity-run");
  assert.equal(
    storage.integrityCheck()[0].integrity_check,
    "ok",
  );
});
