import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import {
  mondayWeekStart,
  sydneyDateFromEpoch,
} from "./date-utils.mjs";
import {
  CANONICAL_REVIEW_PHOTO_HOSTNAME,
} from "./photo-url-parity.mjs";
import { loadProperties } from "./property-config.mjs";
import { PARSER_VERSION } from "./review-contract.mjs";
import {
  maxAllowedSourceGap,
  SOURCE_GAP_CONTRACT,
} from "./source-discrepancy.mjs";
import { REVIEW_SCORE_RANGE_VALUES } from "./live-template.mjs";

export const EXPORT_AUDIT_CONTRACT_VERSION = 1;

const PUBLIC_REVIEW_ID = /^[a-f0-9]{24}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const CANONICAL_PHOTO_AUTHORITY =
  /^https:\/\/booking-photo-cdn\.invalid(?::\d+)?(?:[/?#]|$)/;

const MANIFEST_KEYS = Object.freeze([
  "generatedAt",
  "mode",
  "samplePerProperty",
  "strictAll",
  "requestedPropertyCount",
  "omittedPropertyKeys",
  "properties",
  "totalRecords",
]);

const MANIFEST_PROPERTY_KEYS = Object.freeze([
  "propertyKey",
  "bookingHotelId",
  "publishedRunId",
  "publicationGeneration",
  "parserVersion",
  "totalPublishedReviews",
  "exportedReviews",
  "currentAverageScore",
  "authoritativeFullPublication",
  "advertisedReviews",
  "retrievableReviews",
  "sourceReviewGap",
  "sourceDiscrepancyKind",
  "sourceDiscrepancyScoreBucket",
  "advertisedBucketReviews",
  "retrievableBucketReviews",
]);

const RECORD_KEYS = Object.freeze([
  "propertyKey",
  "propertyName",
  "bookingHotelId",
  "reviewId",
  "reviewedEpoch",
  "reviewedAtUtc",
  "reviewedLocalDate",
  "score",
  "title",
  "positiveText",
  "negativeText",
  "sourceLanguage",
  "partnerReply",
  "helpfulVotesCount",
  "bookingDetails",
  "guestDetails",
  "photos",
  "highlights",
  "textTrivialFlag",
  "isApproved",
  "isTranslatable",
]);

const NULLABLE_TEXT_FIELDS = Object.freeze([
  "title",
  "positiveText",
  "negativeText",
  "sourceLanguage",
  "partnerReply",
]);

const FORBIDDEN_KEY_NAMES = new Set([
  "sourcereviewtoken",
  "sourcereviewurl",
  "reviewurl",
  "editurl",
  "avatarurl",
  "cookie",
  "cookies",
  "setcookie",
  "authorization",
  "proxyauthorization",
  "session",
  "sessionid",
  "sessiondata",
  "csrf",
  "csrftoken",
  "xsrf",
  "xsrftoken",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "bearertoken",
  "requestheaders",
  "responseheaders",
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "aid",
  "label",
  "sid",
  "session",
  "sessionid",
  "token",
  "auth",
  "authorization",
  "csrf",
  "xsrf",
  "affiliate",
  "affiliate_id",
  "gclid",
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validScore(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10 &&
    Math.abs(value * 10 - Math.round(value * 10)) <= 1e-9
  );
}

function validScoreRange(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10
  );
}

function validIsoInstant(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === value
  );
}

function validManifestSourceCounts(property) {
  if (
    !validCount(property.advertisedReviews) ||
    !validCount(property.retrievableReviews) ||
    !validCount(property.sourceReviewGap) ||
    property.retrievableReviews !== property.totalPublishedReviews ||
    property.advertisedReviews - property.retrievableReviews !==
      property.sourceReviewGap
  ) {
    return false;
  }
  if (property.sourceReviewGap === 0) {
    return (
      property.advertisedReviews === property.retrievableReviews &&
      property.sourceDiscrepancyKind === null &&
      property.sourceDiscrepancyScoreBucket === null &&
      property.advertisedBucketReviews === null &&
      property.retrievableBucketReviews === null
    );
  }
  // The manifest carries only the headline bucket, so its shortfall must be at
  // least one review and can never exceed the property's whole gap.
  const bucketShortfall =
    property.advertisedBucketReviews -
    property.retrievableBucketReviews;
  return (
    validCount(property.advertisedBucketReviews) &&
    validCount(property.retrievableBucketReviews) &&
    property.sourceReviewGap <=
      maxAllowedSourceGap(property.advertisedReviews) &&
    property.sourceDiscrepancyKind ===
      SOURCE_GAP_CONTRACT.contractKind &&
    REVIEW_SCORE_RANGE_VALUES.includes(
      property.sourceDiscrepancyScoreBucket,
    ) &&
    bucketShortfall >= 1 &&
    bucketShortfall <= property.sourceReviewGap
  );
}

class IssueCounter {
  #issues = new Map();

  add(code, field, count = 1) {
    const key = `${code}\u0000${field}`;
    const previous = this.#issues.get(key);
    if (previous) {
      previous.count += count;
      return;
    }
    this.#issues.set(key, { code, field, count });
  }

  merge(issues) {
    for (const issue of issues) {
      this.add(issue.code, issue.field, issue.count);
    }
  }

  list() {
    return [...this.#issues.values()].sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        left.field.localeCompare(right.field),
    );
  }
}

function normalizedKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function urlCarriesSessionData(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return true;
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) return true;
  }
  return false;
}

