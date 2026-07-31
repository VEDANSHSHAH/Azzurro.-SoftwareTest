import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalizeReviewSourceCardForParity,
  PhotoUrlParityError,
} from "./photo-url-parity.mjs";
import {
  REVIEW_SCORE_RANGE_VALUES,
  reviewScoreMatchesRange,
} from "./live-template.mjs";
import {
  assertKnownSourceDiscrepancy,
  KNOWN_SOURCE_DISCREPANCY,
} from "./source-discrepancy.mjs";

export class StorageError extends Error {
  constructor(message, code = "STORAGE_ERROR", details = {}) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new StorageError(
      `${label} must be a non-empty string`,
      "INVALID_ARGUMENT",
    );
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new StorageError(
      `${label} must be a hexadecimal SHA-256 value`,
      "INVALID_ARGUMENT",
    );
  }
  return value.toLowerCase();
}

function canonicalValue(value, seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new StorageError(
        "Canonical JSON cannot contain a non-finite number",
        "INVALID_JSON_VALUE",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "undefined") {
    throw new StorageError(
      "Canonical JSON cannot contain undefined",
      "INVALID_JSON_VALUE",
    );
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new StorageError(
        "Canonical JSON cannot contain a cycle",
        "INVALID_JSON_VALUE",
      );
    }
    seen.add(value);
    const normalized = value.map((item) => canonicalValue(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new StorageError(
        "Canonical JSON only accepts plain objects",
        "INVALID_JSON_VALUE",
      );
    }
    if (seen.has(value)) {
      throw new StorageError(
        "Canonical JSON cannot contain a cycle",
        "INVALID_JSON_VALUE",
      );
    }
    seen.add(value);
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = canonicalValue(value[key], seen);
    }
    seen.delete(value);
    return normalized;
  }
  throw new StorageError(
    `Canonical JSON cannot contain ${typeof value}`,
    "INVALID_JSON_VALUE",
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

const TRUSTED_COUNT_TOTAL_SOURCES = Object.freeze([
  "reviewScoreFilter.ALL",
  "languageFilter.empty",
  "timeOfYearFilter.ALL",
  "customerTypeFilter.ALL",
]);

const REVIEW_SCORE_BUCKET_VALUES = Object.freeze([
  "REVIEW_ADJ_SUPERB",
  "REVIEW_ADJ_GOOD",
  "REVIEW_ADJ_AVERAGE_PASSABLE",
  "REVIEW_ADJ_POOR",
  "REVIEW_ADJ_VERY_POOR",
]);

function exactObjectKeys(value, expectedKeys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new StorageError(
      `${label} must be a plain object`,
      "INVALID_COUNT_EVIDENCE",
    );
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new StorageError(
      `${label} has an unexpected shape`,
      "INVALID_COUNT_EVIDENCE",
      { expectedKeys: expected, actualKeys: actual },
    );
  }
}

function countEvidenceInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StorageError(
      `${label} must be a non-negative safe integer`,
      "INVALID_COUNT_EVIDENCE",
    );
  }
  return value;
}

function normalizeCountEvidence(
  value,
  reportedReviewCount,
  { knownSourceDiscrepancy = false } = {},
) {
  exactObjectKeys(
    value,
    ["reviewsCount", "trustedTotals", "scoreBuckets"],
    "countEvidence",
  );
  const reviewsCount = countEvidenceInteger(
    value.reviewsCount,
    "countEvidence.reviewsCount",
  );
  if (reviewsCount !== reportedReviewCount) {
    throw new StorageError(
      "countEvidence.reviewsCount must match reportedReviewCount",
      "COUNT_EVIDENCE_MISMATCH",
      { reviewsCount, reportedReviewCount },
    );
  }
  let advertisedCount = knownSourceDiscrepancy
    ? null
    : reviewsCount;
  if (
    !Array.isArray(value.trustedTotals) ||
    value.trustedTotals.length !==
      TRUSTED_COUNT_TOTAL_SOURCES.length
  ) {
    throw new StorageError(
      "countEvidence.trustedTotals must contain four exact sources",
      "INVALID_COUNT_EVIDENCE",
    );
  }
  const trustedBySource = new Map();
  for (const [index, total] of value.trustedTotals.entries()) {
    exactObjectKeys(
      total,
      ["source", "count"],
      `countEvidence.trustedTotals[${index}]`,
    );
    if (
      typeof total.source !== "string" ||
      !TRUSTED_COUNT_TOTAL_SOURCES.includes(total.source) ||
      trustedBySource.has(total.source)
    ) {
      throw new StorageError(
        "countEvidence.trustedTotals contains an unknown or duplicate source",
        "INVALID_COUNT_EVIDENCE",
      );
    }
    const count = countEvidenceInteger(
      total.count,
      `countEvidence.trustedTotals[${index}].count`,
    );
    if (advertisedCount === null) advertisedCount = count;
    if (count !== advertisedCount) {
      throw new StorageError(
        "Every trusted total must equal the authoritative advertised count",
        "COUNT_EVIDENCE_MISMATCH",
        {
          source: total.source,
          count,
          reviewsCount,
          advertisedCount,
        },
      );
    }
    trustedBySource.set(total.source, count);
  }
  if (
    TRUSTED_COUNT_TOTAL_SOURCES.some(
      (source) => !trustedBySource.has(source),
    )
  ) {
    throw new StorageError(
      "countEvidence.trustedTotals is missing a required source",
      "INVALID_COUNT_EVIDENCE",
    );
  }
  if (
    knownSourceDiscrepancy &&
    (advertisedCount <
      KNOWN_SOURCE_DISCREPANCY.minimumAdvertisedReviewCount ||
      advertisedCount - reviewsCount !==
        KNOWN_SOURCE_DISCREPANCY.gapCount)
  ) {
    throw new StorageError(
      "Known source discrepancy must preserve its verified baseline and exactly one advertised-but-unretrievable review",
      "COUNT_EVIDENCE_MISMATCH",
      { advertisedCount, reviewsCount },
    );
  }

  if (
    !Array.isArray(value.scoreBuckets) ||
    value.scoreBuckets.length !== REVIEW_SCORE_BUCKET_VALUES.length
  ) {
    throw new StorageError(
      "countEvidence.scoreBuckets must contain five exact buckets",
      "INVALID_COUNT_EVIDENCE",
    );
  }
  const bucketByValue = new Map();
  let bucketSum = 0;
  for (const [index, bucket] of value.scoreBuckets.entries()) {
    exactObjectKeys(
      bucket,
      ["value", "count"],
      `countEvidence.scoreBuckets[${index}]`,
    );
    if (
      typeof bucket.value !== "string" ||
      !REVIEW_SCORE_BUCKET_VALUES.includes(bucket.value) ||
      bucketByValue.has(bucket.value)
    ) {
      throw new StorageError(
        "countEvidence.scoreBuckets contains an unknown or duplicate value",
        "INVALID_COUNT_EVIDENCE",
      );
    }
    const count = countEvidenceInteger(
      bucket.count,
      `countEvidence.scoreBuckets[${index}].count`,
    );
    bucketSum += count;
    if (!Number.isSafeInteger(bucketSum)) {
      throw new StorageError(
        "countEvidence.scoreBuckets sum exceeds the safe integer range",
        "INVALID_COUNT_EVIDENCE",
      );
    }
    bucketByValue.set(bucket.value, count);
  }
  if (
    REVIEW_SCORE_BUCKET_VALUES.some(
      (bucket) => !bucketByValue.has(bucket),
    )
  ) {
    throw new StorageError(
      "countEvidence.scoreBuckets is missing a required value",
      "INVALID_COUNT_EVIDENCE",
    );
  }
  if (bucketSum !== advertisedCount) {
    throw new StorageError(
      "countEvidence.scoreBuckets must sum exactly to the authoritative advertised count",
      "COUNT_EVIDENCE_MISMATCH",
      { bucketSum, reviewsCount, advertisedCount },
    );
  }
  if (
    knownSourceDiscrepancy &&
    bucketByValue.get(
      KNOWN_SOURCE_DISCREPANCY.targetScoreBucket,
    ) <
      KNOWN_SOURCE_DISCREPANCY.minimumAdvertisedTargetBucketCount
  ) {
    throw new StorageError(
      "Known source discrepancy advertised 5-7 bucket cannot fall below its verified baseline",
      "COUNT_EVIDENCE_MISMATCH",
    );
  }

  return {
    reviewsCount,
    trustedTotals: TRUSTED_COUNT_TOTAL_SOURCES.map((source) => ({
      source,
      count: trustedBySource.get(source),
    })),
    scoreBuckets: REVIEW_SCORE_BUCKET_VALUES.map((bucketValue) => ({
      value: bucketValue,
      count: bucketByValue.get(bucketValue),
    })),
  };
}

function nullableString(value, label) {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new StorageError(
      `${label} must be a string or null`,
      "INVALID_REVIEW",
    );
  }
  return value;
}

function nullableObject(value, label) {
  if (value == null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new StorageError(
      `${label} must be a plain object or null`,
      "INVALID_REVIEW",
    );
  }
  return value;
}

function nullableNonNegativeInteger(value, label) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new StorageError(
      `${label} must be a non-negative integer or null`,
      "INVALID_REVIEW",
    );
  }
  return value;
}

function nullableBoolean(value, label) {
  if (value == null) return null;
  if (typeof value !== "boolean") {
    throw new StorageError(
      `${label} must be a boolean or null`,
      "INVALID_REVIEW",
    );
  }
  return value;
}

function nullableTrivialFlag(value) {
  return nullableNonNegativeInteger(value, "textTrivialFlag");
}

