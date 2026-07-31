import { createHash } from "node:crypto";
import {
  CANONICAL_REVIEW_PHOTO_HOSTNAME,
} from "./photo-url-parity.mjs";
import { PARSER_VERSION } from "./review-contract.mjs";
import { REVIEW_SCORE_RANGE_VALUES } from "./live-template.mjs";
import {
  assertSourceGap,
  SOURCE_GAP_CONTRACT,
} from "./source-discrepancy.mjs";

const SHA256 = /^[a-f0-9]{64}$/i;

export class ExportValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ExportValidationError";
    this.code = code;
    this.details = details;
  }
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  return JSON.parse(value);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function canonicalScoreBuckets(value) {
  if (
    !Array.isArray(value) ||
    value.length !== REVIEW_SCORE_RANGE_VALUES.length
  ) {
    return null;
  }
  const normalized = [];
  for (const [index, expectedValue] of
    REVIEW_SCORE_RANGE_VALUES.entries()) {
    const bucket = value[index];
    if (
      !isPlainObject(bucket) ||
      Object.keys(bucket).length !== 2 ||
      !Object.hasOwn(bucket, "value") ||
      !Object.hasOwn(bucket, "count") ||
      bucket.value !== expectedValue ||
      !validCount(bucket.count)
    ) {
      return null;
    }
    normalized.push({
      value: bucket.value,
      count: bucket.count,
    });
  }
  return normalized;
}

function validateKnownSourceDiscrepancy(
  value,
  { property, run, presentCount },
) {
  if (!isPlainObject(value)) return null;
  if (
    value.contractVersion !== SOURCE_GAP_CONTRACT.contractVersion ||
    value.contractKind !== SOURCE_GAP_CONTRACT.contractKind ||
    value.propertyKey !== property?.property_key ||
    value.bookingHotelId !== property?.booking_hotel_id ||
    !validCount(value.advertisedReviewCount) ||
    !validCount(value.retrievableReviewCount) ||
    !validCount(value.advertisedBucketCount) ||
    !validCount(value.retrievableBucketCount) ||
    run?.source_count_final !== value.retrievableReviewCount ||
    presentCount !== value.retrievableReviewCount
  ) {
    return null;
  }
  if (
    value.advertisedReviewCount -
      value.retrievableReviewCount !==
    value.gapCount
  ) {
    return null;
  }
  const advertised = canonicalScoreBuckets(
    value.advertisedScoreBuckets,
  );
  const retrievable = canonicalScoreBuckets(
    value.retrievableScoreBuckets,
  );
  if (advertised === null || retrievable === null) return null;
  try {
    const normalized = assertSourceGap({
      propertyKey: value.propertyKey,
      bookingHotelId: value.bookingHotelId,
      advertisedReviewCount: value.advertisedReviewCount,
      retrievableReviewCount: value.retrievableReviewCount,
      advertisedScoreBuckets: advertised,
      retrievableScoreBuckets: retrievable,
      contractKind: value.contractKind,
    });
    if (
      value.gapCount !== normalized.gapCount ||
      value.scoreBucket !== normalized.scoreBucketGap.value ||
      value.advertisedBucketCount !==
        normalized.scoreBucketGap.advertisedCount ||
      value.retrievableBucketCount !==
        normalized.scoreBucketGap.retrievableCount
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    contractKind: value.contractKind,
    advertisedReviewCount: value.advertisedReviewCount,
    retrievableReviewCount: value.retrievableReviewCount,
    gapCount: value.gapCount,
    scoreBucket: value.scoreBucket,
    advertisedBucketCount: value.advertisedBucketCount,
    retrievableBucketCount: value.retrievableBucketCount,
  };
}

function publicReviewId(propertyKey, sourceReviewToken) {
  return createHash("sha256")
    .update(`${propertyKey}:${sourceReviewToken}`)
    .digest("hex")
    .slice(0, 24);
}

function assertCanonicalStoredPhotoUrl(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ExportValidationError(
      "INVALID_PHOTO_URL",
      "Stored review photo URL is missing or invalid",
      { path, reason: "not_a_non_empty_string" },
    );
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ExportValidationError(
      "INVALID_PHOTO_URL",
      "Stored review photo URL is missing or invalid",
      { path, reason: "invalid_url" },
    );
  }
  if (url.hostname !== CANONICAL_REVIEW_PHOTO_HOSTNAME) {
    throw new ExportValidationError(
      "INVALID_PHOTO_URL",
      "Stored review photo URL is not canonical",
      { path, reason: "canonical_host_missing" },
    );
  }
  return value;
}

