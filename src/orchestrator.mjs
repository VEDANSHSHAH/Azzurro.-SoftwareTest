import {
  assertExactInventoryParity,
  collectInventoryPhase,
  collectorInternals,
  CollectionError,
  fetchValidatedPage,
  runPropertyCanary,
} from "./collector.mjs";
import { RunMetrics } from "./metrics.mjs";
import { PARSER_VERSION } from "./review-contract.mjs";
import { redactForLog } from "./redact.mjs";
import { safeSourceDiscrepancyEvidence } from "./source-discrepancy.mjs";

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function propertyForStorage(property) {
  return {
    propertyKey: property.key,
    bookingHotelId: property.hotelId,
    canonicalUrl: property.canonicalUrl,
    businessName: property.businessName,
    bookingName: property.bookingName,
    countryCode: property.countryCode,
    timeZone: property.timeZone,
  };
}

function redactedErrorDetail(error) {
  const redacted = redactForLog(error);
  const encoded = JSON.stringify(redacted);
  return encoded.length <= 4_000
    ? encoded
    : `${encoded.slice(0, 3_997)}...`;
}

function safeFailRun(storage, runId, error) {
  if (!runId) return;
  try {
    const run = storage.getRun(runId);
    if (run && !["failed", "succeeded"].includes(run.status)) {
      storage.failRun(
        runId,
        error?.code ?? "UNEXPECTED_ERROR",
        redactedErrorDetail(error),
      );
    }
  } catch {
    // Preserve the original collection error.
  }
}

function sessionFields(session) {
  if (!session || typeof session.fetchRaw !== "function") {
    throw new TypeError("session.fetchRaw must be a function");
  }
  if (!Number.isInteger(Number(session.capturedHotelId))) {
    throw new TypeError("session.capturedHotelId is required");
  }
  if (
    typeof session.querySha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(session.querySha256)
  ) {
    throw new TypeError("session.querySha256 must be a SHA-256 value");
  }
  for (const [field, value] of [
    ["session.capturedHotelScore", session.capturedHotelScore],
    ["session.displayedScore", session.displayedScore],
  ]) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 10
    ) {
      throw new CollectionError(
        "DISPLAY_SCORE_EVIDENCE_MISSING",
        `${field} must be a live score between 0 and 10`,
      );
    }
  }
  if (
    Math.round(session.capturedHotelScore * 10) !==
    Math.round(session.displayedScore * 10)
  ) {
    throw new CollectionError(
      "DISPLAY_SCORE_MISMATCH",
      "The score displayed on the property page does not match the captured review request",
      {
        capturedHotelScore: session.capturedHotelScore,
        displayedScore: session.displayedScore,
      },
    );
  }
  return session;
}

function metricsPage(metrics, page) {
  metrics.recordPage({
    latencyMs: page.request.elapsedMs ?? 0,
    cardCount: page.cardCount,
    responseBytes: page.request.responseBytes ?? 0,
    retries: page.request.retries ?? 0,
  });
}

function countEvidenceForStorage(page) {
  return {
    reviewsCount: page.reviewsCount,
    trustedTotals: page.totalConsistency.totals.map(
      ({ source, count }) => ({ source, count }),
    ),
    scoreBuckets: page.filters.reviewScores
      .filter(({ value }) => value !== "ALL")
      .map(({ value, count }) => ({ value, count })),
  };
}

function publicSourceDiscrepancy(attestation) {
  if (attestation === null) return null;
  return safeSourceDiscrepancyEvidence({
    contractVersion: attestation.contractVersion,
    contractKind: attestation.contractKind,
    propertyKey: attestation.propertyKey,
    bookingHotelId: attestation.bookingHotelId,
    advertisedReviewCount:
      attestation.advertisedReviewCount,
    retrievableReviewCount:
      attestation.retrievableReviewCount,
    gapCount: attestation.gapCount,
    advertisedScoreBuckets:
      attestation.advertisedScoreBuckets,
    retrievableScoreBuckets:
      attestation.retrievableScoreBuckets,
    scoreBucketGap: {
      value: attestation.scoreBucket,
      advertisedCount:
        attestation.advertisedBucketCount,
      retrievableCount:
        attestation.retrievableBucketCount,
      gapCount: attestation.gapCount,
    },
  });
}

