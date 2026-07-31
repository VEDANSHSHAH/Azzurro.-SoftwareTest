import { createHash } from "node:crypto";
import { maxAllowedSourceGap } from "./source-discrepancy.mjs";
import { sydneyDateFromEpoch } from "./date-utils.mjs";
import {
  canonicalizeReviewPhotoUrl,
  canonicalizeReviewSourceCardForParity,
  PhotoUrlParityError,
} from "./photo-url-parity.mjs";

export const PARSER_VERSION = "2.4.0";

const REVIEW_CARD_REQUIRED_KEYS = Object.freeze([
  "__typename",
  "reviewUrl",
  "guestDetails",
  "bookingDetails",
  "reviewedDate",
  "isTranslatable",
  "helpfulVotesCount",
  "reviewScore",
  "textDetails",
  "isApproved",
  "partnerReply",
  "positiveHighlights",
  "negativeHighlights",
  "editUrl",
  "photos",
]);

const TEXT_DETAILS_REQUIRED_KEYS = Object.freeze([
  "__typename",
  "title",
  "positiveText",
  "negativeText",
  "textTrivialFlag",
  "lang",
]);

const BOOKING_DETAILS_REQUIRED_KEYS = Object.freeze([
  "__typename",
  "customerType",
  "roomId",
  "roomType",
  "checkoutDate",
  "checkinDate",
  "numNights",
  "stayStatus",
]);

const ROOM_TYPE_REQUIRED_KEYS = Object.freeze([
  "__typename",
  "id",
  "name",
]);

const GUEST_DETAILS_REQUIRED_KEYS = Object.freeze([
  "__typename",
  "username",
  "avatarUrl",
  "countryCode",
  "countryName",
  "avatarColor",
  "showCountryFlag",
  "anonymous",
  "guestTypeTranslation",
]);

const PARTNER_REPLY_REQUIRED_KEYS = Object.freeze([
  "__typename",
  "reply",
]);

const PHOTO_REQUIRED_KEYS = Object.freeze([
  "__typename",
  "id",
  "urls",
  "kind",
]);

const PHOTO_URL_REQUIRED_KEYS = Object.freeze([
  "__typename",
  "size",
  "url",
]);

export class ContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ContractError";
    this.details = details;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireOwnKeys(value, keys, path) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new ContractError(`${path}.${key} is required`);
    }
  }
}

function requiredArray(value, path) {
  if (!Array.isArray(value)) {
    throw new ContractError(`${path} must be an array`);
  }
  return value;
}

function requiredObjectArray(value, path) {
  const array = requiredArray(value, path);
  for (const [index, item] of array.entries()) {
    if (!isObject(item)) {
      throw new ContractError(`${path}[${index}] must be an object`);
    }
  }
  return array;
}

function optionalObjectArray(value, path, { nullValue = [] } = {}) {
  if (value == null) return nullValue;
  return requiredObjectArray(value, path);
}

function optionalObject(value, path) {
  if (value == null) return null;
  if (!isObject(value)) {
    throw new ContractError(`${path} must be an object or null`);
  }
  return value;
}

function nullableString(value, path) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    const actualType = Array.isArray(value) ? "array" : typeof value;
    throw new ContractError(
      `${path} must be a string or null (received ${actualType})`,
    );
  }
  return value;
}

function nullableStringOrFiniteNumber(value, path) {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const actualType = Array.isArray(value) ? "array" : typeof value;
  throw new ContractError(
    `${path} must be a string, finite number or null (received ${actualType})`,
  );
}

function optionalBoolean(value, path) {
  if (value == null) return null;
  if (typeof value !== "boolean") {
    throw new ContractError(`${path} must be a boolean or null`);
  }
  return value;
}

function optionalNonNegativeInteger(value, path) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContractError(
      `${path} must be a non-negative safe integer or null`,
    );
  }
  return value;
}