function validateCanonicalPhotos(value) {
  if (!Array.isArray(value)) {
    throw new ExportValidationError(
      "INVALID_PHOTO_URL",
      "Stored review photos must be an array",
      { path: "photos", reason: "not_an_array" },
    );
  }
  for (const [photoIndex, photo] of value.entries()) {
    if (
      photo === null ||
      typeof photo !== "object" ||
      Array.isArray(photo) ||
      !Array.isArray(photo.urls)
    ) {
      throw new ExportValidationError(
        "INVALID_PHOTO_URL",
        "Stored review photo variants are malformed",
        {
          path: `photos[${photoIndex}]`,
          reason: "invalid_photo_shape",
        },
      );
    }
    for (const [variantIndex, variant] of photo.urls.entries()) {
      const path =
        `photos[${photoIndex}].urls[${variantIndex}].url`;
      if (
        variant === null ||
        typeof variant !== "object" ||
        Array.isArray(variant)
      ) {
        throw new ExportValidationError(
          "INVALID_PHOTO_URL",
          "Stored review photo variant is malformed",
          { path, reason: "invalid_variant_shape" },
        );
      }
      assertCanonicalStoredPhotoUrl(variant.url, path);
    }
  }
  return value;
}

export function exportReviewRecord(property, row) {
  const source = parseJson(row.source_card_json, {});
  const booking = parseJson(row.booking_details_json, null);
  const guest = parseJson(row.guest_details_json, null);
  const photos = validateCanonicalPhotos(parseJson(row.photos_json, []));
  const highlights = parseJson(row.highlights_json, {
    positive: [],
    negative: [],
  });
  return {
    propertyKey: property.property_key,
    propertyName: property.business_name,
    bookingHotelId: property.booking_hotel_id,
    reviewId: publicReviewId(
      property.property_key,
      row.source_review_token,
    ),
    reviewedEpoch: row.reviewed_epoch,
    reviewedAtUtc: row.reviewed_at_utc,
    reviewedLocalDate: row.reviewed_local_date,
    score: row.score_tenths / 10,
    title: row.title,
    positiveText: row.positive_text,
    negativeText: row.negative_text,
    sourceLanguage: row.source_language,
    partnerReply: row.partner_reply,
    helpfulVotesCount: row.helpful_votes_count,
    bookingDetails: booking,
    guestDetails: guest
      ? {
          username: guest.username ?? null,
          countryCode: guest.countryCode ?? null,
          countryName: guest.countryName ?? null,
          anonymous: guest.anonymous ?? null,
          guestTypeTranslation:
            guest.guestTypeTranslation ?? null,
          joinedDate: guest.joinedDate ?? null,
          userReviewCount: guest.userReviewCount ?? null,
        }
      : null,
    photos,
    highlights,
    textTrivialFlag: source.textDetails?.textTrivialFlag ?? null,
    isApproved: source.isApproved ?? null,
    isTranslatable: source.isTranslatable ?? null,
  };
}