function inspectSensitiveData(value) {
  const findings = {
    forbiddenField: false,
    sessionUrl: false,
  };
  const seen = new Set();

  function visit(current, parentKey = "") {
    if (current === null || findings.forbiddenField && findings.sessionUrl) {
      return;
    }
    if (typeof current === "string") {
      const key = normalizedKey(parentKey);
      if (
        (key.endsWith("url") ||
          key.endsWith("uri") ||
          key.endsWith("href") ||
          key.endsWith("link")) &&
        urlCarriesSessionData(current)
      ) {
        findings.sessionUrl = true;
      }
      return;
    }
    if (typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) visit(item, parentKey);
      return;
    }
    for (const [key, nested] of Object.entries(current)) {
      if (FORBIDDEN_KEY_NAMES.has(normalizedKey(key))) {
        findings.forbiddenField = true;
      }
      visit(nested, key);
    }
  }

  visit(value);
  return findings;
}

function validatePhotos(photos, issues) {
  if (!Array.isArray(photos)) {
    issues.add("PHOTO_URL_NOT_CANONICAL", "record.photos");
    return false;
  }
  let valid = true;
  for (const photo of photos) {
    if (!isPlainObject(photo) || !Array.isArray(photo.urls)) {
      issues.add("PHOTO_URL_NOT_CANONICAL", "record.photos");
      valid = false;
      continue;
    }
    for (const variant of photo.urls) {
      if (!isPlainObject(variant) || typeof variant.url !== "string") {
        issues.add(
          "PHOTO_URL_NOT_CANONICAL",
          "record.photos[].urls[].url",
        );
        valid = false;
        continue;
      }
      let url;
      try {
        url = new URL(variant.url);
      } catch {
        url = null;
      }
      if (
        url === null ||
        url.protocol !== "https:" ||
        url.hostname !== CANONICAL_REVIEW_PHOTO_HOSTNAME ||
        url.username !== "" ||
        url.password !== "" ||
        !CANONICAL_PHOTO_AUTHORITY.test(variant.url)
      ) {
        issues.add(
          "PHOTO_URL_NOT_CANONICAL",
          "record.photos[].urls[].url",
        );
        valid = false;
      }
    }
  }
  return valid;
}