function requiredString(value, path, { allowEmpty = false } = {}) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0)
  ) {
    throw new ContractError(
      `${path} must be ${allowEmpty ? "a string" : "a non-empty string"}`,
    );
  }
  return value;
}

function requiredNonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContractError(
      `${path} must be a non-negative safe integer`,
    );
  }
  return value;
}

function requiredScore(value, path) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 10
  ) {
    throw new ContractError(`${path} must be a finite score from 0 to 10`);
  }
  return value;
}

function requiredSourceId(value, path) {
  if (
    (typeof value !== "string" || value.length === 0) &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new ContractError(
      `${path} must be a non-empty string or non-negative safe integer`,
    );
  }
  return value;
}

function assertTypename(value, expected, path) {
  if (value !== expected) {
    throw new ContractError(`${path} must be ${expected}`);
  }
}

function assertUnique(items, selector, path) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const value = selector(item);
    if (seen.has(value)) {
      throw new ContractError(`${path} contains a duplicate value`, {
        index,
        value,
      });
    }
    seen.add(value);
  }
}

function validateRatingScores(value) {
  const scores = requiredObjectArray(value, "ratingScores");
  for (const [index, score] of scores.entries()) {
    const path = `ratingScores[${index}]`;
    assertTypename(score.__typename, "RatingScore", `${path}.__typename`);
    requiredString(score.name, `${path}.name`);
    requiredString(score.translation, `${path}.translation`);
    requiredScore(score.value, `${path}.value`);
    const average = optionalObject(
      score.ufiScoresAverage,
      `${path}.ufiScoresAverage`,
    );
    if (average != null) {
      assertTypename(
        average.__typename,
        "UfiScoreAverage",
        `${path}.ufiScoresAverage.__typename`,
      );
      const lower = requiredScore(
        average.ufiScoreLowerBound,
        `${path}.ufiScoresAverage.ufiScoreLowerBound`,
      );
      const upper = requiredScore(
        average.ufiScoreHigherBound,
        `${path}.ufiScoresAverage.ufiScoreHigherBound`,
      );
      if (lower > upper) {
        throw new ContractError(
          `${path}.ufiScoresAverage lower bound exceeds upper bound`,
        );
      }
    }
  }
  assertUnique(scores, (score) => score.name, "ratingScores");
  return scores;
}

function validateTopicFilters(value) {
  const filters = requiredObjectArray(value, "topicFilters");
  for (const [index, filter] of filters.entries()) {
    const path = `topicFilters[${index}]`;
    assertTypename(filter.__typename, "TopicFilter", `${path}.__typename`);
    requiredSourceId(filter.id, `${path}.id`);
    requiredString(filter.name, `${path}.name`);
    if (typeof filter.isSelected !== "boolean") {
      throw new ContractError(`${path}.isSelected must be a boolean`);
    }
    const translation = optionalObject(
      filter.translation,
      `${path}.translation`,
    );
    if (translation != null) {
      assertTypename(
        translation.__typename,
        "ReviewTopicTranslation",
        `${path}.translation.__typename`,
      );
      requiredSourceId(translation.id, `${path}.translation.id`);
      requiredString(translation.name, `${path}.translation.name`);
    }
  }
  assertUnique(filters, (filter) => String(filter.id), "topicFilters");
  return filters;
}

function validateCountFilter(
  value,
  {
    field,
    typename,
    allowEmptyValue = false,
    validateExtra = () => {},
  },
) {
  const filters = requiredObjectArray(value, field);
  for (const [index, filter] of filters.entries()) {
    const path = `${field}[${index}]`;
    assertTypename(filter.__typename, typename, `${path}.__typename`);
    requiredString(filter.name, `${path}.name`);
    requiredString(filter.value, `${path}.value`, {
      allowEmpty: allowEmptyValue,
    });
    requiredNonNegativeInteger(filter.count, `${path}.count`);
    validateExtra(filter, path);
  }
  assertUnique(filters, (filter) => filter.value, field);
  return filters;
}