function sydneyDate(epochSeconds, timeZone) {
  const date = new Date(epochSeconds * 1000);
  if (!Number.isFinite(date.getTime())) {
    throw new StorageError(
      "reviewedDateRaw is outside the supported date range",
      "INVALID_REVIEW",
    );
  }
  let parts;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
  } catch (error) {
    throw new StorageError(
      `Invalid property time zone: ${error.message}`,
      "INVALID_PROPERTY",
    );
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function scoreTenths(reviewScore) {
  if (
    typeof reviewScore !== "number" ||
    !Number.isFinite(reviewScore) ||
    reviewScore < 0 ||
    reviewScore > 10
  ) {
    throw new StorageError(
      "reviewScore must be a finite number from 0 to 10",
      "INVALID_REVIEW",
    );
  }
  const tenths = Math.round(reviewScore * 10);
  if (Math.abs(reviewScore * 10 - tenths) > 1e-9) {
    throw new StorageError(
      "reviewScore has unsupported precision",
      "INVALID_REVIEW",
    );
  }
  return tenths;
}

function parseSourceCard(review, normalized) {
  let sourceCard;
  if (review.sourceCard != null && review.sourceCardJson != null) {
    throw new StorageError(
      "Provide sourceCard or sourceCardJson, not both",
      "INVALID_REVIEW",
    );
  }
  if (review.sourceCardJson != null) {
    try {
      sourceCard = JSON.parse(review.sourceCardJson);
    } catch {
      throw new StorageError(
        "sourceCardJson must be valid JSON",
        "INVALID_REVIEW",
      );
    }
  } else if (review.sourceCard != null) {
    sourceCard = review.sourceCard;
  } else {
    sourceCard = {
      reviewUrl: normalized.sourceReviewToken,
      reviewedDate: normalized.reviewedDateRaw,
      reviewScore: normalized.reviewScore,
      textDetails: {
        title: normalized.title,
        positiveText: normalized.positiveText,
        negativeText: normalized.negativeText,
        lang: normalized.sourceLanguage,
        textTrivialFlag: normalized.textTrivialFlag,
      },
      partnerReply:
        normalized.partnerReply == null
          ? null
          : { reply: normalized.partnerReply },
      bookingDetails: normalized.bookingDetails,
      guestDetails: normalized.guestDetails,
      photos: normalized.photos,
      helpfulVotesCount: normalized.helpfulVotesCount,
      positiveHighlights: normalized.positiveHighlights,
      negativeHighlights: normalized.negativeHighlights,
      isApproved: normalized.isApproved,
      isTranslatable: normalized.isTranslatable,
      editUrl: normalized.editUrl,
    };
  }

  nullableObject(sourceCard, "sourceCard");
  let semanticSourceCard;
  try {
    semanticSourceCard =
      canonicalizeReviewSourceCardForParity(sourceCard);
  } catch (error) {
    if (!(error instanceof PhotoUrlParityError)) throw error;
    throw new StorageError(
      "sourceCard contains an invalid review photo URL",
      "INVALID_REVIEW",
      { cause: error.message },
    );
  }
  if (
    sourceCard.reviewUrl != null &&
    sourceCard.reviewUrl !== normalized.sourceReviewToken
  ) {
    throw new StorageError(
      "sourceCard.reviewUrl does not match sourceReviewToken",
      "REVIEW_ATTRIBUTION_MISMATCH",
    );
  }
  if (
    sourceCard.reviewedDate != null &&
    sourceCard.reviewedDate !== normalized.reviewedDateRaw
  ) {
    throw new StorageError(
      "sourceCard.reviewedDate does not match reviewedDateRaw",
      "REVIEW_ATTRIBUTION_MISMATCH",
    );
  }
  if (
    sourceCard.reviewScore != null &&
    sourceCard.reviewScore !== normalized.reviewScore
  ) {
    throw new StorageError(
      "sourceCard.reviewScore does not match reviewScore",
      "REVIEW_ATTRIBUTION_MISMATCH",
    );
  }

  const sourceText = sourceCard.textDetails ?? {};
  const normalizeSourceString = (value) =>
    value == null || value === "" ? null : value;
  const expectedFields = {
    title: normalized.title,
    positiveText: normalized.positiveText,
    negativeText: normalized.negativeText,
    sourceLanguage: normalized.sourceLanguage,
    textTrivialFlag: normalized.textTrivialFlag,
    partnerReply: normalized.partnerReply,
    bookingDetails: normalized.bookingDetails,
    guestDetails: normalized.guestDetails,
    photos: normalized.photos,
    helpfulVotesCount: normalized.helpfulVotesCount,
    positiveHighlights: normalized.positiveHighlights,
    negativeHighlights: normalized.negativeHighlights,
    isApproved: normalized.isApproved,
    isTranslatable: normalized.isTranslatable,
    editUrl: normalized.editUrl,
  };
  const actualFields = {
    title: normalizeSourceString(sourceText.title),
    positiveText: normalizeSourceString(sourceText.positiveText),
    negativeText: normalizeSourceString(sourceText.negativeText),
    sourceLanguage: normalizeSourceString(sourceText.lang),
    textTrivialFlag: sourceText.textTrivialFlag ?? null,
    partnerReply: normalizeSourceString(sourceCard.partnerReply?.reply),
    bookingDetails: sourceCard.bookingDetails ?? null,
    guestDetails: sourceCard.guestDetails ?? null,
    photos: semanticSourceCard.photos ?? [],
    helpfulVotesCount: sourceCard.helpfulVotesCount ?? null,
    positiveHighlights: sourceCard.positiveHighlights ?? [],
    negativeHighlights: sourceCard.negativeHighlights ?? [],
    isApproved: sourceCard.isApproved ?? null,
    isTranslatable: sourceCard.isTranslatable ?? null,
    editUrl: normalizeSourceString(sourceCard.editUrl),
  };
  if (canonicalJson(actualFields) !== canonicalJson(expectedFields)) {
    throw new StorageError(
      "Normalized review fields do not match the retained source card",
      "REVIEW_ATTRIBUTION_MISMATCH",
    );
  }
  return { sourceCard, semanticSourceCard };
}

function prepareReview(review, timeZone, observedAtUtc) {
  if (review == null || typeof review !== "object") {
    throw new StorageError(
      "Review must be an object",
      "INVALID_REVIEW",
    );
  }
  const sourceReviewToken = assertNonEmptyString(
    review.sourceReviewToken,
    "sourceReviewToken",
  );
  if (
    !Number.isInteger(review.reviewedDateRaw) ||
    review.reviewedDateRaw <= 0
  ) {
    throw new StorageError(
      "reviewedDateRaw must be a positive Unix timestamp",
      "INVALID_REVIEW",
    );
  }
  const reviewScore = review.reviewScore;
  const normalized = {
    sourceReviewToken,
    reviewedDateRaw: review.reviewedDateRaw,
    reviewScore,
    title: nullableString(review.title, "title"),
    positiveText: nullableString(review.positiveText, "positiveText"),
    negativeText: nullableString(review.negativeText, "negativeText"),
    sourceLanguage: nullableString(
      review.sourceLanguage,
      "sourceLanguage",
    ),
    partnerReply: nullableString(review.partnerReply, "partnerReply"),
    bookingDetails: nullableObject(
      review.bookingDetails,
      "bookingDetails",
    ),
    guestDetails: nullableObject(review.guestDetails, "guestDetails"),
    photos: review.photos ?? [],
    helpfulVotesCount: nullableNonNegativeInteger(
      review.helpfulVotesCount,
      "helpfulVotesCount",
    ),
    textTrivialFlag: nullableTrivialFlag(review.textTrivialFlag),
    positiveHighlights:
      review.positiveHighlights ?? review.highlights ?? [],
    negativeHighlights: review.negativeHighlights ?? [],
    isApproved: nullableBoolean(review.isApproved, "isApproved"),
    isTranslatable: nullableBoolean(
      review.isTranslatable,
      "isTranslatable",
    ),
    editUrl: nullableString(review.editUrl, "editUrl"),
  };
  if (!Array.isArray(normalized.photos)) {
    throw new StorageError(
      "photos must be an array",
      "INVALID_REVIEW",
    );
  }
  if (!Array.isArray(normalized.positiveHighlights)) {
    throw new StorageError(
      "positiveHighlights must be an array",
      "INVALID_REVIEW",
    );
  }
  if (!Array.isArray(normalized.negativeHighlights)) {
    throw new StorageError(
      "negativeHighlights must be an array",
      "INVALID_REVIEW",
    );
  }

  const { sourceCard, semanticSourceCard } = parseSourceCard(
    review,
    normalized,
  );
  const sourceCardJson = canonicalJson(sourceCard);
  const recordHash = sha256Hex(canonicalJson(semanticSourceCard));
  const contentHash = sha256Hex(
    canonicalJson({
      title: normalized.title,
      positiveText: normalized.positiveText,
      negativeText: normalized.negativeText,
      sourceLanguage: normalized.sourceLanguage,
      textTrivialFlag: normalized.textTrivialFlag,
      partnerReply: normalized.partnerReply,
      photos: normalized.photos,
      positiveHighlights: normalized.positiveHighlights,
      negativeHighlights: normalized.negativeHighlights,
    }),
  );
  if (
    review.recordHash != null &&
    assertSha256(review.recordHash, "recordHash") !== recordHash
  ) {
    throw new StorageError(
      "recordHash does not match the retained source card",
      "HASH_MISMATCH",
    );
  }
  if (
    review.contentHash != null &&
    assertSha256(review.contentHash, "contentHash") !== contentHash
  ) {
    throw new StorageError(
      "contentHash does not match the normalized review content",
      "HASH_MISMATCH",
    );
  }
  const reviewedAtUtc = new Date(
    normalized.reviewedDateRaw * 1000,
  ).toISOString();

  return {
    sourceReviewToken,
    reviewedEpoch: normalized.reviewedDateRaw,
    reviewedAtUtc,
    reviewedLocalDate: sydneyDate(
      normalized.reviewedDateRaw,
      timeZone,
    ),
    scoreTenths: scoreTenths(reviewScore),
    title: normalized.title,
    positiveText: normalized.positiveText,
    negativeText: normalized.negativeText,
    sourceLanguage: normalized.sourceLanguage,
    partnerReply: normalized.partnerReply,
    helpfulVotesCount: normalized.helpfulVotesCount,
    bookingDetailsJson:
      normalized.bookingDetails == null
        ? null
        : canonicalJson(normalized.bookingDetails),
    guestDetailsJson:
      normalized.guestDetails == null
        ? null
        : canonicalJson(normalized.guestDetails),
    photosJson: canonicalJson(normalized.photos),
    highlightsJson: canonicalJson({
      positive: normalized.positiveHighlights,
      negative: normalized.negativeHighlights,
    }),
    sourceCardJson,
    recordHash,
    contentHash,
    observedAtUtc,
  };
}

function rowCount(db, table, where, parameters = []) {
  const allowed = new Set([
    "review_stage",
    "scrape_pages",
    "reviews",
    "review_versions",
  ]);
  if (!allowed.has(table)) {
    throw new StorageError("Unsupported count table", "INTERNAL_ERROR");
  }
  return Number(
    db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(
      ...parameters,
    ).count,
  );
}

export class ReviewStorage {
  #db;
  #inTransaction = false;
  #faultInjector;

  constructor(filePath, { faultInjector = null } = {}) {
    assertNonEmptyString(filePath, "filePath");
    if (faultInjector != null && typeof faultInjector !== "function") {
      throw new StorageError(
        "faultInjector must be a function or null",
        "INVALID_ARGUMENT",
      );
    }
    this.#faultInjector = faultInjector;
    this.#db = new DatabaseSync(filePath);
    this.#db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 10000;
      PRAGMA trusted_schema = OFF;
    `);
    this.#migrate();
  }

  #migrate() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS properties (
        property_id       INTEGER PRIMARY KEY,
        property_key      TEXT NOT NULL UNIQUE,
        booking_hotel_id  INTEGER NOT NULL UNIQUE
                          CHECK (booking_hotel_id > 0),
        canonical_url     TEXT NOT NULL,
        business_name     TEXT NOT NULL,
        booking_name      TEXT,
        country_code      TEXT NOT NULL,
        time_zone         TEXT NOT NULL,
        enabled           INTEGER NOT NULL DEFAULT 1
                          CHECK (enabled IN (0, 1)),
        created_at_utc    TEXT NOT NULL,
        updated_at_utc    TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS scrape_runs (
        run_id                    TEXT PRIMARY KEY,
        property_id               INTEGER NOT NULL
                                  REFERENCES properties(property_id),
        mode                      TEXT NOT NULL CHECK (
          mode IN ('full', 'incremental', 'reconcile', 'canary')
        ),
        status                    TEXT NOT NULL CHECK (
          status IN (
            'collecting', 'ready', 'succeeded', 'failed',
            'superseded', 'abandoned'
          )
        ),
        base_publication_run_id   TEXT REFERENCES scrape_runs(run_id),
        complete_inventory        INTEGER NOT NULL DEFAULT 0
                                  CHECK (complete_inventory IN (0, 1)),
        query_sha256              TEXT NOT NULL
                                  CHECK (length(query_sha256) = 64),
        parser_version            TEXT NOT NULL,
        schema_version            INTEGER NOT NULL,
        source_count_final        INTEGER
                                  CHECK (source_count_final >= 0),
        staged_unique_count       INTEGER NOT NULL DEFAULT 0,
        duplicate_occurrences     INTEGER NOT NULL DEFAULT 0,
        pages_succeeded           INTEGER NOT NULL DEFAULT 0,
        requests_total            INTEGER NOT NULL DEFAULT 0,
        retries_total             INTEGER NOT NULL DEFAULT 0,
        latency_total_ms          INTEGER NOT NULL DEFAULT 0,
        bytes_received            INTEGER NOT NULL DEFAULT 0,
        inserted_count            INTEGER NOT NULL DEFAULT 0,
        updated_count             INTEGER NOT NULL DEFAULT 0,
        unchanged_count           INTEGER NOT NULL DEFAULT 0,
        reactivated_count         INTEGER NOT NULL DEFAULT 0,
        suspect_missing_count     INTEGER NOT NULL DEFAULT 0,
        tombstoned_count          INTEGER NOT NULL DEFAULT 0,
        started_at_utc            TEXT NOT NULL,
        ready_at_utc              TEXT,
        published_at_utc          TEXT,
        finished_at_utc           TEXT,
        error_code                TEXT,
        error_detail_redacted     TEXT,
        UNIQUE (run_id, property_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS scrape_phases (
        run_id                 TEXT NOT NULL REFERENCES scrape_runs(run_id),
        phase_key              TEXT NOT NULL,
        sorter                 TEXT NOT NULL,
        filters_json           TEXT NOT NULL CHECK (json_valid(filters_json)),
        filters_sha256         TEXT NOT NULL
                               CHECK (length(filters_sha256) = 64),
        status                 TEXT NOT NULL
                               CHECK (status IN ('running', 'succeeded')),
        next_offset            INTEGER NOT NULL DEFAULT 0
                               CHECK (next_offset >= 0),
        last_committed_offset  INTEGER,
        expected_count_end     INTEGER CHECK (expected_count_end >= 0),
        stop_reason            TEXT,
        updated_at_utc         TEXT NOT NULL,
        PRIMARY KEY (run_id, phase_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS scrape_pages (
        page_id                INTEGER PRIMARY KEY,
        run_id                 TEXT NOT NULL REFERENCES scrape_runs(run_id),
        phase_key              TEXT NOT NULL,
        source_offset          INTEGER NOT NULL CHECK (source_offset >= 0),
        requested_limit        INTEGER NOT NULL
                               CHECK (requested_limit BETWEEN 1 AND 10),
        reported_review_count  INTEGER NOT NULL
                               CHECK (reported_review_count >= 0),
        returned_card_count    INTEGER NOT NULL
                               CHECK (returned_card_count >= 0),
        ordered_tokens_sha256  TEXT NOT NULL
                               CHECK (length(ordered_tokens_sha256) = 64),
        response_sha256        TEXT NOT NULL
                               CHECK (length(response_sha256) = 64),
        attempt_count          INTEGER NOT NULL DEFAULT 1
                               CHECK (attempt_count > 0),
        latency_ms             INTEGER CHECK (latency_ms >= 0),
        response_bytes         INTEGER CHECK (response_bytes >= 0),
        committed_at_utc       TEXT NOT NULL,
        UNIQUE (run_id, phase_key, source_offset),
        UNIQUE (page_id, run_id),
        FOREIGN KEY (run_id, phase_key)
          REFERENCES scrape_phases(run_id, phase_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS scrape_page_count_evidence (
        page_id                 INTEGER PRIMARY KEY,
        run_id                  TEXT NOT NULL,
        contract_version        INTEGER NOT NULL
                                CHECK (contract_version = 1),
        evidence_json           TEXT NOT NULL CHECK (json_valid(evidence_json)),
        evidence_sha256         TEXT NOT NULL
                                CHECK (length(evidence_sha256) = 64),
        committed_at_utc        TEXT NOT NULL,
        FOREIGN KEY (page_id, run_id)
          REFERENCES scrape_pages(page_id, run_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS review_stage (
        run_id                  TEXT NOT NULL,
        property_id             INTEGER NOT NULL,
        source_review_token     TEXT NOT NULL,
        reviewed_epoch          INTEGER NOT NULL CHECK (reviewed_epoch > 0),
        reviewed_at_utc         TEXT NOT NULL,
        reviewed_local_date     TEXT NOT NULL,
        score_tenths            INTEGER NOT NULL
                                CHECK (score_tenths BETWEEN 0 AND 100),
        title                   TEXT,
        positive_text           TEXT,
        negative_text           TEXT,
        source_language         TEXT,
        partner_reply           TEXT,
        helpful_votes_count     INTEGER
                                CHECK (helpful_votes_count >= 0),
        booking_details_json    TEXT CHECK (
          booking_details_json IS NULL OR json_valid(booking_details_json)
        ),
        guest_details_json      TEXT CHECK (
          guest_details_json IS NULL OR json_valid(guest_details_json)
        ),
        photos_json             TEXT NOT NULL CHECK (json_valid(photos_json)),
        highlights_json         TEXT CHECK (
          highlights_json IS NULL OR json_valid(highlights_json)
        ),
        source_card_json        TEXT NOT NULL
                                CHECK (json_valid(source_card_json)),
        record_hash             TEXT NOT NULL CHECK (length(record_hash) = 64),
        content_hash            TEXT NOT NULL
                                CHECK (length(content_hash) = 64),
        first_observed_at_utc   TEXT NOT NULL,
        last_observed_at_utc    TEXT NOT NULL,
        occurrence_count        INTEGER NOT NULL DEFAULT 1
                                CHECK (occurrence_count > 0),
        PRIMARY KEY (run_id, source_review_token),
        FOREIGN KEY (run_id, property_id)
          REFERENCES scrape_runs(run_id, property_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS scrape_page_reviews (
        page_id                 INTEGER NOT NULL,
        run_id                  TEXT NOT NULL,
        card_index              INTEGER NOT NULL CHECK (card_index >= 0),
        source_review_token     TEXT NOT NULL,
        record_hash             TEXT NOT NULL CHECK (length(record_hash) = 64),
        PRIMARY KEY (page_id, card_index),
        FOREIGN KEY (page_id, run_id)
          REFERENCES scrape_pages(page_id, run_id),
        FOREIGN KEY (run_id, source_review_token)
          REFERENCES review_stage(run_id, source_review_token)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS reviews (
        review_id                       INTEGER PRIMARY KEY,
        property_id                     INTEGER NOT NULL
                                        REFERENCES properties(property_id),
        source_review_token             TEXT NOT NULL,
        first_seen_at_utc               TEXT NOT NULL,
        first_seen_run_id               TEXT NOT NULL
                                        REFERENCES scrape_runs(run_id),
        last_seen_at_utc                TEXT NOT NULL,
        last_seen_run_id                TEXT NOT NULL
                                        REFERENCES scrape_runs(run_id),
        last_complete_seen_run_id       TEXT REFERENCES scrape_runs(run_id),
        presence_state                  TEXT NOT NULL CHECK (
          presence_state IN ('present', 'suspect_missing', 'tombstoned')
        ),
        consecutive_missing_full_scans INTEGER NOT NULL DEFAULT 0
                                        CHECK (
                                          consecutive_missing_full_scans >= 0
                                        ),
        suspect_missing_since_utc       TEXT,
        suspect_missing_run_id          TEXT REFERENCES scrape_runs(run_id),
        tombstoned_at_utc               TEXT,
        tombstoned_run_id               TEXT REFERENCES scrape_runs(run_id),
        reactivation_count              INTEGER NOT NULL DEFAULT 0,
        UNIQUE (property_id, source_review_token)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS review_versions (
        version_id             INTEGER PRIMARY KEY,
        review_id              INTEGER NOT NULL REFERENCES reviews(review_id),
        version_number         INTEGER NOT NULL CHECK (version_number > 0),
        is_current             INTEGER NOT NULL CHECK (is_current IN (0, 1)),
        record_hash            TEXT NOT NULL CHECK (length(record_hash) = 64),
        content_hash           TEXT NOT NULL CHECK (length(content_hash) = 64),
        reviewed_epoch         INTEGER NOT NULL,
        reviewed_at_utc        TEXT NOT NULL,
        reviewed_local_date    TEXT NOT NULL,
        score_tenths           INTEGER NOT NULL
                               CHECK (score_tenths BETWEEN 0 AND 100),
        title                  TEXT,
        positive_text          TEXT,
        negative_text          TEXT,
        source_language        TEXT,
        partner_reply          TEXT,
        helpful_votes_count    INTEGER,
        booking_details_json   TEXT,
        guest_details_json     TEXT,
        photos_json            TEXT NOT NULL CHECK (json_valid(photos_json)),
        highlights_json        TEXT,
        source_card_json       TEXT NOT NULL CHECK (json_valid(source_card_json)),
        first_observed_at_utc  TEXT NOT NULL,
        last_observed_at_utc   TEXT NOT NULL,
        first_observed_run_id  TEXT NOT NULL REFERENCES scrape_runs(run_id),
        last_observed_run_id   TEXT NOT NULL REFERENCES scrape_runs(run_id),
        superseded_at_utc      TEXT,
        superseded_by_run_id   TEXT REFERENCES scrape_runs(run_id),
        UNIQUE (review_id, version_number)
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS one_current_version_per_review
      ON review_versions(review_id)
      WHERE is_current = 1;

      CREATE INDEX IF NOT EXISTS current_property_presence
      ON reviews(property_id, presence_state);

      CREATE INDEX IF NOT EXISTS current_review_local_date
      ON review_versions(reviewed_local_date, review_id)
      WHERE is_current = 1;

      CREATE TABLE IF NOT EXISTS property_publications (
        property_id                 INTEGER PRIMARY KEY
                                    REFERENCES properties(property_id),
        last_successful_run_id      TEXT NOT NULL REFERENCES scrape_runs(run_id),
        last_successful_full_run_id TEXT REFERENCES scrape_runs(run_id),
        generation                  INTEGER NOT NULL CHECK (generation > 0),
        published_at_utc            TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS property_snapshots (
        snapshot_id              INTEGER PRIMARY KEY,
        run_id                   TEXT NOT NULL UNIQUE
                                 REFERENCES scrape_runs(run_id),
        property_id              INTEGER NOT NULL
                                 REFERENCES properties(property_id),
        captured_at_utc          TEXT NOT NULL,
        is_unfiltered            INTEGER NOT NULL CHECK (is_unfiltered = 1),
        structured_review_count  INTEGER NOT NULL
                                 CHECK (structured_review_count >= 0),
        displayed_score_tenths   INTEGER
                                 CHECK (
                                   displayed_score_tenths BETWEEN 0 AND 100
                                 ),
        displayed_review_count   INTEGER
                                 CHECK (displayed_review_count >= 0),
        rating_scores_json       TEXT CHECK (
          rating_scores_json IS NULL OR json_valid(rating_scores_json)
        ),
        query_sha256             TEXT NOT NULL
                                 CHECK (length(query_sha256) = 64)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS full_inventory_attestations (
        run_id                       TEXT PRIMARY KEY
                                     REFERENCES scrape_runs(run_id),
        contract_version             INTEGER NOT NULL
                                     CHECK (contract_version = 1),
        expected_count               INTEGER NOT NULL
                                     CHECK (expected_count >= 0),
        oldest_unique_count          INTEGER NOT NULL
                                     CHECK (oldest_unique_count >= 0),
        newest_unique_count          INTEGER NOT NULL
                                     CHECK (newest_unique_count >= 0),
        oldest_identity_sha256       TEXT NOT NULL
                                     CHECK (
                                       length(oldest_identity_sha256) = 64
                                     ),
        newest_identity_sha256       TEXT NOT NULL
                                     CHECK (
                                       length(newest_identity_sha256) = 64
                                     ),
        oldest_records_sha256        TEXT NOT NULL
                                     CHECK (
                                       length(oldest_records_sha256) = 64
                                     ),
        newest_records_sha256        TEXT NOT NULL
                                     CHECK (
                                       length(newest_records_sha256) = 64
                                     ),
        oldest_terminal_offset       INTEGER NOT NULL
                                     CHECK (oldest_terminal_offset >= 0),
        newest_terminal_offset       INTEGER NOT NULL
                                     CHECK (newest_terminal_offset >= 0),
        final_head_response_sha256   TEXT NOT NULL
                                     CHECK (
                                       length(final_head_response_sha256) = 64
                                     ),
        attested_at_utc              TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS full_count_attestations (
        run_id                    TEXT PRIMARY KEY
                                  REFERENCES scrape_runs(run_id),
        contract_version          INTEGER NOT NULL
                                  CHECK (contract_version = 1),
        expected_count            INTEGER NOT NULL
                                  CHECK (expected_count >= 0),
        count_evidence_sha256     TEXT NOT NULL
                                  CHECK (length(count_evidence_sha256) = 64),
        authoritative_page_count  INTEGER NOT NULL
                                  CHECK (authoritative_page_count > 0),
        attested_at_utc           TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS source_discrepancy_attestations (
        run_id                         TEXT PRIMARY KEY
                                       REFERENCES scrape_runs(run_id),
        contract_version               INTEGER NOT NULL
                                       CHECK (contract_version = 1),
        contract_kind                  TEXT NOT NULL,
        property_key                   TEXT NOT NULL,
        booking_hotel_id               INTEGER NOT NULL
                                       CHECK (booking_hotel_id > 0),
        advertised_review_count        INTEGER NOT NULL
                                       CHECK (advertised_review_count >= 0),
        retrievable_review_count       INTEGER NOT NULL
                                       CHECK (retrievable_review_count >= 0),
        gap_count                      INTEGER NOT NULL
                                       CHECK (gap_count > 0),
        score_bucket                   TEXT NOT NULL,
        advertised_bucket_count        INTEGER NOT NULL
                                       CHECK (advertised_bucket_count >= 0),
        retrievable_bucket_count       INTEGER NOT NULL
                                       CHECK (retrievable_bucket_count >= 0),
        advertised_score_buckets_json  TEXT NOT NULL
                                       CHECK (
                                         json_valid(
                                           advertised_score_buckets_json
                                         )
                                       ),
        retrievable_score_buckets_json TEXT NOT NULL
                                       CHECK (
                                         json_valid(
                                           retrievable_score_buckets_json
                                         )
                                       ),
        count_evidence_sha256           TEXT NOT NULL
                                       CHECK (
                                         length(count_evidence_sha256) = 64
                                       ),
        attested_at_utc                 TEXT NOT NULL
      ) STRICT;
    `);
  }

  #fault(point) {
    this.#faultInjector?.(point);
  }

  #transaction(work) {
    if (this.#inTransaction) {
      throw new StorageError(
        "Re-entrant writes are not allowed",
        "REENTRANT_WRITE",
      );
    }
    this.#inTransaction = true;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        // Preserve the original error.
      }
      throw error;
    } finally {
      this.#inTransaction = false;
    }
  }

  close() {
    this.#db.close();
  }

  registerProperty(property) {
    const propertyKey = assertNonEmptyString(
      property.propertyKey,
      "propertyKey",
    );
    if (
      !Number.isInteger(property.bookingHotelId) ||
      property.bookingHotelId <= 0
    ) {
      throw new StorageError(
        "bookingHotelId must be a positive integer",
        "INVALID_PROPERTY",
      );
    }
    for (const field of [
      "canonicalUrl",
      "businessName",
      "countryCode",
      "timeZone",
    ]) {
      assertNonEmptyString(property[field], field);
    }
    const timestamp = nowIso();
    return this.#transaction(() => {
      const existing = this.#db
        .prepare(
          `SELECT *
             FROM properties
            WHERE property_key = ? OR booking_hotel_id = ?`,
        )
        .all(propertyKey, property.bookingHotelId);
      if (
        existing.length > 0 &&
        existing.some(
          (row) =>
            row.property_key !== propertyKey ||
            row.booking_hotel_id !== property.bookingHotelId,
        )
      ) {
        throw new StorageError(
          "Property key or Booking hotel ID belongs to another property",
          "PROPERTY_IDENTITY_CONFLICT",
        );
      }
      this.#db
        .prepare(
          `INSERT INTO properties (
             property_key, booking_hotel_id, canonical_url,
             business_name, booking_name, country_code, time_zone,
             enabled, created_at_utc, updated_at_utc
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(property_key) DO UPDATE SET
             canonical_url = excluded.canonical_url,
             business_name = excluded.business_name,
             booking_name = excluded.booking_name,
             country_code = excluded.country_code,
             time_zone = excluded.time_zone,
             updated_at_utc = excluded.updated_at_utc`,
        )
        .run(
          propertyKey,
          property.bookingHotelId,
          property.canonicalUrl,
          property.businessName,
          property.bookingName ?? null,
          property.countryCode,
          property.timeZone,
          timestamp,
          timestamp,
        );
      return this.getProperty(propertyKey);
    });
  }

  getProperty(propertyKey) {
    return (
      this.#db
        .prepare("SELECT * FROM properties WHERE property_key = ?")
        .get(propertyKey) ?? null
    );
  }

  createRun({
    runId = randomUUID(),
    propertyKey,
    mode,
    querySha256,
    parserVersion,
    schemaVersion = 1,
    basePublicationRunId,
  }) {
    assertNonEmptyString(runId, "runId");
    if (!["full", "incremental", "reconcile", "canary"].includes(mode)) {
      throw new StorageError("Unsupported run mode", "INVALID_ARGUMENT");
    }
    assertSha256(querySha256, "querySha256");
    assertNonEmptyString(parserVersion, "parserVersion");
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw new StorageError(
        "schemaVersion must be a positive integer",
        "INVALID_ARGUMENT",
      );
    }
    return this.#transaction(() => {
      const property = this.getProperty(propertyKey);
      if (!property) {
        throw new StorageError(
          `Unknown property: ${propertyKey}`,
          "PROPERTY_NOT_FOUND",
        );
      }
      const publication = this.#db
        .prepare(
          `SELECT last_successful_run_id
             FROM property_publications
            WHERE property_id = ?`,
        )
        .get(property.property_id);
      const base =
        basePublicationRunId === undefined
          ? publication?.last_successful_run_id ?? null
          : basePublicationRunId;
      this.#db
        .prepare(
          `INSERT INTO scrape_runs (
             run_id, property_id, mode, status,
             base_publication_run_id, complete_inventory,
             query_sha256, parser_version, schema_version, started_at_utc
           ) VALUES (?, ?, ?, 'collecting', ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          property.property_id,
          mode,
          base,
          querySha256.toLowerCase(),
          parserVersion,
          schemaVersion,
          nowIso(),
        );
      return this.getRun(runId);
    });
  }

  beginRun(options) {
    return this.createRun(options);
  }

  createPhase({
    runId,
    phaseKey,
    sorter,
    filters = { text: "" },
  }) {
    assertNonEmptyString(phaseKey, "phaseKey");
    assertNonEmptyString(sorter, "sorter");
    const filtersJson = canonicalJson(filters);
    const filtersHash = sha256Hex(filtersJson);
    return this.#transaction(() => {
      const run = this.#requireCollectingRun(runId);
      const existing = this.#db
        .prepare(
          `SELECT *
             FROM scrape_phases
            WHERE run_id = ? AND phase_key = ?`,
        )
        .get(runId, phaseKey);
      if (existing) {
        if (
          existing.sorter !== sorter ||
          existing.filters_sha256 !== filtersHash
        ) {
          throw new StorageError(
            "Phase key was reused with a different contract",
            "PHASE_CONFLICT",
          );
        }
        return existing;
      }
      this.#db
        .prepare(
          `INSERT INTO scrape_phases (
             run_id, phase_key, sorter, filters_json, filters_sha256,
             status, next_offset, updated_at_utc
           ) VALUES (?, ?, ?, ?, ?, 'running', 0, ?)`,
        )
        .run(
          run.run_id,
          phaseKey,
          sorter,
          filtersJson,
          filtersHash,
          nowIso(),
        );
      return this.getPhase(runId, phaseKey);
    });
  }

  beginPhase(options) {
    return this.createPhase(options);
  }

  #requireCollectingRun(runId) {
    const run = this.getRun(runId);
    if (!run) {
      throw new StorageError("Run was not found", "RUN_NOT_FOUND");
    }
    if (run.status !== "collecting") {
      throw new StorageError(
        `Run is ${run.status}, not collecting`,
        "RUN_NOT_COLLECTING",
      );
    }
    return run;
  }

  #fullContractError(message, details = {}) {
    throw new StorageError(
      message,
      "FULL_PUBLICATION_CONTRACT",
      details,
    );
  }

  #phasePages(runId, phaseKey) {
    return this.#db
      .prepare(
        `SELECT *
           FROM scrape_pages
          WHERE run_id = ? AND phase_key = ?
          ORDER BY source_offset`,
      )
      .all(runId, phaseKey);
  }

  #inventoryPhaseEvidence({
    runId,
    phaseKey,
    sorter,
    retrievableCount,
    reportedCount,
  }) {
    const phase = this.getPhase(runId, phaseKey);
    const expectedFiltersJson = canonicalJson({ text: "" });
    if (!phase) {
      this.#fullContractError(
        `Required phase ${phaseKey} is missing`,
        { phaseKey },
      );
    }
    if (
      phase.status !== "succeeded" ||
      phase.sorter !== sorter ||
      phase.filters_json !== expectedFiltersJson ||
      phase.expected_count_end !== retrievableCount ||
      phase.stop_reason !== "stable_after_end"
    ) {
      this.#fullContractError(
        `Phase ${phaseKey} does not match the full inventory contract`,
        {
          phaseKey,
          status: phase.status,
          sorter: phase.sorter,
          expectedSorter: sorter,
          expectedCountEnd: phase.expected_count_end,
          retrievableCount,
          stopReason: phase.stop_reason,
        },
      );
    }

    const dataPageCount = Math.ceil(retrievableCount / 10);
    const terminalOffset = dataPageCount * 10;
    const pages = this.#phasePages(runId, phaseKey);
    if (pages.length !== dataPageCount + 1) {
      this.#fullContractError(
        `Phase ${phaseKey} does not contain every data page and one terminal page`,
        {
          phaseKey,
          expectedPages: dataPageCount + 1,
          actualPages: pages.length,
        },
      );
    }
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const expectedOffset = index * 10;
      const terminal = index === dataPageCount;
      const expectedCards = terminal
        ? 0
        : Math.min(10, retrievableCount - expectedOffset);
      if (
        page.source_offset !== expectedOffset ||
        page.requested_limit !== 10 ||
        page.reported_review_count !== reportedCount ||
        page.returned_card_count !== expectedCards
      ) {
        this.#fullContractError(
          `Phase ${phaseKey} has invalid page evidence`,
          {
            phaseKey,
            sourceOffset: page.source_offset,
            expectedOffset,
            requestedLimit: page.requested_limit,
            reportedReviewCount: page.reported_review_count,
            reportedCount,
            retrievableCount,
            returnedCardCount: page.returned_card_count,
            expectedCards,
            terminal,
          },
        );
      }
    }
    if (
      phase.last_committed_offset !== terminalOffset ||
      phase.next_offset !== terminalOffset + 10
    ) {
      this.#fullContractError(
        `Phase ${phaseKey} checkpoint does not end after its terminal page`,
        {
          phaseKey,
          lastCommittedOffset: phase.last_committed_offset,
          nextOffset: phase.next_offset,
          terminalOffset,
        },
      );
    }

    const rows = this.#db
      .prepare(
        `SELECT pr.source_review_token, pr.record_hash
           FROM scrape_page_reviews pr
           JOIN scrape_pages p
             ON p.page_id = pr.page_id AND p.run_id = pr.run_id
          WHERE p.run_id = ? AND p.phase_key = ?
          ORDER BY pr.source_review_token`,
      )
      .all(runId, phaseKey);
    const uniqueTokens = new Set(
      rows.map((row) => row.source_review_token),
    );
    if (
      rows.length !== retrievableCount ||
      uniqueTokens.size !== retrievableCount
    ) {
      this.#fullContractError(
        `Phase ${phaseKey} does not contain exactly one occurrence of every review`,
        {
          phaseKey,
          recordOccurrences: rows.length,
          uniqueCount: uniqueTokens.size,
          retrievableCount,
        },
      );
    }

    return {
      uniqueCount: uniqueTokens.size,
      identitySha256: sha256Hex(
        canonicalJson(rows.map((row) => row.source_review_token)),
      ),
      recordsSha256: sha256Hex(
        canonicalJson(
          rows.map((row) => [
            row.source_review_token,
            row.record_hash,
          ]),
        ),
      ),
      terminalOffset,
      firstPage: pages[0],
    };
  }

  #finalHeadEvidence({
    runId,
    retrievableCount,
    reportedCount,
  }) {
    const phaseKey = "final_head";
    const phase = this.getPhase(runId, phaseKey);
    const expectedFiltersJson = canonicalJson({ text: "" });
    if (!phase) {
      this.#fullContractError(
        "Required phase final_head is missing",
        { phaseKey },
      );
    }
    if (
      phase.status !== "succeeded" ||
      phase.sorter !== "NEWEST_FIRST" ||
      phase.filters_json !== expectedFiltersJson ||
      phase.expected_count_end !== retrievableCount ||
      phase.stop_reason !== "stable_final_head"
    ) {
      this.#fullContractError(
        "Phase final_head does not match the full publication contract",
        {
          status: phase.status,
          sorter: phase.sorter,
          expectedCountEnd: phase.expected_count_end,
          retrievableCount,
          stopReason: phase.stop_reason,
        },
      );
    }
    const pages = this.#phasePages(runId, phaseKey);
    const expectedCards = Math.min(10, retrievableCount);
    const page = pages[0];
    if (
      pages.length !== 1 ||
      page?.source_offset !== 0 ||
      page?.requested_limit !== 10 ||
      page?.reported_review_count !== reportedCount ||
      page?.returned_card_count !== expectedCards ||
      phase.last_committed_offset !== 0 ||
      phase.next_offset !== 10
    ) {
      this.#fullContractError(
        "Phase final_head does not contain exactly one valid head page",
        {
          pageCount: pages.length,
          sourceOffset: page?.source_offset ?? null,
          requestedLimit: page?.requested_limit ?? null,
          reportedReviewCount:
            page?.reported_review_count ?? null,
          returnedCardCount: page?.returned_card_count ?? null,
          expectedCards,
          reportedCount,
          retrievableCount,
        },
      );
    }
    return { responseSha256: page.response_sha256 };
  }

  #buildFullCountAttestationEvidence(
    runId,
    {
      retrievableCount,
      reportedCount,
      contractKind,
    },
  ) {
    const dataPageCount = Math.ceil(retrievableCount / 10);
    const expectedPhasePageCounts = new Map([
      ["inventory_oldest", dataPageCount + 1],
      ["inventory_newest", dataPageCount + 1],
      ["final_head", 1],
    ]);
    const rows = this.#db
      .prepare(
        `SELECT
           p.page_id,
           p.phase_key,
           p.source_offset,
           p.reported_review_count,
           e.contract_version,
           e.evidence_json,
           e.evidence_sha256
         FROM scrape_pages p
         LEFT JOIN scrape_page_count_evidence e
           ON e.page_id = p.page_id AND e.run_id = p.run_id
        WHERE p.run_id = ?
          AND p.phase_key IN (
            'inventory_oldest', 'inventory_newest', 'final_head'
          )
        ORDER BY p.phase_key, p.source_offset`,
      )
      .all(runId);
    const expectedPageCount =
      (dataPageCount + 1) * 2 + 1;
    if (rows.length !== expectedPageCount) {
      throw new StorageError(
        "Authoritative phases do not contain the expected count-evidence pages",
        "FULL_COUNT_EVIDENCE_MISMATCH",
        { expectedPageCount, actualPageCount: rows.length },
      );
    }
    for (const [phaseKey, expectedPages] of expectedPhasePageCounts) {
      const actualPages = rows.filter(
        (row) => row.phase_key === phaseKey,
      ).length;
      if (actualPages !== expectedPages) {
        throw new StorageError(
          `Phase ${phaseKey} has incomplete count evidence`,
          "FULL_COUNT_EVIDENCE_MISMATCH",
          { phaseKey, expectedPages, actualPages },
        );
      }
    }

    const evidenceHashes = new Set();
    for (const row of rows) {
      if (
        row.contract_version !== 1 ||
        typeof row.evidence_json !== "string" ||
        typeof row.evidence_sha256 !== "string"
      ) {
        throw new StorageError(
          "An authoritative page is missing count evidence",
          "FULL_COUNT_EVIDENCE_MISSING",
          {
            phaseKey: row.phase_key,
            sourceOffset: row.source_offset,
          },
        );
      }
      let parsed;
      try {
        parsed = JSON.parse(row.evidence_json);
      } catch {
        throw new StorageError(
          "Persisted page count evidence is not valid JSON",
          "FULL_COUNT_EVIDENCE_MISMATCH",
        );
      }
      let normalized;
      try {
        normalized = normalizeCountEvidence(
          parsed,
          row.reported_review_count,
          {
            knownSourceDiscrepancy: contractKind !== null,
          },
        );
      } catch (error) {
        if (error instanceof StorageError) {
          throw new StorageError(
            "Persisted page count evidence failed validation",
            "FULL_COUNT_EVIDENCE_MISMATCH",
            {
              phaseKey: row.phase_key,
              sourceOffset: row.source_offset,
              causeCode: error.code,
            },
          );
        }
        throw error;
      }
      const evidenceJson = canonicalJson(normalized);
      const evidenceSha256 = sha256Hex(evidenceJson);
      if (
        row.evidence_json !== evidenceJson ||
        row.evidence_sha256 !== evidenceSha256 ||
        normalized.reviewsCount !== reportedCount
      ) {
        throw new StorageError(
          "Persisted page count evidence no longer matches its canonical data",
          "FULL_COUNT_EVIDENCE_MISMATCH",
          {
            phaseKey: row.phase_key,
            sourceOffset: row.source_offset,
          },
        );
      }
      evidenceHashes.add(evidenceSha256);
    }
    if (evidenceHashes.size !== 1) {
      throw new StorageError(
        "Authoritative pages do not share one count-evidence hash",
        "FULL_COUNT_EVIDENCE_MISMATCH",
        { distinctEvidenceHashes: evidenceHashes.size },
      );
    }
    return {
      contractVersion: 1,
      expectedCount: reportedCount,
      countEvidenceSha256: [...evidenceHashes][0],
      authoritativePageCount: rows.length,
    };
  }

  #sourceDiscrepancyCounts(
    runId,
    retrievableCount,
    sourceDiscrepancy,
  ) {
    if (sourceDiscrepancy == null) {
      return {
        retrievableCount,
        reportedCount: retrievableCount,
        advertisedCount: retrievableCount,
        contractKind: null,
      };
    }
    const identity = this.#db
      .prepare(
        `SELECT p.property_key, p.booking_hotel_id
           FROM scrape_runs r
           JOIN properties p ON p.property_id = r.property_id
          WHERE r.run_id = ?`,
      )
      .get(runId);
    if (!identity) {
      throw new StorageError("Run was not found", "RUN_NOT_FOUND");
    }
    const contract = KNOWN_SOURCE_DISCREPANCY;
    const advertisedCount =
      sourceDiscrepancy.advertisedReviewCount;
    const attestedRetrievableCount =
      sourceDiscrepancy.retrievableReviewCount;
    if (
      identity.property_key !== contract.propertyKey ||
      identity.booking_hotel_id !== contract.bookingHotelId ||
      sourceDiscrepancy.propertyKey !== contract.propertyKey ||
      sourceDiscrepancy.bookingHotelId !== contract.bookingHotelId ||
      sourceDiscrepancy.contractKind !== contract.contractKind ||
      !Number.isSafeInteger(advertisedCount) ||
      !Number.isSafeInteger(attestedRetrievableCount) ||
      advertisedCount < contract.minimumAdvertisedReviewCount ||
      advertisedCount - attestedRetrievableCount !==
        contract.gapCount ||
      retrievableCount !== attestedRetrievableCount
    ) {
      throw new StorageError(
        "The requested source discrepancy does not match the exact known contract",
        "SOURCE_DISCREPANCY_MISMATCH",
        {
          propertyKey: identity.property_key,
          bookingHotelId: identity.booking_hotel_id,
          contractKind: sourceDiscrepancy.contractKind ?? null,
          retrievableCount,
        },
      );
    }
    return {
      retrievableCount: attestedRetrievableCount,
      reportedCount: attestedRetrievableCount,
      advertisedCount,
      contractKind: contract.contractKind,
    };
  }

  #buildSourceDiscrepancyEvidence(
    runId,
    { retrievableCount, advertisedCount, contractKind },
    countEvidence,
  ) {
    if (contractKind === null) return null;
    const identity = this.#db
      .prepare(
        `SELECT p.property_key, p.booking_hotel_id
           FROM scrape_runs r
           JOIN properties p ON p.property_id = r.property_id
          WHERE r.run_id = ?`,
      )
      .get(runId);
    const pageEvidence = this.#db
      .prepare(
        `SELECT e.evidence_json, e.evidence_sha256,
                p.reported_review_count
           FROM scrape_page_count_evidence e
           JOIN scrape_pages p
             ON p.page_id = e.page_id AND p.run_id = e.run_id
          WHERE e.run_id = ?
          ORDER BY p.phase_key, p.source_offset
          LIMIT 1`,
      )
      .get(runId);
    if (!pageEvidence) {
      throw new StorageError(
        "Known source discrepancy requires persisted advertised count evidence",
        "SOURCE_DISCREPANCY_EVIDENCE_MISSING",
      );
    }
    let advertisedEvidence;
    try {
      advertisedEvidence = normalizeCountEvidence(
        JSON.parse(pageEvidence.evidence_json),
        pageEvidence.reported_review_count,
        { knownSourceDiscrepancy: true },
      );
    } catch (error) {
      throw new StorageError(
        "Known source discrepancy advertised evidence failed validation",
        "SOURCE_DISCREPANCY_MISMATCH",
        { causeCode: error?.code ?? "INVALID_JSON" },
      );
    }
    if (
      pageEvidence.evidence_sha256 !==
        countEvidence.countEvidenceSha256 ||
      advertisedEvidence.reviewsCount !== retrievableCount
    ) {
      throw new StorageError(
        "Known source discrepancy count evidence does not match its full attestation",
        "SOURCE_DISCREPANCY_MISMATCH",
      );
    }

    const retrievableByBucket = new Map(
      REVIEW_SCORE_RANGE_VALUES.map((value) => [value, 0]),
    );
    const scores = this.#db
      .prepare(
        `SELECT score_tenths
           FROM review_stage
          WHERE run_id = ?
          ORDER BY source_review_token`,
      )
      .all(runId);
    if (scores.length !== retrievableCount) {
      throw new StorageError(
        "Known source discrepancy inventory count changed",
        "SOURCE_DISCREPANCY_MISMATCH",
        {
          retrievableCount,
          observedCount: scores.length,
        },
      );
    }
    for (const row of scores) {
      const matching = REVIEW_SCORE_RANGE_VALUES.filter((value) =>
        reviewScoreMatchesRange(row.score_tenths / 10, value),
      );
      if (matching.length !== 1) {
        throw new StorageError(
          "A staged review does not belong to exactly one proven score bucket",
          "SOURCE_DISCREPANCY_MISMATCH",
          { scoreTenths: row.score_tenths },
        );
      }
      retrievableByBucket.set(
        matching[0],
        retrievableByBucket.get(matching[0]) + 1,
      );
    }
    const retrievableScoreBuckets =
      REVIEW_SCORE_RANGE_VALUES.map((value) => ({
        value,
        count: retrievableByBucket.get(value),
      }));
    let normalized;
    try {
      normalized = assertKnownSourceDiscrepancy({
        propertyKey: identity.property_key,
        bookingHotelId: identity.booking_hotel_id,
        advertisedReviewCount: advertisedCount,
        retrievableReviewCount: retrievableCount,
        advertisedTrustedTotals:
          advertisedEvidence.trustedTotals,
        advertisedScoreBuckets:
          advertisedEvidence.scoreBuckets,
        retrievableScoreBuckets,
        contractKind,
      });
    } catch (error) {
      throw new StorageError(
        "Known source discrepancy evidence drifted from its exact contract",
        "SOURCE_DISCREPANCY_MISMATCH",
        { causeCode: error?.code ?? "INVALID_EVIDENCE" },
      );
    }
    return {
      contractVersion: normalized.contractVersion,
      contractKind: normalized.contractKind,
      propertyKey: normalized.propertyKey,
      bookingHotelId: normalized.bookingHotelId,
      advertisedReviewCount:
        normalized.advertisedReviewCount,
      retrievableReviewCount:
        normalized.retrievableReviewCount,
      gapCount: normalized.gapCount,
      scoreBucket: normalized.scoreBucketGap.value,
      advertisedBucketCount:
        normalized.scoreBucketGap.advertisedCount,
      retrievableBucketCount:
        normalized.scoreBucketGap.retrievableCount,
      advertisedScoreBuckets:
        normalized.advertisedScoreBuckets,
      retrievableScoreBuckets:
        normalized.retrievableScoreBuckets,
      countEvidenceSha256:
        countEvidence.countEvidenceSha256,
    };
  }

  #buildFullPublicationEvidence(
    runId,
    { retrievableCount, reportedCount },
  ) {
    const run = this.getRun(runId);
    if (!run) {
      throw new StorageError("Run was not found", "RUN_NOT_FOUND");
    }
    if (!["full", "reconcile"].includes(run.mode)) {
      throw new StorageError(
        "Full inventory evidence requires a complete inventory run",
        "RUN_MODE_MISMATCH",
      );
    }
    const oldest = this.#inventoryPhaseEvidence({
      runId,
      phaseKey: "inventory_oldest",
      sorter: "OLDEST_FIRST",
      retrievableCount,
      reportedCount,
    });
    const newest = this.#inventoryPhaseEvidence({
      runId,
      phaseKey: "inventory_newest",
      sorter: "NEWEST_FIRST",
      retrievableCount,
      reportedCount,
    });
    if (
      oldest.identitySha256 !== newest.identitySha256 ||
      oldest.recordsSha256 !== newest.recordsSha256
    ) {
      this.#fullContractError(
        "Oldest and newest inventories do not have exact record parity",
        {
          oldestUniqueCount: oldest.uniqueCount,
          newestUniqueCount: newest.uniqueCount,
          identityParity:
            oldest.identitySha256 === newest.identitySha256,
          recordParity:
            oldest.recordsSha256 === newest.recordsSha256,
        },
      );
    }
    const finalHead = this.#finalHeadEvidence({
      runId,
      retrievableCount,
      reportedCount,
    });
    if (
      finalHead.responseSha256 !== newest.firstPage.response_sha256
    ) {
      this.#fullContractError(
        "Final head does not match the published newest inventory head",
      );
    }
    return {
      contractVersion: 1,
      expectedCount: retrievableCount,
      oldestUniqueCount: oldest.uniqueCount,
      newestUniqueCount: newest.uniqueCount,
      oldestIdentitySha256: oldest.identitySha256,
      newestIdentitySha256: newest.identitySha256,
      oldestRecordsSha256: oldest.recordsSha256,
      newestRecordsSha256: newest.recordsSha256,
      oldestTerminalOffset: oldest.terminalOffset,
      newestTerminalOffset: newest.terminalOffset,
      finalHeadResponseSha256: finalHead.responseSha256,
    };
  }

  #buildFullEvidenceBundle(
    runId,
    retrievableCount,
    sourceDiscrepancy = null,
  ) {
    const counts = this.#sourceDiscrepancyCounts(
      runId,
      retrievableCount,
      sourceDiscrepancy,
    );
    const inventory = this.#buildFullPublicationEvidence(
      runId,
      counts,
    );
    const countEvidence =
      this.#buildFullCountAttestationEvidence(runId, counts);
    return {
      inventory,
      counts: countEvidence,
      sourceDiscrepancy:
        this.#buildSourceDiscrepancyEvidence(
          runId,
          counts,
          countEvidence,
        ),
    };
  }

  #requireFullCountAttestation(runId, evidence) {
    const attestation = this.getFullCountAttestation(runId);
    if (!attestation) {
      throw new StorageError(
        "Full count evidence has not been explicitly attested",
        "FULL_COUNT_ATTESTATION_MISSING",
      );
    }
    const persisted = {
      contractVersion: attestation.contract_version,
      expectedCount: attestation.expected_count,
      countEvidenceSha256: attestation.count_evidence_sha256,
      authoritativePageCount:
        attestation.authoritative_page_count,
    };
    if (canonicalJson(persisted) !== canonicalJson(evidence)) {
      throw new StorageError(
        "Persisted full count attestation no longer matches its evidence",
        "FULL_COUNT_ATTESTATION_MISMATCH",
      );
    }
    return attestation;
  }

  #persistFullCountAttestation(runId, evidence) {
    const existing = this.getFullCountAttestation(runId);
    if (existing) {
      return this.#requireFullCountAttestation(runId, evidence);
    }
    this.#db
      .prepare(
        `INSERT INTO full_count_attestations (
           run_id, contract_version, expected_count,
           count_evidence_sha256, authoritative_page_count,
           attested_at_utc
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        evidence.contractVersion,
        evidence.expectedCount,
        evidence.countEvidenceSha256,
        evidence.authoritativePageCount,
        nowIso(),
      );
    return this.getFullCountAttestation(runId);
  }

  #requireSourceDiscrepancyAttestation(runId, evidence) {
    const attestation =
      this.getSourceDiscrepancyAttestation(runId);
    if (!evidence && !attestation) return null;
    if (!evidence || !attestation) {
      throw new StorageError(
        "Known source discrepancy attestation is missing or unexpected",
        "SOURCE_DISCREPANCY_ATTESTATION_MISMATCH",
      );
    }
    const persisted = {
      contractVersion: attestation.contractVersion,
      contractKind: attestation.contractKind,
      propertyKey: attestation.propertyKey,
      bookingHotelId: attestation.bookingHotelId,
      advertisedReviewCount:
        attestation.advertisedReviewCount,
      retrievableReviewCount:
        attestation.retrievableReviewCount,
      gapCount: attestation.gapCount,
      scoreBucket: attestation.scoreBucket,
      advertisedBucketCount:
        attestation.advertisedBucketCount,
      retrievableBucketCount:
        attestation.retrievableBucketCount,
      advertisedScoreBuckets:
        attestation.advertisedScoreBuckets,
      retrievableScoreBuckets:
        attestation.retrievableScoreBuckets,
      countEvidenceSha256:
        attestation.countEvidenceSha256,
    };
    if (canonicalJson(persisted) !== canonicalJson(evidence)) {
      throw new StorageError(
        "Persisted source discrepancy attestation no longer matches its evidence",
        "SOURCE_DISCREPANCY_ATTESTATION_MISMATCH",
      );
    }
    return attestation;
  }

  #persistSourceDiscrepancyAttestation(runId, evidence) {
    if (!evidence) {
      return this.#requireSourceDiscrepancyAttestation(
        runId,
        null,
      );
    }
    const existing =
      this.getSourceDiscrepancyAttestation(runId);
    if (existing) {
      return this.#requireSourceDiscrepancyAttestation(
        runId,
        evidence,
      );
    }
    this.#db
      .prepare(
        `INSERT INTO source_discrepancy_attestations (
           run_id, contract_version, contract_kind,
           property_key, booking_hotel_id,
           advertised_review_count, retrievable_review_count,
           gap_count, score_bucket,
           advertised_bucket_count, retrievable_bucket_count,
           advertised_score_buckets_json,
           retrievable_score_buckets_json,
           count_evidence_sha256, attested_at_utc
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        evidence.contractVersion,
        evidence.contractKind,
        evidence.propertyKey,
        evidence.bookingHotelId,
        evidence.advertisedReviewCount,
        evidence.retrievableReviewCount,
        evidence.gapCount,
        evidence.scoreBucket,
        evidence.advertisedBucketCount,
        evidence.retrievableBucketCount,
        canonicalJson(evidence.advertisedScoreBuckets),
        canonicalJson(evidence.retrievableScoreBuckets),
        evidence.countEvidenceSha256,
        nowIso(),
      );
    return this.getSourceDiscrepancyAttestation(runId);
  }

  #requireFullInventoryAttestation(runId, expectedCount) {
    const sourceDiscrepancy =
      this.getSourceDiscrepancyAttestation(runId);
    const evidence = this.#buildFullEvidenceBundle(
      runId,
      expectedCount,
      sourceDiscrepancy,
    );
    const attestation = this.getFullInventoryAttestation(runId);
    if (!attestation) {
      throw new StorageError(
        "Full inventory parity has not been explicitly attested",
        "FULL_ATTESTATION_MISSING",
      );
    }
    const persisted = {
      contractVersion: attestation.contract_version,
      expectedCount: attestation.expected_count,
      oldestUniqueCount: attestation.oldest_unique_count,
      newestUniqueCount: attestation.newest_unique_count,
      oldestIdentitySha256:
        attestation.oldest_identity_sha256,
      newestIdentitySha256:
        attestation.newest_identity_sha256,
      oldestRecordsSha256: attestation.oldest_records_sha256,
      newestRecordsSha256: attestation.newest_records_sha256,
      oldestTerminalOffset:
        attestation.oldest_terminal_offset,
      newestTerminalOffset:
        attestation.newest_terminal_offset,
      finalHeadResponseSha256:
        attestation.final_head_response_sha256,
    };
    if (
      canonicalJson(persisted) !==
      canonicalJson(evidence.inventory)
    ) {
      throw new StorageError(
        "Persisted full inventory attestation no longer matches its evidence",
        "FULL_ATTESTATION_MISMATCH",
      );
    }
    this.#requireFullCountAttestation(runId, evidence.counts);
    this.#requireSourceDiscrepancyAttestation(
      runId,
      evidence.sourceDiscrepancy,
    );
    return attestation;
  }

  attestFullInventoryParity({
    runId,
    expectedCount,
    sourceDiscrepancy = null,
  }) {
    if (!Number.isInteger(expectedCount) || expectedCount < 0) {
      throw new StorageError(
        "expectedCount must be a non-negative integer",
        "INVALID_ARGUMENT",
      );
    }
    return this.#transaction(() => {
      this.#requireCollectingRun(runId);
      const existingSourceDiscrepancy =
        this.getSourceDiscrepancyAttestation(runId);
      const evidence = this.#buildFullEvidenceBundle(
        runId,
        expectedCount,
        sourceDiscrepancy ?? existingSourceDiscrepancy,
      );
      const existing = this.getFullInventoryAttestation(runId);
      let inventoryAttestation;
      if (existing) {
        const persisted = {
          contractVersion: existing.contract_version,
          expectedCount: existing.expected_count,
          oldestUniqueCount: existing.oldest_unique_count,
          newestUniqueCount: existing.newest_unique_count,
          oldestIdentitySha256:
            existing.oldest_identity_sha256,
          newestIdentitySha256:
            existing.newest_identity_sha256,
          oldestRecordsSha256: existing.oldest_records_sha256,
          newestRecordsSha256: existing.newest_records_sha256,
          oldestTerminalOffset:
            existing.oldest_terminal_offset,
          newestTerminalOffset:
            existing.newest_terminal_offset,
          finalHeadResponseSha256:
            existing.final_head_response_sha256,
        };
        if (
          canonicalJson(persisted) !==
          canonicalJson(evidence.inventory)
        ) {
          throw new StorageError(
            "Full inventory attestation conflicts with existing evidence",
            "FULL_ATTESTATION_MISMATCH",
          );
        }
        inventoryAttestation = existing;
      } else {
        this.#db
          .prepare(
            `INSERT INTO full_inventory_attestations (
               run_id, contract_version, expected_count,
               oldest_unique_count, newest_unique_count,
               oldest_identity_sha256, newest_identity_sha256,
               oldest_records_sha256, newest_records_sha256,
               oldest_terminal_offset, newest_terminal_offset,
               final_head_response_sha256, attested_at_utc
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            runId,
            evidence.inventory.contractVersion,
            evidence.inventory.expectedCount,
            evidence.inventory.oldestUniqueCount,
            evidence.inventory.newestUniqueCount,
            evidence.inventory.oldestIdentitySha256,
            evidence.inventory.newestIdentitySha256,
            evidence.inventory.oldestRecordsSha256,
            evidence.inventory.newestRecordsSha256,
            evidence.inventory.oldestTerminalOffset,
            evidence.inventory.newestTerminalOffset,
            evidence.inventory.finalHeadResponseSha256,
            nowIso(),
          );
        inventoryAttestation =
          this.getFullInventoryAttestation(runId);
      }
      this.#persistFullCountAttestation(runId, evidence.counts);
      this.#persistSourceDiscrepancyAttestation(
        runId,
        evidence.sourceDiscrepancy,
      );
      return inventoryAttestation;
    });
  }

  stagePage({
    runId,
    phaseKey,
    sourceOffset,
    requestedLimit,
    reportedReviewCount,
    reviews,
    countEvidence = null,
    attemptCount = 1,
    latencyMs = null,
    responseBytes = null,
    observedAtUtc = nowIso(),
  }) {
    if (!Number.isInteger(sourceOffset) || sourceOffset < 0) {
      throw new StorageError(
        "sourceOffset must be a non-negative integer",
        "INVALID_PAGE",
      );
    }
    if (
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 10
    ) {
      throw new StorageError(
        "requestedLimit must be from 1 to 10",
        "INVALID_PAGE",
      );
    }
    if (
      !Number.isInteger(reportedReviewCount) ||
      reportedReviewCount < 0
    ) {
      throw new StorageError(
        "reportedReviewCount must be non-negative",
        "INVALID_PAGE",
      );
    }
    if (!Array.isArray(reviews) || reviews.length > requestedLimit) {
      throw new StorageError(
        "reviews must fit within requestedLimit",
        "INVALID_PAGE",
      );
    }
    if (!Number.isInteger(attemptCount) || attemptCount < 1) {
      throw new StorageError(
        "attemptCount must be positive",
        "INVALID_PAGE",
      );
    }
    if (
      reviews.length === 0 &&
      sourceOffset === 0 &&
      reportedReviewCount > 0
    ) {
      throw new StorageError(
        "A non-zero collection cannot have an empty first page",
        "UNEXPECTED_EMPTY_PAGE",
      );
    }
    const run = this.#requireCollectingRun(runId);
    const authoritativeRun = ["full", "reconcile"].includes(
      run.mode,
    );
    const property = this.#db
      .prepare("SELECT * FROM properties WHERE property_id = ?")
      .get(run.property_id);
    const knownSourceCountEvidence =
      authoritativeRun &&
      property?.property_key ===
        KNOWN_SOURCE_DISCREPANCY.propertyKey &&
      property?.booking_hotel_id ===
        KNOWN_SOURCE_DISCREPANCY.bookingHotelId;
    if (
      reviews.length < requestedLimit &&
      sourceOffset + reviews.length < reportedReviewCount
    ) {
      throw new StorageError(
        "A short page appeared before the reported terminal position",
        "PREMATURE_SHORT_PAGE",
      );
    }

    if (authoritativeRun && countEvidence == null) {
      throw new StorageError(
        "Full and reconcile pages require countEvidence",
        "COUNT_EVIDENCE_REQUIRED",
      );
    }
    const normalizedCountEvidence =
      countEvidence == null
        ? null
        : normalizeCountEvidence(
            countEvidence,
            reportedReviewCount,
            {
              knownSourceDiscrepancy:
                knownSourceCountEvidence,
            },
          );
    const countEvidenceJson =
      normalizedCountEvidence == null
        ? null
        : canonicalJson(normalizedCountEvidence);
    const countEvidenceSha256 =
      countEvidenceJson == null
        ? null
        : sha256Hex(countEvidenceJson);
    const phase = this.getPhase(runId, phaseKey);
    if (!phase || phase.status !== "running") {
      throw new StorageError(
        "Phase was not found or is already complete",
        "PHASE_NOT_RUNNING",
      );
    }
    const previouslyCommittedPage = this.#db
      .prepare(
        `SELECT 1
           FROM scrape_pages
          WHERE run_id = ? AND phase_key = ? AND source_offset = ?`,
      )
      .get(runId, phaseKey, sourceOffset);
    if (phase.next_offset !== sourceOffset && !previouslyCommittedPage) {
      throw new StorageError(
        `Expected offset ${phase.next_offset}, received ${sourceOffset}`,
        "PAGE_GAP",
      );
    }

    const prepared = reviews.map((review) =>
      prepareReview(review, property.time_zone, observedAtUtc),
    );
    const tokens = prepared.map((review) => review.sourceReviewToken);
    if (new Set(tokens).size !== tokens.length) {
      throw new StorageError(
        "A source token appeared twice within one page",
        "DUPLICATE_WITHIN_PAGE",
      );
    }
    const orderedTokensHash = sha256Hex(canonicalJson(tokens));
    const responseHash = sha256Hex(
      canonicalJson({
        reportedReviewCount,
        records: prepared.map((review) => ({
          sourceReviewToken: review.sourceReviewToken,
          recordHash: review.recordHash,
        })),
      }),
    );

    try {
      return this.#transaction(() => {
        this.#requireCollectingRun(runId);
        const currentPhase = this.getPhase(runId, phaseKey);
        const existingPage = this.#db
          .prepare(
            `SELECT *
               FROM scrape_pages
              WHERE run_id = ? AND phase_key = ? AND source_offset = ?`,
          )
          .get(runId, phaseKey, sourceOffset);
        if (existingPage) {
          if (existingPage.response_sha256 !== responseHash) {
            throw new StorageError(
              "A committed logical page changed",
              "PAGE_REPLAY_CONFLICT",
            );
          }
          const existingCountEvidence = this.#db
            .prepare(
              `SELECT *
                 FROM scrape_page_count_evidence
                WHERE page_id = ? AND run_id = ?`,
            )
            .get(existingPage.page_id, runId);
          if (
            (existingCountEvidence == null) !==
            (countEvidenceJson == null)
          ) {
            throw new StorageError(
              "A committed page count-evidence record changed",
              "PAGE_REPLAY_CONFLICT",
            );
          }
          if (existingCountEvidence) {
            let existingNormalized;
            try {
              existingNormalized = normalizeCountEvidence(
                JSON.parse(existingCountEvidence.evidence_json),
                existingPage.reported_review_count,
                {
                  knownSourceDiscrepancy:
                    knownSourceCountEvidence,
                },
              );
            } catch {
              throw new StorageError(
                "Persisted page count evidence is no longer valid",
                "PAGE_REPLAY_CONFLICT",
              );
            }
            const existingJson = canonicalJson(
              existingNormalized,
            );
            const existingSha256 = sha256Hex(existingJson);
            if (
              existingCountEvidence.contract_version !== 1 ||
              existingCountEvidence.evidence_json !== existingJson ||
              existingCountEvidence.evidence_sha256 !==
                existingSha256 ||
              existingJson !== countEvidenceJson ||
              existingSha256 !== countEvidenceSha256
            ) {
              throw new StorageError(
                "A committed page count-evidence record changed",
                "PAGE_REPLAY_CONFLICT",
              );
            }
          }
          return { ...existingPage, idempotent: true };
        }
        if (currentPhase.next_offset !== sourceOffset) {
          throw new StorageError(
            "The page checkpoint changed before commit",
            "PAGE_GAP",
          );
        }
        if (prepared.length > 0) {
          const repeatedAnchor = this.#db
            .prepare(
              `SELECT source_offset
                 FROM scrape_pages
                WHERE run_id = ?
                  AND phase_key = ?
                  AND ordered_tokens_sha256 = ?
                  AND source_offset <> ?`,
            )
            .get(runId, phaseKey, orderedTokensHash, sourceOffset);
          if (repeatedAnchor) {
            throw new StorageError(
              "The same ordered review page repeated at another offset",
              "REPEATED_PAGE_ANCHOR",
            );
          }
        }

        const insertedPage = this.#db
          .prepare(
            `INSERT INTO scrape_pages (
               run_id, phase_key, source_offset, requested_limit,
               reported_review_count, returned_card_count,
               ordered_tokens_sha256, response_sha256, attempt_count,
               latency_ms, response_bytes, committed_at_utc
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            runId,
            phaseKey,
            sourceOffset,
            requestedLimit,
            reportedReviewCount,
            prepared.length,
            orderedTokensHash,
            responseHash,
            attemptCount,
            latencyMs,
            responseBytes,
            observedAtUtc,
          );
        const pageId = Number(insertedPage.lastInsertRowid);
        if (countEvidenceJson != null) {
          this.#db
            .prepare(
              `INSERT INTO scrape_page_count_evidence (
                 page_id, run_id, contract_version, evidence_json,
                 evidence_sha256, committed_at_utc
               ) VALUES (?, ?, 1, ?, ?, ?)`,
            )
            .run(
              pageId,
              runId,
              countEvidenceJson,
              countEvidenceSha256,
              observedAtUtc,
            );
        }

        const findStage = this.#db.prepare(
          `SELECT record_hash, source_card_json
             FROM review_stage
            WHERE run_id = ? AND source_review_token = ?`,
        );
        const insertStage = this.#db.prepare(
          `INSERT INTO review_stage (
             run_id, property_id, source_review_token,
             reviewed_epoch, reviewed_at_utc, reviewed_local_date,
             score_tenths, title, positive_text, negative_text,
             source_language, partner_reply, helpful_votes_count,
             booking_details_json, guest_details_json, photos_json,
             highlights_json, source_card_json, record_hash, content_hash,
             first_observed_at_utc, last_observed_at_utc, occurrence_count
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, 1
           )`,
        );
        const touchStage = this.#db.prepare(
          `UPDATE review_stage
              SET last_observed_at_utc = ?,
                  occurrence_count = occurrence_count + 1
            WHERE run_id = ? AND source_review_token = ?`,
        );
        const insertPageReview = this.#db.prepare(
          `INSERT INTO scrape_page_reviews (
             page_id, run_id, card_index, source_review_token, record_hash
           ) VALUES (?, ?, ?, ?, ?)`,
        );

        prepared.forEach((review, cardIndex) => {
          const previous = findStage.get(
            runId,
            review.sourceReviewToken,
          );
          if (previous) {
            if (previous.record_hash !== review.recordHash) {
              throw new StorageError(
                "One review token changed during the same run",
                "STAGE_HASH_CONFLICT",
                { sourceReviewToken: review.sourceReviewToken },
              );
            }
            touchStage.run(
              observedAtUtc,
              runId,
              review.sourceReviewToken,
            );
          } else {
            insertStage.run(
              runId,
              run.property_id,
              review.sourceReviewToken,
              review.reviewedEpoch,
              review.reviewedAtUtc,
              review.reviewedLocalDate,
              review.scoreTenths,
              review.title,
              review.positiveText,
              review.negativeText,
              review.sourceLanguage,
              review.partnerReply,
              review.helpfulVotesCount,
              review.bookingDetailsJson,
              review.guestDetailsJson,
              review.photosJson,
              review.highlightsJson,
              review.sourceCardJson,
              review.recordHash,
              review.contentHash,
              review.observedAtUtc,
              review.observedAtUtc,
            );
          }
          insertPageReview.run(
            pageId,
            runId,
            cardIndex,
            review.sourceReviewToken,
            review.recordHash,
          );
        });

        this.#db
          .prepare(
            `UPDATE scrape_phases
                SET next_offset = ?,
                    last_committed_offset = ?,
                    updated_at_utc = ?
              WHERE run_id = ? AND phase_key = ?`,
          )
          .run(
            sourceOffset + requestedLimit,
            sourceOffset,
            observedAtUtc,
            runId,
            phaseKey,
          );
        const uniqueCount = rowCount(
          this.#db,
          "review_stage",
          "WHERE run_id = ?",
          [runId],
        );
        const duplicateCount = Number(
          this.#db
            .prepare(
              `SELECT COALESCE(SUM(occurrence_count - 1), 0) AS count
                 FROM review_stage
                WHERE run_id = ?`,
            )
            .get(runId).count,
        );
        this.#db
          .prepare(
            `UPDATE scrape_runs
                SET staged_unique_count = ?,
                    duplicate_occurrences = ?,
                    pages_succeeded = pages_succeeded + 1,
                    requests_total = requests_total + ?,
                    retries_total = retries_total + ?,
                    latency_total_ms = latency_total_ms + ?,
                    bytes_received = bytes_received + ?
              WHERE run_id = ?`,
          )
          .run(
            uniqueCount,
            duplicateCount,
            attemptCount,
            attemptCount - 1,
            latencyMs ?? 0,
            responseBytes ?? 0,
            runId,
          );
        this.#fault("stage:before-commit");
        return {
          pageId,
          uniqueCount,
          duplicateCount,
          idempotent: false,
        };
      });
    } catch (error) {
      if (error instanceof StorageError && error.code === "STAGE_HASH_CONFLICT") {
        this.failRun(runId, error.code, error.message);
      }
      throw error;
    }
  }

  finishPhase({
    runId,
    phaseKey,
    expectedCountEnd,
    stopReason,
  }) {
    if (
      !Number.isInteger(expectedCountEnd) ||
      expectedCountEnd < 0
    ) {
      throw new StorageError(
        "expectedCountEnd must be non-negative",
        "INVALID_ARGUMENT",
      );
    }
    assertNonEmptyString(stopReason, "stopReason");
    return this.#transaction(() => {
      this.#requireCollectingRun(runId);
      const phase = this.getPhase(runId, phaseKey);
      if (!phase) {
        throw new StorageError("Phase was not found", "PHASE_NOT_FOUND");
      }
      if (phase.status === "succeeded") return phase;
      const pageCount = Number(
        this.#db
          .prepare(
            `SELECT COUNT(*) AS count
               FROM scrape_pages
              WHERE run_id = ? AND phase_key = ?`,
          )
          .get(runId, phaseKey).count,
      );
      if (pageCount === 0) {
        throw new StorageError(
          "A phase cannot finish without a validated page",
          "EMPTY_PHASE",
        );
      }
      this.#db
        .prepare(
          `UPDATE scrape_phases
              SET status = 'succeeded',
                  expected_count_end = ?,
                  stop_reason = ?,
                  updated_at_utc = ?
            WHERE run_id = ? AND phase_key = ?`,
        )
        .run(
          expectedCountEnd,
          stopReason,
          nowIso(),
          runId,
          phaseKey,
        );
      return this.getPhase(runId, phaseKey);
    });
  }

  finalizePhase(options) {
    return this.finishPhase(options);
  }

  finalizeRun({
    runId,
    finalCount,
    snapshot = {},
  }) {
    if (!Number.isInteger(finalCount) || finalCount < 0) {
      throw new StorageError(
        "finalCount must be a non-negative integer",
        "INVALID_ARGUMENT",
      );
    }
    return this.#transaction(() => {
      const run = this.getRun(runId);
      if (!run) {
        throw new StorageError("Run was not found", "RUN_NOT_FOUND");
      }
      const completeInventory = ["full", "reconcile"].includes(run.mode);
      if (run.status === "ready") {
        if (run.source_count_final !== finalCount) {
          throw new StorageError(
            "A ready run cannot be finalized with another count",
            "FINAL_COUNT_CONFLICT",
          );
        }
        if (completeInventory) {
          this.#requireFullInventoryAttestation(runId, finalCount);
        }
        return run;
      }
      if (run.status !== "collecting") {
        throw new StorageError(
          `Run is ${run.status}, not collecting`,
          "RUN_NOT_COLLECTING",
        );
      }
      const phaseCounts = this.#db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded
           FROM scrape_phases
          WHERE run_id = ?`,
        )
        .get(runId);
      if (
        Number(phaseCounts.total) === 0 ||
        Number(phaseCounts.succeeded) !== Number(phaseCounts.total)
      ) {
        throw new StorageError(
          "Every collection phase must be complete",
          "INCOMPLETE_PHASES",
        );
      }
      const stagedCount = rowCount(
        this.#db,
        "review_stage",
        "WHERE run_id = ?",
        [runId],
      );
      if (completeInventory && stagedCount !== finalCount) {
        throw new StorageError(
          `Staged count ${stagedCount} does not match ${finalCount}`,
          "RECONCILIATION_MISMATCH",
          { stagedCount, finalCount },
        );
      }
      if (completeInventory) {
        this.#requireFullInventoryAttestation(runId, finalCount);
      }
      if (!completeInventory) {
        const publication = this.#db
          .prepare(
            `SELECT 1
               FROM property_publications
              WHERE property_id = ?`,
          )
          .get(run.property_id);
        if (!publication) {
          throw new StorageError(
            "An incremental run requires a published baseline",
            "NO_INCREMENTAL_BASELINE",
          );
        }
        const presentCount = Number(
          this.#db
            .prepare(
              `SELECT COUNT(*) AS count
                 FROM reviews
                WHERE property_id = ? AND presence_state = 'present'`,
            )
            .get(run.property_id).count,
        );
        const additions = Number(
          this.#db
            .prepare(
              `SELECT COUNT(*) AS count
                 FROM review_stage s
                 LEFT JOIN reviews r
                   ON r.property_id = s.property_id
                  AND r.source_review_token = s.source_review_token
                WHERE s.run_id = ?
                  AND (r.review_id IS NULL OR r.presence_state <> 'present')`,
            )
            .get(runId).count,
        );
        if (presentCount + additions !== finalCount) {
          throw new StorageError(
            "Incremental projection does not match the final source count",
            "INCREMENTAL_COUNT_MISMATCH",
            {
              presentCount,
              additions,
              projectedCount: presentCount + additions,
              finalCount,
            },
          );
        }
      }

      const displayedScore =
        snapshot.displayedScore == null
          ? null
          : scoreTenths(snapshot.displayedScore);
      const displayedCount = snapshot.displayedReviewCount ?? null;
      if (
        displayedCount != null &&
        (!Number.isInteger(displayedCount) || displayedCount < 0)
      ) {
        throw new StorageError(
          "displayedReviewCount must be non-negative or null",
          "INVALID_SNAPSHOT",
        );
      }
      const ratingScoresJson =
        snapshot.ratingScores == null
          ? null
          : canonicalJson(snapshot.ratingScores);
      const capturedAt = snapshot.capturedAtUtc ?? nowIso();
      this.#db
        .prepare(
          `INSERT INTO property_snapshots (
             run_id, property_id, captured_at_utc, is_unfiltered,
             structured_review_count, displayed_score_tenths,
             displayed_review_count, rating_scores_json, query_sha256
           ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          run.property_id,
          capturedAt,
          finalCount,
          displayedScore,
          displayedCount,
          ratingScoresJson,
          run.query_sha256,
        );
      this.#db
        .prepare(
          `UPDATE scrape_runs
              SET status = 'ready',
                  complete_inventory = ?,
                  source_count_final = ?,
                  staged_unique_count = ?,
                  ready_at_utc = ?
            WHERE run_id = ?`,
        )
        .run(
          completeInventory ? 1 : 0,
          finalCount,
          stagedCount,
          nowIso(),
          runId,
        );
      this.#fault("finalize:before-commit");
      return this.getRun(runId);
    });
  }

  markReady(options) {
    return this.finalizeRun(options);
  }

  #insertVersion(reviewId, versionNumber, stage, runId) {
    this.#db
      .prepare(
        `INSERT INTO review_versions (
           review_id, version_number, is_current, record_hash, content_hash,
           reviewed_epoch, reviewed_at_utc, reviewed_local_date, score_tenths,
           title, positive_text, negative_text, source_language,
           partner_reply, helpful_votes_count, booking_details_json,
           guest_details_json, photos_json, highlights_json, source_card_json,
           first_observed_at_utc, last_observed_at_utc,
           first_observed_run_id, last_observed_run_id
         ) VALUES (
           ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?
         )`,
      )
      .run(
        reviewId,
        versionNumber,
        stage.record_hash,
        stage.content_hash,
        stage.reviewed_epoch,
        stage.reviewed_at_utc,
        stage.reviewed_local_date,
        stage.score_tenths,
        stage.title,
        stage.positive_text,
        stage.negative_text,
        stage.source_language,
        stage.partner_reply,
        stage.helpful_votes_count,
        stage.booking_details_json,
        stage.guest_details_json,
        stage.photos_json,
        stage.highlights_json,
        stage.source_card_json,
        stage.first_observed_at_utc,
        stage.last_observed_at_utc,
        runId,
        runId,
      );
  }

  promoteRun(runId) {
    const existingRun = this.getRun(runId);
    if (!existingRun) {
      throw new StorageError("Run was not found", "RUN_NOT_FOUND");
    }
    const existingPublication = this.#db
      .prepare(
        `SELECT *
           FROM property_publications
          WHERE property_id = ?`,
      )
      .get(existingRun.property_id);
    if (
      existingRun.status === "succeeded" &&
      existingPublication?.last_successful_run_id === runId
    ) {
      if (existingRun.complete_inventory === 1) {
        this.#requireFullInventoryAttestation(
          runId,
          existingRun.source_count_final,
        );
      }
      return {
        idempotent: true,
        run: existingRun,
        publication: existingPublication,
      };
    }

    return this.#transaction(() => {
      const run = this.getRun(runId);
      if (run.status !== "ready") {
        throw new StorageError(
          `Run is ${run.status}, not ready`,
          "RUN_NOT_READY",
        );
      }
      if (run.mode === "canary") {
        throw new StorageError(
          "Canary runs are observations and cannot be published",
          "RUN_MODE_MISMATCH",
        );
      }
      if (run.complete_inventory === 1) {
        if (!["full", "reconcile"].includes(run.mode)) {
          throw new StorageError(
            "Only full or reconcile runs can carry complete inventory evidence",
            "DATABASE_INVARIANT_FAILED",
          );
        }
        this.#requireFullInventoryAttestation(
          runId,
          run.source_count_final,
        );
      }
      const publication = this.#db
        .prepare(
          `SELECT *
             FROM property_publications
            WHERE property_id = ?`,
        )
        .get(run.property_id);
      const currentBase = publication?.last_successful_run_id ?? null;
      if (currentBase !== run.base_publication_run_id) {
        throw new StorageError(
          "The property publication changed after this run started",
          "STALE_BASE_PUBLICATION",
          {
            expected: run.base_publication_run_id,
            actual: currentBase,
          },
        );
      }
      const stagedCount = rowCount(
        this.#db,
        "review_stage",
        "WHERE run_id = ?",
        [runId],
      );
      if (
        run.complete_inventory === 1 &&
        stagedCount !== run.source_count_final
      ) {
        throw new StorageError(
          "Full-run staging no longer reconciles",
          "RECONCILIATION_MISMATCH",
        );
      }

      const timestamp = nowIso();
      const staged = this.#db
        .prepare(
          `SELECT *
             FROM review_stage
            WHERE run_id = ?
            ORDER BY source_review_token`,
        )
        .all(runId);
      const findReview = this.#db.prepare(
        `SELECT *
           FROM reviews
          WHERE property_id = ? AND source_review_token = ?`,
      );
      const findCurrentVersion = this.#db.prepare(
        `SELECT *
           FROM review_versions
          WHERE review_id = ? AND is_current = 1`,
      );
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      let reactivated = 0;

      for (const stage of staged) {
        let review = findReview.get(
          run.property_id,
          stage.source_review_token,
        );
        if (!review) {
          const insertedReview = this.#db
            .prepare(
              `INSERT INTO reviews (
                 property_id, source_review_token,
                 first_seen_at_utc, first_seen_run_id,
                 last_seen_at_utc, last_seen_run_id,
                 last_complete_seen_run_id, presence_state
               ) VALUES (?, ?, ?, ?, ?, ?, ?, 'present')`,
            )
            .run(
              run.property_id,
              stage.source_review_token,
              stage.first_observed_at_utc,
              runId,
              stage.last_observed_at_utc,
              runId,
              run.complete_inventory === 1 ? runId : null,
            );
          const reviewId = Number(insertedReview.lastInsertRowid);
          this.#insertVersion(reviewId, 1, stage, runId);
          inserted += 1;
          continue;
        }

        const wasAbsent = review.presence_state !== "present";
        const currentVersion = findCurrentVersion.get(review.review_id);
        if (!currentVersion) {
          throw new StorageError(
            "A review has no current version",
            "DATABASE_INVARIANT_FAILED",
            { reviewId: review.review_id },
          );
        }
        if (currentVersion.record_hash === stage.record_hash) {
          this.#db
            .prepare(
              `UPDATE review_versions
                  SET last_observed_at_utc = ?,
                      last_observed_run_id = ?
                WHERE version_id = ?`,
            )
            .run(
              stage.last_observed_at_utc,
              runId,
              currentVersion.version_id,
            );
          unchanged += 1;
        } else {
          this.#db
            .prepare(
              `UPDATE review_versions
                  SET is_current = 0,
                      superseded_at_utc = ?,
                      superseded_by_run_id = ?
                WHERE version_id = ? AND is_current = 1`,
            )
            .run(
              timestamp,
              runId,
              currentVersion.version_id,
            );
          this.#insertVersion(
            review.review_id,
            currentVersion.version_number + 1,
            stage,
            runId,
          );
          updated += 1;
        }
        this.#db
          .prepare(
            `UPDATE reviews
                SET last_seen_at_utc = ?,
                    last_seen_run_id = ?,
                    last_complete_seen_run_id =
                      CASE WHEN ? = 1 THEN ? ELSE last_complete_seen_run_id END,
                    presence_state = 'present',
                    consecutive_missing_full_scans = 0,
                    suspect_missing_since_utc = NULL,
                    suspect_missing_run_id = NULL,
                    tombstoned_at_utc = NULL,
                    tombstoned_run_id = NULL,
                    reactivation_count = reactivation_count + ?
              WHERE review_id = ?`,
          )
          .run(
            stage.last_observed_at_utc,
            runId,
            run.complete_inventory,
            runId,
            wasAbsent ? 1 : 0,
            review.review_id,
          );
        if (wasAbsent) reactivated += 1;
      }

      let suspectMissing = 0;
      let tombstoned = 0;
      if (run.complete_inventory === 1) {
        const missing = this.#db
          .prepare(
            `SELECT r.*
               FROM reviews r
              WHERE r.property_id = ?
                AND NOT EXISTS (
                  SELECT 1
                    FROM review_stage s
                   WHERE s.run_id = ?
                     AND s.source_review_token = r.source_review_token
                )`,
          )
          .all(run.property_id, runId);
        const updateMissing = this.#db.prepare(
          `UPDATE reviews
              SET presence_state = ?,
                  consecutive_missing_full_scans = ?,
                  suspect_missing_since_utc =
                    CASE
                      WHEN ? = 'suspect_missing'
                      THEN COALESCE(suspect_missing_since_utc, ?)
                      ELSE suspect_missing_since_utc
                    END,
                  suspect_missing_run_id =
                    CASE
                      WHEN ? = 'suspect_missing'
                      THEN COALESCE(suspect_missing_run_id, ?)
                      ELSE suspect_missing_run_id
                    END,
                  tombstoned_at_utc =
                    CASE
                      WHEN ? = 'tombstoned'
                      THEN COALESCE(tombstoned_at_utc, ?)
                      ELSE tombstoned_at_utc
                    END,
                  tombstoned_run_id =
                    CASE
                      WHEN ? = 'tombstoned'
                      THEN COALESCE(tombstoned_run_id, ?)
                      ELSE tombstoned_run_id
                    END
            WHERE review_id = ?`,
        );
        for (const review of missing) {
          const missingCount =
            review.consecutive_missing_full_scans + 1;
          const nextState =
            missingCount >= 2 ? "tombstoned" : "suspect_missing";
          updateMissing.run(
            nextState,
            missingCount,
            nextState,
            timestamp,
            nextState,
            runId,
            nextState,
            timestamp,
            nextState,
            runId,
            review.review_id,
          );
          if (
            nextState === "suspect_missing" &&
            review.presence_state !== "suspect_missing"
          ) {
            suspectMissing += 1;
          }
          if (
            nextState === "tombstoned" &&
            review.presence_state !== "tombstoned"
          ) {
            tombstoned += 1;
          }
        }
      }

      const presentCount = Number(
        this.#db
          .prepare(
            `SELECT COUNT(*) AS count
               FROM reviews
              WHERE property_id = ? AND presence_state = 'present'`,
          )
          .get(run.property_id).count,
      );
      if (presentCount !== run.source_count_final) {
        throw new StorageError(
          "Promoted presence count does not match final source count",
          "PROMOTION_COUNT_MISMATCH",
          { presentCount, finalCount: run.source_count_final },
        );
      }

      this.#fault("promotion:before-publication");
      const generation = (publication?.generation ?? 0) + 1;
      const lastFullRunId =
        run.complete_inventory === 1
          ? runId
          : publication?.last_successful_full_run_id ?? null;
      this.#db
        .prepare(
          `INSERT INTO property_publications (
             property_id, last_successful_run_id,
             last_successful_full_run_id, generation, published_at_utc
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(property_id) DO UPDATE SET
             last_successful_run_id = excluded.last_successful_run_id,
             last_successful_full_run_id =
               excluded.last_successful_full_run_id,
             generation = excluded.generation,
             published_at_utc = excluded.published_at_utc`,
        )
        .run(
          run.property_id,
          runId,
          lastFullRunId,
          generation,
          timestamp,
        );
      this.#db
        .prepare(
          `UPDATE scrape_runs
              SET status = 'succeeded',
                  inserted_count = ?,
                  updated_count = ?,
                  unchanged_count = ?,
                  reactivated_count = ?,
                  suspect_missing_count = ?,
                  tombstoned_count = ?,
                  published_at_utc = ?,
                  finished_at_utc = ?
            WHERE run_id = ?`,
        )
        .run(
          inserted,
          updated,
          unchanged,
          reactivated,
          suspectMissing,
          tombstoned,
          timestamp,
          timestamp,
          runId,
        );
      this.#fault("promotion:before-commit");
      return {
        idempotent: false,
        run: this.getRun(runId),
        publication: this.getPublicationById(run.property_id),
      };
    });
  }

  promoteFull(runId) {
    const run = this.getRun(runId);
    if (!run) {
      throw new StorageError("Run was not found", "RUN_NOT_FOUND");
    }
    if (!["full", "reconcile"].includes(run.mode)) {
      throw new StorageError(
        "promoteFull only accepts a complete inventory run",
        "RUN_MODE_MISMATCH",
      );
    }
    return this.promoteRun(runId);
  }

  failRun(runId, errorCode, errorDetailRedacted = null) {
    assertNonEmptyString(errorCode, "errorCode");
    return this.#transaction(() => {
      const run = this.getRun(runId);
      if (!run) {
        throw new StorageError("Run was not found", "RUN_NOT_FOUND");
      }
      if (run.status === "succeeded") {
        throw new StorageError(
          "A published run cannot be failed",
          "RUN_ALREADY_PUBLISHED",
        );
      }
      this.#db
        .prepare(
          `UPDATE scrape_runs
              SET status = 'failed',
                  error_code = ?,
                  error_detail_redacted = ?,
                  finished_at_utc = ?
            WHERE run_id = ?`,
        )
        .run(
          errorCode,
          errorDetailRedacted,
          nowIso(),
          runId,
        );
      return this.getRun(runId);
    });
  }

  getRun(runId) {
    return (
      this.#db
        .prepare("SELECT * FROM scrape_runs WHERE run_id = ?")
        .get(runId) ?? null
    );
  }

  getPhase(runId, phaseKey) {
    return (
      this.#db
        .prepare(
          `SELECT *
             FROM scrape_phases
            WHERE run_id = ? AND phase_key = ?`,
        )
        .get(runId, phaseKey) ?? null
    );
  }

  getFullInventoryAttestation(runId) {
    return (
      this.#db
        .prepare(
          `SELECT *
             FROM full_inventory_attestations
            WHERE run_id = ?`,
        )
        .get(runId) ?? null
    );
  }

  getFullCountAttestation(runId) {
    return (
      this.#db
        .prepare(
          `SELECT *
             FROM full_count_attestations
            WHERE run_id = ?`,
        )
        .get(runId) ?? null
    );
  }

  getSourceDiscrepancyAttestation(runId) {
    const row = this.#db
      .prepare(
        `SELECT *
           FROM source_discrepancy_attestations
          WHERE run_id = ?`,
      )
      .get(runId);
    if (!row) return null;
    let advertisedScoreBuckets;
    let retrievableScoreBuckets;
    try {
      advertisedScoreBuckets = JSON.parse(
        row.advertised_score_buckets_json,
      );
      retrievableScoreBuckets = JSON.parse(
        row.retrievable_score_buckets_json,
      );
    } catch {
      throw new StorageError(
        "Persisted source discrepancy bucket evidence is invalid JSON",
        "SOURCE_DISCREPANCY_ATTESTATION_MISMATCH",
      );
    }
    return {
      contractVersion: row.contract_version,
      contractKind: row.contract_kind,
      propertyKey: row.property_key,
      bookingHotelId: row.booking_hotel_id,
      advertisedReviewCount: row.advertised_review_count,
      retrievableReviewCount:
        row.retrievable_review_count,
      gapCount: row.gap_count,
      scoreBucket: row.score_bucket,
      advertisedBucketCount:
        row.advertised_bucket_count,
      retrievableBucketCount:
        row.retrievable_bucket_count,
      advertisedScoreBuckets,
      retrievableScoreBuckets,
      countEvidenceSha256: row.count_evidence_sha256,
      attestedAtUtc: row.attested_at_utc,
    };
  }

  getPageCountEvidence(runId) {
    return this.#db
      .prepare(
        `SELECT
           e.page_id,
           e.run_id,
           p.phase_key,
           p.source_offset,
           e.contract_version,
           e.evidence_json,
           e.evidence_sha256,
           e.committed_at_utc
         FROM scrape_page_count_evidence e
         JOIN scrape_pages p
           ON p.page_id = e.page_id AND p.run_id = e.run_id
        WHERE e.run_id = ?
        ORDER BY p.phase_key, p.source_offset`,
      )
      .all(runId);
  }

  getPages(runId) {
    return this.#db
      .prepare(
        `SELECT *
           FROM scrape_pages
          WHERE run_id = ?
          ORDER BY phase_key, source_offset`,
      )
      .all(runId);
  }

  getStagedReviews(runId) {
    return this.#db
      .prepare(
        `SELECT *
           FROM review_stage
          WHERE run_id = ?
          ORDER BY source_review_token`,
      )
      .all(runId);
  }

  getCurrentReviews(propertyKey) {
    return this.#db
      .prepare(
        `SELECT
           r.review_id, r.source_review_token, r.presence_state,
           r.consecutive_missing_full_scans, r.reactivation_count,
           v.version_number, v.record_hash, v.content_hash,
           v.reviewed_epoch, v.reviewed_at_utc, v.reviewed_local_date,
           v.score_tenths, v.title, v.positive_text, v.negative_text,
           v.source_language, v.partner_reply, v.helpful_votes_count,
           v.booking_details_json, v.guest_details_json, v.photos_json,
           v.highlights_json, v.source_card_json
         FROM properties p
         JOIN reviews r ON r.property_id = p.property_id
         JOIN review_versions v
           ON v.review_id = r.review_id AND v.is_current = 1
        WHERE p.property_key = ? AND r.presence_state = 'present'
        ORDER BY v.reviewed_epoch DESC, r.review_id`,
      )
      .all(propertyKey);
  }

  getReviewIdentity(propertyKey, sourceReviewToken) {
    return (
      this.#db
        .prepare(
          `SELECT r.*
             FROM reviews r
             JOIN properties p ON p.property_id = r.property_id
            WHERE p.property_key = ? AND r.source_review_token = ?`,
        )
        .get(propertyKey, sourceReviewToken) ?? null
    );
  }

  getReviewVersions(propertyKey, sourceReviewToken) {
    return this.#db
      .prepare(
        `SELECT v.*
           FROM review_versions v
           JOIN reviews r ON r.review_id = v.review_id
           JOIN properties p ON p.property_id = r.property_id
          WHERE p.property_key = ? AND r.source_review_token = ?
          ORDER BY v.version_number`,
      )
      .all(propertyKey, sourceReviewToken);
  }

  getPublication(propertyKey) {
    const property = this.getProperty(propertyKey);
    if (!property) return null;
    return this.getPublicationById(property.property_id);
  }

  getPublicationById(propertyId) {
    return (
      this.#db
        .prepare(
          `SELECT *
             FROM property_publications
            WHERE property_id = ?`,
        )
        .get(propertyId) ?? null
    );
  }

  getSnapshot(runId) {
    return (
      this.#db
        .prepare("SELECT * FROM property_snapshots WHERE run_id = ?")
        .get(runId) ?? null
    );
  }

  getPublishedStats(propertyKey) {
    const property = this.getProperty(propertyKey);
    if (!property) return null;
    const publication = this.getPublicationById(property.property_id);
    if (!publication) {
      return {
        property,
        publication: null,
        presentCount: 0,
        suspectMissingCount: 0,
        tombstonedCount: 0,
        currentAverageScore: null,
      };
    }
    const stats = this.#db
      .prepare(
        `SELECT
           SUM(CASE WHEN r.presence_state = 'present' THEN 1 ELSE 0 END)
             AS present_count,
           SUM(CASE WHEN r.presence_state = 'suspect_missing' THEN 1 ELSE 0 END)
             AS suspect_missing_count,
           SUM(CASE WHEN r.presence_state = 'tombstoned' THEN 1 ELSE 0 END)
             AS tombstoned_count,
           AVG(
             CASE WHEN r.presence_state = 'present' THEN v.score_tenths END
           ) AS average_score_tenths
         FROM reviews r
         JOIN review_versions v
           ON v.review_id = r.review_id AND v.is_current = 1
        WHERE r.property_id = ?`,
      )
      .get(property.property_id);
    return {
      property,
      publication,
      presentCount: Number(stats.present_count ?? 0),
      suspectMissingCount: Number(stats.suspect_missing_count ?? 0),
      tombstonedCount: Number(stats.tombstoned_count ?? 0),
      currentAverageScore:
        stats.average_score_tenths == null
          ? null
          : Number(stats.average_score_tenths) / 10,
    };
  }

  integrityCheck() {
    return this.#db.prepare("PRAGMA integrity_check").all();
  }
}