function validateRecord({
  record,
  configuredByKey,
  seenReviewIds,
  recordCountsByProperty,
  issues,
}) {
  const schemaReady = exactKeys(record, RECORD_KEYS);
  if (!schemaReady) {
    issues.add("RECORD_SCHEMA_MISMATCH", "record");
  }
  if (!isPlainObject(record)) {
    issues.add("ANALYTICS_WEEKLY_NOT_READY", "record");
    issues.add("ANALYTICS_PROPERTY_NOT_READY", "record");
    issues.add("ANALYTICS_FEED_NOT_READY", "record");
    return {
      weeklyReady: false,
      propertyReady: false,
      feedReady: false,
      uniqueReviewId: false,
      propertyKey: null,
      score: null,
    };
  }

  const sensitive = inspectSensitiveData(record);
  if (sensitive.forbiddenField) {
    issues.add("PRIVACY_FIELD_PRESENT", "record");
  }
  if (sensitive.sessionUrl) {
    issues.add("SESSION_DATA_PRESENT", "record");
  }
  const privacyReady =
    !sensitive.forbiddenField && !sensitive.sessionUrl;

  const configured = configuredByKey.get(record.propertyKey);
  const propertyReady =
    configured != null &&
    record.bookingHotelId === configured.hotelId &&
    record.propertyName === configured.businessName;
  if (!propertyReady) {
    issues.add("PROPERTY_IDENTITY_MISMATCH", "record.property");
  } else {
    recordCountsByProperty.set(
      record.propertyKey,
      recordCountsByProperty.get(record.propertyKey) + 1,
    );
  }

  const reviewIdFormat =
    typeof record.reviewId === "string" &&
    PUBLIC_REVIEW_ID.test(record.reviewId);
  let reviewIdUnique = reviewIdFormat;
  if (!reviewIdFormat) {
    issues.add("PUBLIC_REVIEW_ID_INVALID", "record.reviewId");
  } else if (seenReviewIds.has(record.reviewId)) {
    issues.add("PUBLIC_REVIEW_ID_DUPLICATE", "record.reviewId");
    reviewIdUnique = false;
  } else {
    seenReviewIds.add(record.reviewId);
  }

  const scoreReady = validScore(record.score);
  if (!scoreReady) {
    issues.add("SCORE_INVALID", "record.score");
  }

  let derivedLocalDate = null;
  try {
    derivedLocalDate = sydneyDateFromEpoch(record.reviewedEpoch);
  } catch {
    // Reported below as an aggregate timestamp error.
  }
  let localDateReady =
    derivedLocalDate !== null &&
    typeof record.reviewedLocalDate === "string" &&
    DATE_KEY.test(record.reviewedLocalDate) &&
    record.reviewedLocalDate === derivedLocalDate;
  if (localDateReady) {
    try {
      mondayWeekStart(record.reviewedLocalDate);
    } catch {
      localDateReady = false;
    }
  }
  if (!localDateReady) {
    issues.add(
      "SYDNEY_LOCAL_DATE_INVALID",
      "record.reviewedLocalDate",
    );
  }

  let utcReady = false;
  if (
    Number.isSafeInteger(record.reviewedEpoch) &&
    record.reviewedEpoch > 0 &&
    validIsoInstant(record.reviewedAtUtc)
  ) {
    try {
      utcReady =
        new Date(record.reviewedEpoch * 1000).toISOString() ===
        record.reviewedAtUtc;
    } catch {
      utcReady = false;
    }
  }
  if (!utcReady) {
    issues.add("UTC_TIMESTAMP_INVALID", "record.reviewedAtUtc");
  }

  let contentReady = true;
  for (const field of NULLABLE_TEXT_FIELDS) {
    if (record[field] != null && typeof record[field] !== "string") {
      issues.add("FEED_FIELD_INVALID", `record.${field}`);
      contentReady = false;
    }
  }
  if (
    record.helpfulVotesCount != null &&
    (!Number.isSafeInteger(record.helpfulVotesCount) ||
      record.helpfulVotesCount < 0)
  ) {
    issues.add("FEED_FIELD_INVALID", "record.helpfulVotesCount");
    contentReady = false;
  }
  if (
    record.bookingDetails != null &&
    !isPlainObject(record.bookingDetails)
  ) {
    issues.add("FEED_FIELD_INVALID", "record.bookingDetails");
    contentReady = false;
  }
  if (
    record.guestDetails != null &&
    !isPlainObject(record.guestDetails)
  ) {
    issues.add("FEED_FIELD_INVALID", "record.guestDetails");
    contentReady = false;
  }
  if (
    !isPlainObject(record.highlights) ||
    !Array.isArray(record.highlights.positive) ||
    !Array.isArray(record.highlights.negative)
  ) {
    issues.add("FEED_FIELD_INVALID", "record.highlights");
    contentReady = false;
  }
  if (
    record.textTrivialFlag != null &&
    (!Number.isSafeInteger(record.textTrivialFlag) ||
      record.textTrivialFlag < 0)
  ) {
    issues.add("FEED_FIELD_INVALID", "record.textTrivialFlag");
    contentReady = false;
  }
  for (const field of ["isApproved", "isTranslatable"]) {
    if (record[field] != null && typeof record[field] !== "boolean") {
      issues.add("FEED_FIELD_INVALID", `record.${field}`);
      contentReady = false;
    }
  }
  const photosReady = validatePhotos(record.photos, issues);

  const safeSchema = schemaReady && privacyReady;
  const weeklyReady =
    safeSchema &&
    propertyReady &&
    reviewIdFormat &&
    reviewIdUnique &&
    scoreReady &&
    localDateReady;
  const propertyAnalyticsReady =
    safeSchema && propertyReady && scoreReady;
  const feedReady =
    weeklyReady &&
    utcReady &&
    contentReady &&
    photosReady;

  if (!weeklyReady) {
    issues.add("ANALYTICS_WEEKLY_NOT_READY", "record");
  }
  if (!propertyAnalyticsReady) {
    issues.add("ANALYTICS_PROPERTY_NOT_READY", "record");
  }
  if (!feedReady) {
    issues.add("ANALYTICS_FEED_NOT_READY", "record");
  }
  return {
    weeklyReady,
    propertyReady: propertyAnalyticsReady,
    feedReady,
    uniqueReviewId: reviewIdFormat && reviewIdUnique,
    propertyKey: propertyReady ? record.propertyKey : null,
    score: scoreReady ? record.score : null,
  };
}