function validateRoomTypeFilters(value) {
  const filters = optionalObjectArray(value, "roomTypeFilter", {
    nullValue: null,
  });
  if (filters == null) return null;
  for (const [index, filter] of filters.entries()) {
    const path = `roomTypeFilter[${index}]`;
    assertTypename(
      filter.__typename,
      "RoomTypeFilter",
      `${path}.__typename`,
    );
    requiredString(filter.name, `${path}.name`);
    requiredSourceId(filter.roomTypeId, `${path}.roomTypeId`);
    requiredNonNegativeInteger(filter.count, `${path}.count`);
    if (!Array.isArray(filter.roomIds)) {
      throw new ContractError(`${path}.roomIds must be an array`);
    }
    filter.roomIds.forEach((roomId, roomIndex) =>
      requiredSourceId(roomId, `${path}.roomIds[${roomIndex}]`),
    );
  }
  assertUnique(
    filters,
    (filter) => String(filter.roomTypeId),
    "roomTypeFilter",
  );
  return filters;
}

function validateSorters(value) {
  const sorters = requiredObjectArray(value, "sorters");
  for (const [index, sorter] of sorters.entries()) {
    const path = `sorters[${index}]`;
    assertTypename(sorter.__typename, "ReviewSorter", `${path}.__typename`);
    requiredString(sorter.name, `${path}.name`);
    requiredString(sorter.value, `${path}.value`);
  }
  assertUnique(sorters, (sorter) => sorter.value, "sorters");
  return sorters;
}

const TRUSTED_TOTAL_SOURCE_COUNT = 4;

function findTotal(filters, value, source) {
  const match = filters.find((filter) => filter.value === value);
  return match ? { source, count: match.count } : null;
}

function reviewTotalConsistency({
  reviewsCount,
  reviewScoreFilters,
  languageFilters,
  timeOfYearFilters,
  customerTypeFilters,
  unfiltered,
}) {
  const totals = [
    findTotal(
      reviewScoreFilters,
      "ALL",
      "reviewScoreFilter.ALL",
    ),
    findTotal(languageFilters, "", "languageFilter.empty"),
    findTotal(timeOfYearFilters, "ALL", "timeOfYearFilter.ALL"),
    findTotal(
      customerTypeFilters,
      "ALL",
      "customerTypeFilter.ALL",
    ),
  ].filter(Boolean);
  const disagreements = totals.filter(
    (total) => total.count !== reviewsCount,
  );
  return {
    evaluated: unfiltered,
    status: !unfiltered
      ? "not_evaluated_filtered"
      : totals.length === 0
        ? "unavailable"
        : disagreements.length === 0
          ? "consistent"
          : "inconsistent",
    reviewsCount,
    totals,
    disagreements,
  };
}

function requirePropertyKey(propertyKey) {
  if (typeof propertyKey !== "string" || propertyKey.trim() === "") {
    throw new ContractError("propertyKey is required");
  }
  return propertyKey;
}

function normalizePartnerReply(value) {
  if (value == null) return null;
  if (!isObject(value)) {
    throw new ContractError("partnerReply must be an object or null");
  }
  requireOwnKeys(
    value,
    PARTNER_REPLY_REQUIRED_KEYS,
    "partnerReply",
  );
  assertTypename(
    value.__typename,
    "PropertyReplyData",
    "partnerReply.__typename",
  );
  return nullableString(value.reply, "partnerReply.reply");
}