function stageCallback({
  storage,
  runId,
  phaseKey,
  metrics,
  expectedCount,
  onProgress,
}) {
  return async ({ page, pageNumber, skip, sorter, terminal }) => {
    storage.stagePage({
      runId,
      phaseKey,
      sourceOffset: skip,
      requestedLimit: page.request.limit,
      reportedReviewCount: page.reviewsCount,
      reviews: page.reviews,
      attemptCount: page.request.attempt,
      latencyMs: page.request.elapsedMs,
      responseBytes: page.request.responseBytes,
      countEvidence: countEvidenceForStorage(page),
    });
    metricsPage(metrics, page);
    await onProgress?.({
      runId,
      phaseKey,
      pageNumber,
      sorter,
      sourceOffset: skip,
      cardCount: page.cardCount,
      processedCount: Math.min(
        expectedCount,
        skip + page.cardCount,
      ),
      expectedCount,
      terminal: Boolean(terminal),
    });
  };
}

async function createCanary({
  property,
  session,
  maxAttempts,
  delayMs,
  retryRandom,
}) {
  return runPropertyCanary({
    property,
    fetchRaw: session.fetchRaw,
    capturedHotelId: session.capturedHotelId,
    visibleReviewCount: session.visibleReviewCount ?? null,
    maxAttempts,
    retryRandom,
    betweenRequests: () => sleep(delayMs),
    requireAuthoritativeEvidence: true,
  });
}

export async function executeCanary({
  property,
  session,
  maxAttempts = 3,
  delayMs = 750,
  retryRandom = Math.random,
}) {
  sessionFields(session);
  const started = performance.now();
  const canary = await createCanary({
    property,
    session,
    maxAttempts,
    delayMs,
    retryRandom,
  });
  return {
    propertyKey: property.key,
    outcome: "passed",
    capturedHotelId: Number(session.capturedHotelId),
    querySha256: session.querySha256,
    structuredReviewCount: canary.reviewsCount,
    visibleReviewCount: session.visibleReviewCount ?? null,
    displayedScore: session.displayedScore ?? null,
    categoryCount: canary.ratingScores.length,
    newestCards: canary.newest.cardCount,
    oldestCards: canary.oldest.cardCount,
    durationMs: Math.round(performance.now() - started),
  };
}