function validateManifest({
  manifest,
  configuredProperties,
  configuredByKey,
  issues,
}) {
  const manifestCountsByProperty = new Map(
    configuredProperties.map((property) => [property.key, null]),
  );
  const manifestAveragesByProperty = new Map(
    configuredProperties.map((property) => [property.key, null]),
  );
  if (!exactKeys(manifest, MANIFEST_KEYS)) {
    issues.add("MANIFEST_SCHEMA_MISMATCH", "manifest");
  }
  if (!isPlainObject(manifest)) {
    return {
      declaredTotal: null,
      manifestPropertyCount: 0,
      manifestCountsByProperty,
      manifestAveragesByProperty,
    };
  }

  const sensitive = inspectSensitiveData(manifest);
  if (sensitive.forbiddenField) {
    issues.add("PRIVACY_FIELD_PRESENT", "manifest");
  }
  if (sensitive.sessionUrl) {
    issues.add("SESSION_DATA_PRESENT", "manifest");
  }
  if (
    manifest.mode !== "all_current_reviews" ||
    manifest.strictAll !== true ||
    manifest.samplePerProperty !== null
  ) {
    issues.add("MANIFEST_NOT_PRODUCTION", "manifest.mode");
  }
  if (!validIsoInstant(manifest.generatedAt)) {
    issues.add("MANIFEST_FIELD_INVALID", "manifest.generatedAt");
  }
  if (
    manifest.requestedPropertyCount !== configuredProperties.length ||
    !Array.isArray(manifest.omittedPropertyKeys) ||
    manifest.omittedPropertyKeys.length !== 0
  ) {
    issues.add(
      "MANIFEST_PROPERTY_COVERAGE_MISMATCH",
      "manifest.properties",
    );
  }
  const declaredTotal = validCount(manifest.totalRecords)
    ? manifest.totalRecords
    : null;
  if (declaredTotal === null) {
    issues.add("MANIFEST_FIELD_INVALID", "manifest.totalRecords");
  }

  if (!Array.isArray(manifest.properties)) {
    issues.add("MANIFEST_FIELD_INVALID", "manifest.properties");
    return {
      declaredTotal,
      manifestPropertyCount: 0,
      manifestCountsByProperty,
      manifestAveragesByProperty,
    };
  }

  const seenManifestKeys = new Set();
  let exportedTotal = 0;
  let exportedTotalValid = true;
  for (const property of manifest.properties) {
    if (!exactKeys(property, MANIFEST_PROPERTY_KEYS)) {
      issues.add("MANIFEST_PROPERTY_INVALID", "manifest.properties[]");
    }
    if (!isPlainObject(property)) continue;
    const configured = configuredByKey.get(property.propertyKey);
    if (
      configured == null ||
      seenManifestKeys.has(property.propertyKey) ||
      property.bookingHotelId !== configured.hotelId
    ) {
      issues.add(
        "MANIFEST_PROPERTY_COVERAGE_MISMATCH",
        "manifest.properties[]",
      );
    } else {
      seenManifestKeys.add(property.propertyKey);
    }
    if (
      typeof property.publishedRunId !== "string" ||
      property.publishedRunId.length === 0 ||
      !Number.isSafeInteger(property.publicationGeneration) ||
      property.publicationGeneration < 1 ||
      property.parserVersion !== PARSER_VERSION ||
      property.authoritativeFullPublication !== true
    ) {
      issues.add("MANIFEST_PROPERTY_INVALID", "manifest.properties[]");
    }
    if (
      !validCount(property.totalPublishedReviews) ||
      !validCount(property.exportedReviews) ||
      property.totalPublishedReviews !== property.exportedReviews
    ) {
      issues.add(
        "MANIFEST_PROPERTY_COUNT_MISMATCH",
        "manifest.properties[].exportedReviews",
      );
      exportedTotalValid = false;
    } else if (
      exportedTotal >
      Number.MAX_SAFE_INTEGER - property.exportedReviews
    ) {
      issues.add(
        "MANIFEST_PROPERTY_COUNT_MISMATCH",
        "manifest.properties[].exportedReviews",
      );
      exportedTotalValid = false;
    } else {
      exportedTotal += property.exportedReviews;
      if (configured != null) {
        manifestCountsByProperty.set(
          property.propertyKey,
          property.exportedReviews,
        );
        manifestAveragesByProperty.set(
          property.propertyKey,
          property.currentAverageScore,
        );
      }
    }
    if (!validManifestSourceCounts(property)) {
      issues.add(
        "MANIFEST_SOURCE_COUNT_MISMATCH",
        "manifest.properties[].sourceReviewGap",
      );
    }
    if (
      (property.totalPublishedReviews === 0 &&
        property.currentAverageScore !== null) ||
      (property.totalPublishedReviews > 0 &&
        !validScoreRange(property.currentAverageScore))
    ) {
      issues.add(
        "MANIFEST_PROPERTY_INVALID",
        "manifest.properties[].currentAverageScore",
      );
    }
  }

  if (
    manifest.properties.length !== configuredProperties.length ||
    seenManifestKeys.size !== configuredProperties.length
  ) {
    issues.add(
      "MANIFEST_PROPERTY_COVERAGE_MISMATCH",
      "manifest.properties",
    );
  }
  if (
    exportedTotalValid &&
    declaredTotal !== null &&
    exportedTotal !== declaredTotal
  ) {
    issues.add(
      "MANIFEST_TOTAL_MISMATCH",
      "manifest.totalRecords",
    );
  }
  return {
    declaredTotal,
    manifestPropertyCount: manifest.properties.length,
    manifestCountsByProperty,
    manifestAveragesByProperty,
  };
}