function validateBookingDetails(value) {
  const details = optionalObject(value, "bookingDetails");
  if (details == null) return null;
  requireOwnKeys(
    details,
    BOOKING_DETAILS_REQUIRED_KEYS,
    "bookingDetails",
  );
  assertTypename(
    details.__typename,
    "BookingDetails",
    "bookingDetails.__typename",
  );

  for (const key of [
    "customerType",
    "checkoutDate",
    "checkinDate",
    "stayStatus",
  ]) {
    nullableString(details[key], `bookingDetails.${key}`);
  }
  optionalNonNegativeInteger(details.roomId, "bookingDetails.roomId");
  optionalNonNegativeInteger(
    details.numNights,
    "bookingDetails.numNights",
  );

  const roomType = optionalObject(
    details.roomType,
    "bookingDetails.roomType",
  );
  if (roomType != null) {
    requireOwnKeys(
      roomType,
      ROOM_TYPE_REQUIRED_KEYS,
      "bookingDetails.roomType",
    );
    assertTypename(
      roomType.__typename,
      "RoomTranslation",
      "bookingDetails.roomType.__typename",
    );
    const roomTypeId = roomType.id;
    if (
      roomTypeId != null &&
      typeof roomTypeId !== "string" &&
      !Number.isSafeInteger(roomTypeId)
    ) {
      throw new ContractError(
        "bookingDetails.roomType.id must be a string, safe integer or null",
      );
    }
    nullableString(roomType.name, "bookingDetails.roomType.name");
  }
  return details;
}

function validateGuestDetails(value) {
  const details = optionalObject(value, "guestDetails");
  if (details == null) return null;
  requireOwnKeys(
    details,
    GUEST_DETAILS_REQUIRED_KEYS,
    "guestDetails",
  );
  assertTypename(
    details.__typename,
    "GuestDetails",
    "guestDetails.__typename",
  );

  for (const key of [
    "username",
    "avatarUrl",
    "countryCode",
    "countryName",
    "avatarColor",
    "guestTypeTranslation",
  ]) {
    nullableString(details[key], `guestDetails.${key}`);
  }
  optionalBoolean(details.showCountryFlag, "guestDetails.showCountryFlag");
  optionalBoolean(details.anonymous, "guestDetails.anonymous");
  const userReviewCount = optionalNonNegativeInteger(
    details.userReviewCount,
    "guestDetails.userReviewCount",
  );
  const joinedDate = optionalNonNegativeInteger(
    details.joinedDate,
    "guestDetails.joinedDate",
  );
  return {
    ...details,
    userReviewCount,
    joinedDate,
  };
}

function validateHighlights(value, path) {
  const highlights = optionalObjectArray(value, path);
  for (const [index, highlight] of highlights.entries()) {
    requireOwnKeys(highlight, ["start", "end"], `${path}[${index}]`);
    const start = optionalNonNegativeInteger(
      highlight.start,
      `${path}[${index}].start`,
    );
    const end = optionalNonNegativeInteger(
      highlight.end,
      `${path}[${index}].end`,
    );
    if (start == null || end == null) {
      throw new ContractError(
        `${path}[${index}] requires integer start and end`,
      );
    }
    if (end < start) {
      throw new ContractError(
        `${path}[${index}].end must not precede start`,
      );
    }
  }
  return highlights;
}