export async function executeFullProperty({
  property,
  session,
  storage,
  maxAttempts = 3,
  delayMs = 750,
  maxPages = null,
  retryRandom = Math.random,
  onProgress = null,
}) {
  if (onProgress !== null && typeof onProgress !== "function") {
    throw new TypeError("onProgress must be a function or null");
  }
  sessionFields(session);
  storage.registerProperty(propertyForStorage(property));
  const metrics = new RunMetrics();
  let runId = null;

  try {
    const run = storage.beginRun({
      propertyKey: property.key,
      mode: "full",
      querySha256: session.querySha256,
      parserVersion: PARSER_VERSION,
    });
    runId = run.run_id;

    const canary = await createCanary({
      property,
      session,
      maxAttempts,
      delayMs,
      retryRandom,
    });
    const delay = () => sleep(delayMs);
    const retrievableCount =
      canary.sourceDiscrepancy?.retrievableReviewCount ??
      canary.reviewsCount;

    const oldestPhase = "inventory_oldest";
    storage.beginPhase({
      runId,
      phaseKey: oldestPhase,
      sorter: "OLDEST_FIRST",
    });
    const oldest = await collectInventoryPhase({
      property,
      fetchRaw: session.fetchRaw,
      sorter: "OLDEST_FIRST",
      reportedCount: canary.reviewsCount,
      sourceDiscrepancy: canary.sourceDiscrepancy,
      categoryDigest: canary.categoryDigest,
      aggregateDigest: canary.aggregateDigest,
      firstPage: canary.oldest,
      onPage: stageCallback({
        storage,
        runId,
        phaseKey: oldestPhase,
        metrics,
        expectedCount: retrievableCount,
        onProgress,
      }),
      delay,
      maxAttempts,
      maxPages,
      retryRandom,
    });
    storage.finishPhase({
      runId,
      phaseKey: oldestPhase,
      expectedCountEnd: retrievableCount,
      stopReason: "stable_after_end",
    });

    const newestPhase = "inventory_newest";
    storage.beginPhase({
      runId,
      phaseKey: newestPhase,
      sorter: "NEWEST_FIRST",
    });
    const newest = await collectInventoryPhase({
      property,
      fetchRaw: session.fetchRaw,
      sorter: "NEWEST_FIRST",
      reportedCount: canary.reviewsCount,
      sourceDiscrepancy: canary.sourceDiscrepancy,
      categoryDigest: canary.categoryDigest,
      aggregateDigest: canary.aggregateDigest,
      onPage: stageCallback({
        storage,
        runId,
        phaseKey: newestPhase,
        metrics,
        expectedCount: retrievableCount,
        onProgress,
      }),
      delay,
      maxAttempts,
      maxPages,
      retryRandom,
    });
    storage.finishPhase({
      runId,
      phaseKey: newestPhase,
      expectedCountEnd: retrievableCount,
      stopReason: "stable_after_end",
    });
    assertExactInventoryParity(oldest, newest);

    await delay();
    const finalHead = await fetchValidatedPage({
      property,
      fetchRaw: session.fetchRaw,
      skip: 0,
      limit: collectorInternals.PAGE_SIZE,
      sorter: "NEWEST_FIRST",
      maxAttempts,
      retryRandom,
    });
    if (
      finalHead.reviewsCount !== canary.reviewsCount ||
      collectorInternals.categoryDigest(finalHead.ratingScores) !==
        canary.categoryDigest ||
      collectorInternals.authoritativeAggregateDigest(
        finalHead,
        property,
      ) !==
        canary.aggregateDigest ||
      collectorInternals.pageRecordDigest(finalHead.reviews) !==
        collectorInternals.pageRecordDigest(
          newest.pages[0]?.reviews ?? [],
        )
    ) {
      throw new CollectionError(
        "FINAL_HEAD_MISMATCH",
        "The property changed after the independent inventories",
      );
    }

    const finalPhase = "final_head";
    storage.beginPhase({
      runId,
      phaseKey: finalPhase,
      sorter: "NEWEST_FIRST",
    });
    await stageCallback({
      storage,
      runId,
      phaseKey: finalPhase,
      metrics,
      expectedCount: retrievableCount,
      onProgress,
    })({
      page: finalHead,
      pageNumber: 0,
      skip: 0,
      sorter: "NEWEST_FIRST",
      terminal: true,
    });
    storage.finishPhase({
      runId,
      phaseKey: finalPhase,
      expectedCountEnd: retrievableCount,
      stopReason: "stable_final_head",
    });

    const inventoryAttestation =
      storage.attestFullInventoryParity({
        runId,
        expectedCount: retrievableCount,
        sourceDiscrepancy:
          newest.sourceDiscrepancy ??
          oldest.sourceDiscrepancy ??
          null,
      });
    storage.finalizeRun({
      runId,
      finalCount: retrievableCount,
      snapshot: {
        displayedScore: session.displayedScore ?? null,
        displayedReviewCount: session.visibleReviewCount ?? null,
        ratingScores: finalHead.ratingScores,
      },
    });
    const promoted = storage.promoteFull(runId);
    const finalRun = storage.getRun(runId);
    const sourceDiscrepancy =
      storage.getSourceDiscrepancyAttestation?.(runId) ?? null;
    return {
      propertyKey: property.key,
      outcome: "published",
      runId,
      querySha256: session.querySha256,
      structuredReviewCount: retrievableCount,
      advertisedReviewCount:
        sourceDiscrepancy?.advertisedReviewCount ??
        canary.reviewsCount,
      sourceDiscrepancy:
        publicSourceDiscrepancy(sourceDiscrepancy),
      inventoryPasses: 2,
      inventoryParity: "exact",
      inventoryIdentitySha256:
        inventoryAttestation.oldest_identity_sha256,
      publicationGeneration: promoted.publication.generation,
      inserted: finalRun.inserted_count,
      updated: finalRun.updated_count,
      unchanged: finalRun.unchanged_count,
      reactivated: finalRun.reactivated_count,
      suspectMissing: finalRun.suspect_missing_count,
      tombstoned: finalRun.tombstoned_count,
      metrics: metrics.snapshot(),
    };
  } catch (error) {
    safeFailRun(storage, runId, error);
    throw error;
  }
}

export async function executeIncrementalProperty({
  property: _property,
  session: _session,
  storage: _storage,
}) {
  throw new CollectionError(
    "INCREMENTAL_DISABLED",
    "Incremental publication is disabled for accuracy-first operation; rerun a complete full collection to update reviews",
  );
}

export const orchestratorInternals = Object.freeze({
  countEvidenceForStorage,
  publicSourceDiscrepancy,
  propertyForStorage,
  redactedErrorDetail,
});