function minimalFailureReport(code, field) {
  return {
    contractVersion: EXPORT_AUDIT_CONTRACT_VERSION,
    ok: false,
    counts: {
      configuredProperties: 0,
      manifestProperties: 0,
      manifestDeclaredRecords: null,
      jsonlRows: 0,
      parsedRecords: 0,
      uniquePublicReviewIds: 0,
      weeklyReadyRows: 0,
      propertyReadyRows: 0,
      feedReadyRows: 0,
    },
    properties: [],
    errors: [{ code, field, count: 1 }],
  };
}

export function auditExportData({
  manifest,
  records,
  configuredProperties,
  jsonlRowCount = records?.length ?? 0,
  parseIssues = [],
}) {
  if (!Array.isArray(configuredProperties) || configuredProperties.length === 0) {
    return minimalFailureReport(
      "PROPERTY_CONFIG_INVALID",
      "properties",
    );
  }
  if (!Array.isArray(records) || !validCount(jsonlRowCount)) {
    return minimalFailureReport("JSONL_INPUT_INVALID", "jsonl");
  }
  const issues = new IssueCounter();
  issues.merge(parseIssues);
  const configuredByKey = new Map();
  let configValid = true;
  for (const property of configuredProperties) {
    if (
      !isPlainObject(property) ||
      typeof property.key !== "string" ||
      property.key.length === 0 ||
      typeof property.businessName !== "string" ||
      property.businessName.length === 0 ||
      !Number.isSafeInteger(property.hotelId) ||
      property.hotelId <= 0 ||
      configuredByKey.has(property.key)
    ) {
      configValid = false;
      continue;
    }
    configuredByKey.set(property.key, property);
  }
  if (!configValid || configuredByKey.size !== configuredProperties.length) {
    return minimalFailureReport(
      "PROPERTY_CONFIG_INVALID",
      "properties",
    );
  }

  const manifestEvidence = validateManifest({
    manifest,
    configuredProperties,
    configuredByKey,
    issues,
  });
  if (
    manifestEvidence.declaredTotal !== null &&
    manifestEvidence.declaredTotal !== jsonlRowCount
  ) {
    issues.add("MANIFEST_TOTAL_MISMATCH", "manifest.totalRecords");
  }

  const recordCountsByProperty = new Map(
    configuredProperties.map((property) => [property.key, 0]),
  );
  const scoreEvidenceByProperty = new Map(
    configuredProperties.map((property) => [
      property.key,
      { count: 0, sum: 0 },
    ]),
  );
  const seenReviewIds = new Set();
  let uniquePublicReviewIds = 0;
  let weeklyReadyRows = 0;
  let propertyReadyRows = 0;
  let feedReadyRows = 0;
  for (const record of records) {
    const readiness = validateRecord({
      record,
      configuredByKey,
      seenReviewIds,
      recordCountsByProperty,
      issues,
    });
    if (readiness.uniqueReviewId) uniquePublicReviewIds += 1;
    if (readiness.weeklyReady) weeklyReadyRows += 1;
    if (readiness.propertyReady) propertyReadyRows += 1;
    if (readiness.feedReady) feedReadyRows += 1;
    if (readiness.propertyKey !== null && readiness.score !== null) {
      const scoreEvidence = scoreEvidenceByProperty.get(
        readiness.propertyKey,
      );
      scoreEvidence.count += 1;
      scoreEvidence.sum += readiness.score;
    }
  }

  for (const property of configuredProperties) {
    const manifestCount =
      manifestEvidence.manifestCountsByProperty.get(property.key);
    const rowCount = recordCountsByProperty.get(property.key);
    if (manifestCount === null || manifestCount !== rowCount) {
      issues.add(
        "MANIFEST_PROPERTY_COUNT_MISMATCH",
        "manifest.properties[].exportedReviews",
      );
    }
    const scoreEvidence = scoreEvidenceByProperty.get(property.key);
    const manifestAverage =
      manifestEvidence.manifestAveragesByProperty.get(property.key);
    if (
      rowCount > 0 &&
      scoreEvidence.count === rowCount &&
      (
        !validScoreRange(manifestAverage) ||
        Math.abs(
          scoreEvidence.sum / scoreEvidence.count -
            manifestAverage,
        ) > 1e-9
      )
    ) {
      issues.add(
        "MANIFEST_PROPERTY_AVERAGE_MISMATCH",
        "manifest.properties[].currentAverageScore",
      );
    }
  }

  const errors = issues.list();
  return {
    contractVersion: EXPORT_AUDIT_CONTRACT_VERSION,
    ok: errors.length === 0,
    counts: {
      configuredProperties: configuredProperties.length,
      manifestProperties: manifestEvidence.manifestPropertyCount,
      manifestDeclaredRecords: manifestEvidence.declaredTotal,
      jsonlRows: jsonlRowCount,
      parsedRecords: records.length,
      uniquePublicReviewIds,
      weeklyReadyRows,
      propertyReadyRows,
      feedReadyRows,
    },
    properties: configuredProperties.map((property) => ({
      propertyKey: property.key,
      manifestRows:
        manifestEvidence.manifestCountsByProperty.get(property.key),
      jsonlRows: recordCountsByProperty.get(property.key),
    })),
    errors,
  };
}