function validatePhotos(value) {
  const photos = optionalObjectArray(value, "photos");
  const normalizedPhotos = [];
  for (const [photoIndex, photo] of photos.entries()) {
    requireOwnKeys(
      photo,
      PHOTO_REQUIRED_KEYS,
      `photos[${photoIndex}]`,
    );
    assertTypename(
      photo.__typename,
      "ReviewPhoto",
      `photos[${photoIndex}].__typename`,
    );
    if (
      photo.id != null &&
      typeof photo.id !== "string" &&
      !Number.isSafeInteger(photo.id)
    ) {
      throw new ContractError(
        `photos[${photoIndex}].id must be a string, safe integer or null`,
      );
    }
    nullableString(photo.kind, `photos[${photoIndex}].kind`);
    const mlTagHighestProbability = nullableStringOrFiniteNumber(
      photo.mlTagHighestProbability,
      `photos[${photoIndex}].mlTagHighestProbability`,
    );
    const urls = requiredObjectArray(
      photo.urls,
      `photos[${photoIndex}].urls`,
    );
    const normalizedUrls = [];
    for (const [urlIndex, url] of urls.entries()) {
      const path = `photos[${photoIndex}].urls[${urlIndex}]`;
      requireOwnKeys(
        url,
        PHOTO_URL_REQUIRED_KEYS,
        path,
      );
      assertTypename(
        url.__typename,
        "ReviewPhotoUrl",
        `${path}.__typename`,
      );
      nullableString(
        url.size,
        `${path}.size`,
      );
      if (typeof url.url !== "string" || url.url.length === 0) {
        throw new ContractError(
          `${path}.url is required`,
        );
      }
      try {
        normalizedUrls.push({
          ...url,
          url: canonicalizeReviewPhotoUrl(url.url),
        });
      } catch (error) {
        if (!(error instanceof PhotoUrlParityError)) throw error;
        throw new ContractError(`${path}.url is invalid`, {
          cause: error.message,
        });
      }
    }
    normalizedPhotos.push({
      ...photo,
      mlTagHighestProbability,
      urls: normalizedUrls,
    });
  }
  return normalizedPhotos;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function normalizeReview(card, propertyKey) {
  requirePropertyKey(propertyKey);
  if (!isObject(card)) {
    throw new ContractError("reviewCard item must be an object");
  }
  if (card.__typename !== "ReviewCard") {
    throw new ContractError(
      `Unexpected reviewCard type: ${card.__typename}`,
    );
  }
  requireOwnKeys(card, REVIEW_CARD_REQUIRED_KEYS, "reviewCard");
  if (typeof card.reviewUrl !== "string" || card.reviewUrl.length === 0) {
    throw new ContractError("reviewUrl is required");
  }
  if (
    !Number.isSafeInteger(card.reviewedDate) ||
    card.reviewedDate <= 0
  ) {
    throw new ContractError(
      "reviewedDate must be a positive safe Unix timestamp",
    );
  }
  if (
    typeof card.reviewScore !== "number" ||
    !Number.isFinite(card.reviewScore) ||
    card.reviewScore < 0 ||
    card.reviewScore > 10
  ) {
    throw new ContractError("reviewScore must be between 0 and 10");
  }

  const text = card.textDetails;
  if (text != null && !isObject(text)) {
    throw new ContractError("textDetails must be an object or null");
  }
  if (text != null) {
    requireOwnKeys(text, TEXT_DETAILS_REQUIRED_KEYS, "textDetails");
    assertTypename(
      text.__typename,
      "TextDetails",
      "textDetails.__typename",
    );
  }
  const textTrivialFlag = optionalNonNegativeInteger(
    text?.textTrivialFlag,
    "textDetails.textTrivialFlag",
  );
  const helpfulVotesCount = optionalNonNegativeInteger(
    card.helpfulVotesCount,
    "helpfulVotesCount",
  );
  const isApproved = optionalBoolean(card.isApproved, "isApproved");
  const isTranslatable = optionalBoolean(
    card.isTranslatable,
    "isTranslatable",
  );

  const bookingDetails = validateBookingDetails(card.bookingDetails);
  const guestDetails = validateGuestDetails(card.guestDetails);
  const photos = validatePhotos(card.photos);
  const positiveHighlights = validateHighlights(
    card.positiveHighlights,
    "positiveHighlights",
  );
  const negativeHighlights = validateHighlights(
    card.negativeHighlights,
    "negativeHighlights",
  );
  const title = nullableString(text?.title, "textDetails.title");
  const positiveText = nullableString(
    text?.positiveText,
    "textDetails.positiveText",
  );
  const negativeText = nullableString(
    text?.negativeText,
    "textDetails.negativeText",
  );
  const partnerReply = normalizePartnerReply(card.partnerReply);
  let reviewedDateSydney;
  try {
    reviewedDateSydney = sydneyDateFromEpoch(card.reviewedDate);
  } catch (error) {
    throw new ContractError("reviewedDate is outside the supported range", {
      cause: error.message,
    });
  }
  const reviewedAtIso = new Date(card.reviewedDate * 1000).toISOString();

  return {
    sourceKey: `${propertyKey}:${card.reviewUrl}`,
    sourceReviewToken: card.reviewUrl,
    reviewedDateRaw: card.reviewedDate,
    reviewedAtIso,
    reviewedDateSydney,
    reviewScore: card.reviewScore,
    title,
    positiveText,
    negativeText,
    combinedText: [title, positiveText, negativeText]
      .filter(Boolean)
      .join("\n"),
    sourceLanguage: nullableString(text?.lang, "textDetails.lang"),
    textTrivialFlag,
    partnerReply,
    bookingDetails,
    guestDetails,
    photos,
    helpfulVotesCount,
    positiveHighlights,
    negativeHighlights,
    isApproved,
    isTranslatable,
    editUrl: nullableString(card.editUrl, "editUrl"),
    sourceCard: stableValue(card),
  };
}

export function contentHash(review) {
  const mutableContent = {
    title: review.title,
    positiveText: review.positiveText,
    negativeText: review.negativeText,
    sourceLanguage: review.sourceLanguage,
    textTrivialFlag: review.textTrivialFlag,
    partnerReply: review.partnerReply,
    photos: review.photos,
    positiveHighlights: review.positiveHighlights,
    negativeHighlights: review.negativeHighlights,
  };
  return createHash("sha256")
    .update(stableStringify(mutableContent))
    .digest("hex");
}

export function recordHash(review) {
  if (!isObject(review?.sourceCard)) {
    throw new ContractError("recordHash requires sourceCard");
  }
  let semanticSourceCard;
  try {
    semanticSourceCard = canonicalizeReviewSourceCardForParity(
      review.sourceCard,
    );
  } catch (error) {
    if (!(error instanceof PhotoUrlParityError)) throw error;
    throw new ContractError(
      "recordHash requires valid review photo URLs",
      { cause: error.message },
    );
  }
  return createHash("sha256")
    .update(stableStringify(semanticSourceCard))
    .digest("hex");
}

export function validateReviewListResponse(
  body,
  {
    propertyKey,
    skip = 0,
    limit = 10,
    unfiltered = false,
  } = {},
) {
  requirePropertyKey(propertyKey);
  if (typeof unfiltered !== "boolean") {
    throw new ContractError("unfiltered must be a boolean");
  }
  if (!Number.isSafeInteger(skip) || skip < 0) {
    throw new ContractError("skip must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new ContractError("limit must be a positive safe integer");
  }
  if (!isObject(body)) {
    throw new ContractError("Response body must be a JSON object");
  }
  if (body.errors != null && !Array.isArray(body.errors)) {
    throw new ContractError("GraphQL errors must be an array when present");
  }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    throw new ContractError("GraphQL returned errors", {
      errorCount: body.errors.length,
    });
  }

  const list = body?.data?.reviewListFrontend;
  if (!isObject(list)) {
    throw new ContractError("Missing data.reviewListFrontend");
  }
  if (list.__typename !== "ReviewListFrontendResult") {
    throw new ContractError(
      `Unexpected reviewListFrontend type: ${list.__typename}`,
    );
  }
  if (
    !Number.isSafeInteger(list.reviewsCount) ||
    list.reviewsCount < 0
  ) {
    throw new ContractError(
      "reviewsCount must be a non-negative safe integer",
    );
  }
  requiredObjectArray(list.reviewCard, "reviewCard");
  const ratingScores = validateRatingScores(list.ratingScores);
  const topicFilters = validateTopicFilters(list.topicFilters);
  const reviewScoreFilters = validateCountFilter(
    list.reviewScoreFilter,
    {
      field: "reviewScoreFilter",
      typename: "ReviewScoreFilter",
    },
  );
  const languageFilters = validateCountFilter(list.languageFilter, {
    field: "languageFilter",
    typename: "LanguageFilter",
    allowEmptyValue: true,
    validateExtra: (filter, path) =>
      nullableString(filter.countryFlag, `${path}.countryFlag`),
  });
  const timeOfYearFilters = validateCountFilter(
    list.timeOfYearFilter,
    {
      field: "timeOfYearFilter",
      typename: "TimeOfYearFilter",
    },
  );
  const customerTypeFilters = validateCountFilter(
    list.customerTypeFilter,
    {
      field: "customerTypeFilter",
      typename: "CustomerTypeFilter",
    },
  );
  const roomTypes = validateRoomTypeFilters(list.roomTypeFilter);
  const sorters = validateSorters(list.sorters);
  const totalConsistency = reviewTotalConsistency({
    reviewsCount: list.reviewsCount,
    reviewScoreFilters,
    languageFilters,
    timeOfYearFilters,
    customerTypeFilters,
    unfiltered,
  });
  if (totalConsistency.status === "inconsistent") {
    // Booking's aggregate filter counts can run slightly ahead of the
    // paginated inventory. Tolerate a small, consistently advertised gap so a
    // whole property is not rejected over the source's own rounding.
    const advertised = totalConsistency.totals[0]?.count;
    const advertisedAgrees =
      totalConsistency.totals.length === TRUSTED_TOTAL_SOURCE_COUNT &&
      totalConsistency.totals.every(
        ({ count }) => count === advertised,
      );
    const gap = advertisedAgrees ? advertised - list.reviewsCount : null;
    if (
      !unfiltered ||
      gap === null ||
      gap <= 0 ||
      gap > maxAllowedSourceGap(advertised)
    ) {
      throw new ContractError(
        "Unfiltered aggregate totals disagree with reviewsCount",
        { totalConsistency },
      );
    }
  }
  if (list.reviewCard.length > limit) {
    throw new ContractError("reviewCard exceeds requested limit");
  }
  if (skip === 0 && list.reviewsCount > 0 && list.reviewCard.length === 0) {
    throw new ContractError(
      "Non-zero review count with an empty first page",
    );
  }

  const reviews = list.reviewCard.map((card, index) => {
    try {
      const normalized = normalizeReview(card, propertyKey);
      return {
        ...normalized,
        contentHash: contentHash(normalized),
        recordHash: recordHash(normalized),
      };
    } catch (error) {
      if (error instanceof ContractError) {
        error.details = { ...error.details, cardIndex: index };
      }
      throw error;
    }
  });

  const uniqueKeys = new Set(reviews.map((review) => review.sourceKey));
  if (uniqueKeys.size !== reviews.length) {
    throw new ContractError("Duplicate review identity within one page");
  }

  return {
    reviewsCount: list.reviewsCount,
    cardCount: reviews.length,
    reviews,
    ratingScores,
    filters: {
      topics: topicFilters,
      reviewScores: reviewScoreFilters,
      languages: languageFilters,
      timeOfYear: timeOfYearFilters,
      customerTypes: customerTypeFilters,
      roomTypes,
    },
    sorters,
    totalConsistency,
    typename: list.__typename,
  };
}

export function classifyHttpBody({ status, contentType, text }) {
  if (status === 202) return { kind: "challenge" };
  if (status === 429) return { kind: "rate_limited" };
  if (status === 401 || status === 403) return { kind: "access_denied" };
  if (
    status === 408 ||
    status === 425 ||
    (status >= 500 && status <= 599)
  ) {
    return { kind: "temporary_server_error" };
  }
  if (
    Number.isInteger(status) &&
    (status < 200 || status >= 300)
  ) {
    return { kind: "http_error", status };
  }
  if (
    typeof contentType !== "string" ||
    !contentType.toLowerCase().includes("json")
  ) {
    return {
      kind: "unexpected_content",
      detail: "Response content type was not JSON",
    };
  }
  try {
    return { kind: "json", body: JSON.parse(text) };
  } catch {
    return { kind: "invalid_json" };
  }
}