function csvCell(value) {
  if (value == null) return "";
  const text =
    typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function recordsToCsv(records) {
  const columns = [
    "propertyKey",
    "propertyName",
    "bookingHotelId",
    "reviewId",
    "reviewedLocalDate",
    "score",
    "title",
    "positiveText",
    "negativeText",
    "sourceLanguage",
    "partnerReply",
    "helpfulVotesCount",
    "roomName",
    "customerType",
    "numNights",
    "guestCountry",
    "guestType",
  ];
  const lines = [columns.join(",")];
  for (const record of records) {
    const row = {
      ...record,
      roomName: record.bookingDetails?.roomType?.name ?? null,
      customerType: record.bookingDetails?.customerType ?? null,
      numNights: record.bookingDetails?.numNights ?? null,
      guestCountry: record.guestDetails?.countryName ?? null,
      guestType: record.guestDetails?.guestTypeTranslation ?? null,
    };
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function authoritativePublicationEvidence(storage, stats) {
  const reasons = [];
  const publication = stats?.publication ?? null;
  if (!publication) {
    return {
      authoritative: false,
      missing: true,
      reasons: ["publication_missing"],
      run: null,
    };
  }

  const runId = publication.last_successful_run_id;
  const run =
    typeof storage.getRun === "function" && typeof runId === "string"
      ? storage.getRun(runId)
      : null;
  const attestation =
    typeof storage.getFullInventoryAttestation === "function" &&
    typeof runId === "string"
      ? storage.getFullInventoryAttestation(runId)
      : null;
  const sourceDiscrepancy =
    typeof storage.getSourceDiscrepancyAttestation === "function" &&
    typeof runId === "string"
      ? storage.getSourceDiscrepancyAttestation(runId)
      : null;

  if (!run) {
    reasons.push("latest_run_missing");
  } else {
    if (run.status !== "succeeded") {
      reasons.push("latest_run_not_succeeded");
    }
    if (run.parser_version !== PARSER_VERSION) {
      reasons.push("latest_run_parser_version_mismatch");
    }
    if (
      !["full", "reconcile"].includes(run.mode) ||
      run.complete_inventory !== 1
    ) {
      reasons.push("latest_run_not_complete_inventory");
    }
    if (
      Number.isInteger(stats?.property?.property_id) &&
      run.property_id !== stats.property.property_id
    ) {
      reasons.push("latest_run_property_mismatch");
    }
    if (
      !Number.isInteger(run.source_count_final) ||
      run.source_count_final !== stats.presentCount
    ) {
      reasons.push("published_count_mismatch");
    }
  }

  if (publication.last_successful_full_run_id !== runId) {
    reasons.push("latest_run_is_not_latest_full_run");
  }

  const expectedCount = run?.source_count_final;
  const expectedTerminalOffset = Number.isInteger(expectedCount)
    ? Math.ceil(expectedCount / 10) * 10
    : null;
  if (
    !attestation ||
    attestation.run_id !== runId ||
    attestation.contract_version !== 1 ||
    attestation.expected_count !== expectedCount ||
    attestation.oldest_unique_count !== expectedCount ||
    attestation.newest_unique_count !== expectedCount ||
    attestation.oldest_identity_sha256 !==
      attestation.newest_identity_sha256 ||
    attestation.oldest_records_sha256 !==
      attestation.newest_records_sha256 ||
    !SHA256.test(attestation.oldest_identity_sha256 ?? "") ||
    !SHA256.test(attestation.oldest_records_sha256 ?? "") ||
    !SHA256.test(attestation.final_head_response_sha256 ?? "") ||
    attestation.oldest_terminal_offset !== expectedTerminalOffset ||
    attestation.newest_terminal_offset !== expectedTerminalOffset
  ) {
    reasons.push("full_inventory_attestation_invalid");
  }

  const normalizedSourceDiscrepancy =
    sourceDiscrepancy === null
      ? null
      : validateKnownSourceDiscrepancy(sourceDiscrepancy, {
          property: stats?.property,
          run,
          presentCount: stats?.presentCount,
        });
  if (
    sourceDiscrepancy !== null &&
    normalizedSourceDiscrepancy === null
  ) {
    reasons.push("source_discrepancy_attestation_invalid");
  }
  return {
    authoritative: reasons.length === 0,
    missing: false,
    reasons,
    run,
    sourceDiscrepancy: normalizedSourceDiscrepancy,
  };
}

export function collectExportRecords(
  storage,
  propertyKeys,
  { samplePerProperty = 25, strictAll = false } = {},
) {
  if (!Array.isArray(propertyKeys) || propertyKeys.length === 0) {
    throw new ExportValidationError(
      "INVALID_PROPERTY_SCOPE",
      "At least one configured property key is required",
    );
  }
  if (
    propertyKeys.some(
      (key) => typeof key !== "string" || key.trim().length === 0,
    ) ||
    new Set(propertyKeys).size !== propertyKeys.length
  ) {
    throw new ExportValidationError(
      "INVALID_PROPERTY_SCOPE",
      "Configured property keys must be non-empty and unique",
    );
  }
  if (typeof strictAll !== "boolean") {
    throw new TypeError("strictAll must be a boolean");
  }
  if (
    samplePerProperty !== Infinity &&
    (!Number.isInteger(samplePerProperty) || samplePerProperty < 1)
  ) {
    throw new Error("samplePerProperty must be a positive integer or Infinity");
  }
  const candidates = propertyKeys.map((propertyKey) => {
    const stats = storage.getPublishedStats(propertyKey);
    const evidence = stats?.publication
      ? authoritativePublicationEvidence(storage, stats)
      : {
          authoritative: false,
          missing: true,
          reasons: ["publication_missing"],
          run: null,
        };
    return { propertyKey, stats, evidence };
  });

  if (strictAll) {
    const missingPropertyKeys = candidates
      .filter(({ evidence }) => evidence.missing)
      .map(({ propertyKey }) => propertyKey);
    const nonAuthoritativeProperties = candidates
      .filter(
        ({ evidence }) =>
          !evidence.missing && !evidence.authoritative,
      )
      .map(({ propertyKey, evidence }) => ({
        propertyKey,
        reasons: evidence.reasons,
      }));
    const authoritativePropertyCount = candidates.filter(
      ({ evidence }) => evidence.authoritative,
    ).length;
    if (
      missingPropertyKeys.length > 0 ||
      nonAuthoritativeProperties.length > 0
    ) {
      throw new ExportValidationError(
        "INCOMPLETE_AUTHORITATIVE_EXPORT",
        "Strict all-property export requires a complete attested full publication for every configured property",
        {
          requestedPropertyCount: propertyKeys.length,
          authoritativePropertyCount,
          missingPropertyCount: missingPropertyKeys.length,
          missingPropertyKeys,
          nonAuthoritativePropertyCount:
            nonAuthoritativeProperties.length,
          nonAuthoritativeProperties,
        },
      );
    }
  }

  const records = [];
  const properties = [];
  const omittedPropertyKeys = [];
  for (const { propertyKey, stats, evidence } of candidates) {
    if (!stats?.publication) {
      omittedPropertyKeys.push(propertyKey);
      continue;
    }
    const currentRows = storage.getCurrentReviews(propertyKey);
    const rows =
      samplePerProperty === Infinity
        ? currentRows
        : currentRows.slice(0, samplePerProperty);
    const exported = rows.map((row) =>
      exportReviewRecord(stats.property, row),
    );
    records.push(...exported);
    properties.push({
      propertyKey,
      bookingHotelId: stats.property.booking_hotel_id,
      publishedRunId: stats.publication.last_successful_run_id,
      publicationGeneration: stats.publication.generation,
      parserVersion: evidence.run?.parser_version ?? null,
      totalPublishedReviews: stats.presentCount,
      exportedReviews: exported.length,
      currentAverageScore: stats.currentAverageScore,
      authoritativeFullPublication: evidence.authoritative,
      advertisedReviews:
        evidence.sourceDiscrepancy?.advertisedReviewCount ??
        stats.presentCount,
      retrievableReviews:
        evidence.sourceDiscrepancy?.retrievableReviewCount ??
        stats.presentCount,
      sourceReviewGap:
        evidence.sourceDiscrepancy?.gapCount ?? 0,
      sourceDiscrepancyKind:
        evidence.sourceDiscrepancy?.contractKind ?? null,
      sourceDiscrepancyScoreBucket:
        evidence.sourceDiscrepancy?.scoreBucket ?? null,
      advertisedBucketReviews:
        evidence.sourceDiscrepancy?.advertisedBucketCount ?? null,
      retrievableBucketReviews:
        evidence.sourceDiscrepancy?.retrievableBucketCount ?? null,
    });
  }
  return {
    strictAll,
    requestedPropertyCount: propertyKeys.length,
    omittedPropertyKeys,
    properties,
    records,
  };
}

export const exporterInternals = Object.freeze({
  publicReviewId,
  csvCell,
  authoritativePublicationEvidence,
  validateKnownSourceDiscrepancy,
  assertCanonicalStoredPhotoUrl,
  validateCanonicalPhotos,
});