async function readJsonl(path) {
  const records = [];
  const issues = new IssueCounter();
  let jsonlRowCount = 0;
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({
    input,
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line.length === 0) {
      issues.add("JSONL_BLANK_LINE", "jsonl");
      continue;
    }
    jsonlRowCount += 1;
    try {
      records.push(JSON.parse(line));
    } catch {
      issues.add("JSONL_INVALID_JSON", "jsonl");
    }
  }
  return {
    records,
    jsonlRowCount,
    parseIssues: issues.list(),
  };
}

export async function auditExportFiles({
  manifestPath,
  jsonlPath,
  propertiesPath,
}) {
  let configuredProperties;
  try {
    configuredProperties = await loadProperties(propertiesPath);
  } catch {
    return minimalFailureReport(
      "PROPERTY_CONFIG_INVALID",
      "properties",
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return minimalFailureReport("MANIFEST_INPUT_INVALID", "manifest");
  }

  let jsonl;
  try {
    jsonl = await readJsonl(jsonlPath);
  } catch {
    return minimalFailureReport("JSONL_INPUT_INVALID", "jsonl");
  }
  return auditExportData({
    manifest,
    records: jsonl.records,
    configuredProperties,
    jsonlRowCount: jsonl.jsonlRowCount,
    parseIssues: jsonl.parseIssues,
  });
}

export const exportAuditInternals = Object.freeze({
  exactKeys,
  inspectSensitiveData,
  validatePhotos,
  validScore,
  validScoreRange,
});
