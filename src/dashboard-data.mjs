import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  mondayWeekStart,
  sydneyDateFromEpoch,
} from "./date-utils.mjs";
import {
  classifyReviewInsights,
  REVIEW_INSIGHT_TOPIC_DEFINITIONS,
  REVIEW_INSIGHTS_VERSION,
} from "./review-insights.mjs";
import {
  assertSourceGap,
  safeSourceDiscrepancyEvidence,
} from "./source-discrepancy.mjs";

export const DASHBOARD_CONTRACT_VERSION = 1;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_SENTIMENTS = new Set([
  "positive",
  "mixed",
  "negative",
  "unclassified",
]);
const ALLOWED_SORTS = new Set([
  "newest",
  "oldest",
  "highest",
  "lowest",
  "most_helpful",
]);
const TOPIC_LABELS = new Map(
  REVIEW_INSIGHT_TOPIC_DEFINITIONS.map(({ topic, label }) => [
    topic,
    label,
  ]),
);
const ALLOWED_TOPICS = new Set(TOPIC_LABELS.keys());

export class DashboardDataError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DashboardDataError";
    this.code = code;
    this.details = details;
  }
}

function safeStat(path) {
  try {
    const stat = statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

function databaseFingerprint(path) {
  return [
    safeStat(path),
    safeStat(`${path}-wal`),
    REVIEW_INSIGHTS_VERSION,
    DASHBOARD_CONTRACT_VERSION,
  ].join("|");
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function publicReviewId(propertyKey, sourceReviewToken) {
  return createHash("sha256")
    .update(`${propertyKey}:${sourceReviewToken}`)
    .digest("hex")
    .slice(0, 24);
}

function addDays(dateKey, days) {
  if (!DATE_KEY.test(dateKey)) {
    throw new DashboardDataError(
      "INVALID_DATE",
      "A date must use YYYY-MM-DD",
      { dateKey },
    );
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round(
    (Date.UTC(endYear, endMonth - 1, endDay) -
      Date.UTC(startYear, startMonth - 1, startDay)) /
      86_400_000,
  );
}

function reportingPeriod(
  query,
  today,
  { earliestAvailable = today, latestAvailable = today } = {},
) {
  if (!query.from && !query.to) {
    const start = mondayWeekStart(today);
    const end = today;
    return {
      kind: "current-week",
      start,
      end,
      previousStart: addDays(start, -7),
      previousEnd: addDays(end, -7),
    };
  }
  let start = query.from || earliestAvailable;
  let end =
    query.to ||
    (latestAvailable < today ? latestAvailable : today);
  if (start > end) {
    if (query.from && !query.to) end = start;
    else if (!query.from && query.to) start = end;
  }
  const lengthDays = daysBetween(start, end) + 1;
  const previousEnd = addDays(start, -1);
  return {
    kind: "custom",
    start,
    end,
    previousStart: addDays(previousEnd, -(lengthDays - 1)),
    previousEnd,
  };
}

function compareDate(left, right) {
  return left.localeCompare(right);
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentage(numerator, denominator) {
  return denominator === 0 ? null : (numerator / denominator) * 100;
}

function delta(current, previous) {
  return current == null || previous == null ? null : current - previous;
}

function direction(value) {
  if (value == null) return "unavailable";
  if (Math.abs(value) < 0.0001) return "flat";
  return value > 0 ? "up" : "down";
}

function clampInteger(value, min, max, fallback) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function clampNumber(value, min, max, fallback) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function listParameter(search, name) {
  const value = search.get(name);
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function dateParameter(search, name) {
  const value = search.get(name) ?? "";
  if (!value) return "";
  if (!DATE_KEY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DashboardDataError(
      "INVALID_QUERY",
      `${name} must be a valid YYYY-MM-DD date`,
    );
  }
  return value;
}

function enumList(search, name, allowed) {
  const values = listParameter(search, name);
  const invalid = values.filter((value) => !allowed.has(value));
  if (invalid.length > 0) {
    throw new DashboardDataError(
      "INVALID_QUERY",
      `${name} contains an unsupported value`,
      { invalid },
    );
  }
  return values;
}

export function parseDashboardQuery(search) {
  if (!(search instanceof URLSearchParams)) {
    throw new TypeError("search must be URLSearchParams");
  }
  const from = dateParameter(search, "from");
  const to = dateParameter(search, "to");
  const reviewFrom = dateParameter(search, "reviewFrom");
  const reviewTo = dateParameter(search, "reviewTo");
  if (from && to && from > to) {
    throw new DashboardDataError(
      "INVALID_QUERY",
      "from must not be after to",
    );
  }
  if (reviewFrom && reviewTo && reviewFrom > reviewTo) {
    throw new DashboardDataError(
      "INVALID_QUERY",
      "reviewFrom must not be after reviewTo",
    );
  }
  const reviewSort = search.get("reviewSort") ?? "newest";
  if (!ALLOWED_SORTS.has(reviewSort)) {
    throw new DashboardDataError(
      "INVALID_QUERY",
      "reviewSort is unsupported",
    );
  }
  const minScore = clampNumber(
    search.get("reviewMinScore"),
    0,
    10,
    0,
  );
  const maxScore = clampNumber(
    search.get("reviewMaxScore"),
    0,
    10,
    10,
  );
  if (minScore > maxScore) {
    throw new DashboardDataError(
      "INVALID_QUERY",
      "reviewMinScore must not exceed reviewMaxScore",
    );
  }
  return {
    properties: listParameter(search, "properties"),
    from,
    to,
    review: {
      page: clampInteger(search.get("reviewPage"), 1, 100_000, 1),
      pageSize: clampInteger(search.get("reviewPageSize"), 5, 100, 20),
      query: (search.get("reviewQuery") ?? "").trim().slice(0, 200),
      properties: listParameter(search, "reviewProperties"),
      from: reviewFrom,
      to: reviewTo,
      minScore,
      maxScore,
      sentiments: enumList(
        search,
        "reviewSentiments",
        ALLOWED_SENTIMENTS,
      ),
      topics: enumList(search, "reviewTopics", ALLOWED_TOPICS),
      language: (search.get("reviewLanguage") ?? "").trim().slice(0, 60),
      guestType: (search.get("reviewGuestType") ?? "").trim().slice(0, 100),
      roomType: (search.get("reviewRoomType") ?? "").trim().slice(0, 180),
      sort: reviewSort,
    },
  };
}

function sanitizeEvidence(topic) {
  return {
    topic: topic.topic,
    label: TOPIC_LABELS.get(topic.topic) ?? topic.topic,
    polarity: topic.polarity,
    evidence: topic.matchedTerms,
  };
}

function humanize(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value
    .trim()
    .replaceAll("_", " ")
    .toLocaleLowerCase("en")
    .replace(/\b\p{L}/gu, (character) =>
      character.toLocaleUpperCase("en"),
    );
}

function normalizeReview(row) {
  const booking = parseJson(row.booking_details_json, null);
  const guest = parseJson(row.guest_details_json, null);
  const score = row.score_tenths / 10;
  const analysis = classifyReviewInsights({
    score,
    title: row.title,
    positiveText: row.positive_text,
    negativeText: row.negative_text,
  });
  return {
    reviewId: publicReviewId(
      row.property_key,
      row.source_review_token,
    ),
    propertyKey: row.property_key,
    propertyName: row.business_name,
    reviewedLocalDate: row.reviewed_local_date,
    reviewedEpoch: row.reviewed_epoch,
    score,
    title: row.title,
    positiveText: row.positive_text,
    negativeText: row.negative_text,
    partnerReply: row.partner_reply,
    sourceLanguage: row.source_language,
    helpfulVotesCount: row.helpful_votes_count,
    sentiment: analysis.sentiment,
    sentimentReason: analysis.sentimentReason,
    hasNegativeFeedback:
      analysis.sentiment === "negative" ||
      analysis.sentimentEvidence.negativeText.substantive,
    topics: analysis.topics.map(sanitizeEvidence),
    guest: guest
      ? {
          username: guest.username ?? null,
          countryName: guest.countryName ?? null,
          guestType: guest.guestTypeTranslation ?? null,
        }
      : null,
    stay: booking
      ? {
          roomName: booking.roomType?.name ?? null,
          customerType: humanize(booking.customerType),
          numNights:
            Number.isInteger(booking.numNights) && booking.numNights >= 0
              ? booking.numNights
              : null,
          checkinDate: booking.checkinDate ?? null,
          checkoutDate: booking.checkoutDate ?? null,
        }
      : null,
  };
}

function validatePropertyEvidence(property, presentCount) {
  if (!property.published_run_id) {
    return {
      status: "collecting",
      sourceDiscrepancy: null,
      evidenceError: null,
    };
  }

  const inventoriesMatch =
    property.oldest_unique_count === property.newest_unique_count &&
    property.oldest_identity_sha256 === property.newest_identity_sha256;
  const recordsMatch =
    property.oldest_records_sha256 === property.newest_records_sha256;
  if (!inventoriesMatch || !recordsMatch) {
    return {
      status: "evidence-error",
      sourceDiscrepancy: null,
      evidenceError:
        "The published inventory or semantic-record attestations do not match.",
    };
  }

  const attestationPresent =
    property.discrepancy_contract_kind != null ||
    property.discrepancy_contract_version != null;
  if (attestationPresent) {
    try {
      const advertisedScoreBuckets = parseJson(
        property.discrepancy_advertised_score_buckets_json,
        null,
      );
      const retrievableScoreBuckets = parseJson(
        property.discrepancy_retrievable_score_buckets_json,
        null,
      );
      const normalized = assertSourceGap({
        propertyKey: property.discrepancy_property_key,
        bookingHotelId: property.discrepancy_booking_hotel_id,
        advertisedReviewCount:
          property.discrepancy_advertised_review_count,
        retrievableReviewCount:
          property.discrepancy_retrievable_review_count,
        advertisedScoreBuckets,
        retrievableScoreBuckets,
        contractKind: property.discrepancy_contract_kind,
      });
      const countEvidenceMatches =
        property.discrepancy_contract_version ===
          normalized.contractVersion &&
        property.discrepancy_gap_count === normalized.gapCount &&
        property.discrepancy_score_bucket ===
          normalized.scoreBucketGap.value &&
        property.discrepancy_advertised_bucket_count ===
          normalized.scoreBucketGap.advertisedCount &&
        property.discrepancy_retrievable_bucket_count ===
          normalized.scoreBucketGap.retrievableCount &&
        property.property_key === normalized.propertyKey &&
        property.booking_hotel_id === normalized.bookingHotelId &&
        property.displayed_review_count ===
          normalized.advertisedReviewCount &&
        property.source_count_final ===
          normalized.retrievableReviewCount &&
        property.structured_review_count ===
          normalized.retrievableReviewCount &&
        presentCount === normalized.retrievableReviewCount;
      if (!countEvidenceMatches) {
        throw new Error(
          "The stored source-gap attestation does not reconcile with the published property counts.",
        );
      }
      return {
        status: "source-gap",
        sourceDiscrepancy: safeSourceDiscrepancyEvidence(normalized),
        evidenceError: null,
      };
    } catch (error) {
      return {
        status: "evidence-error",
        sourceDiscrepancy: null,
        evidenceError:
          error instanceof Error
            ? error.message
            : "The stored source-gap attestation is invalid.",
      };
    }
  }

  const expected = property.displayed_review_count;
  const exactCounts =
    expected != null &&
    property.source_count_final === expected &&
    property.structured_review_count === expected &&
    property.displayed_review_count === expected &&
    presentCount === expected;
  return exactCounts
    ? {
        status: "verified",
        sourceDiscrepancy: null,
        evidenceError: null,
      }
    : {
        status: "evidence-error",
        sourceDiscrepancy: null,
        evidenceError:
          "Advertised, structured, and published counts do not reconcile, and no valid known-source attestation exists.",
      };
}

function normalizeCategoryScores(value) {
  const rows = parseJson(value, []);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row) =>
        row &&
        typeof row === "object" &&
        typeof row.value === "number" &&
        Number.isFinite(row.value),
    )
    .map((row) => ({
      name:
        typeof row.translation === "string" && row.translation.trim()
          ? row.translation
          : typeof row.name === "string" && row.name.trim()
            ? humanize(row.name)
            : "Category",
      score: row.value,
    }));
}

function loadDataset(dbPath, propertiesPath) {
  const configured = JSON.parse(readFileSync(propertiesPath, "utf8"));
  const configuredByKey = new Map(
    configured.map((property) => [property.key, property]),
  );
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;");
    const integrity = db.prepare("PRAGMA integrity_check").all();
    const properties = db
      .prepare(
        `SELECT
           p.property_id, p.property_key, p.business_name,
           p.booking_hotel_id, p.booking_name,
           pp.last_successful_run_id AS published_run_id,
           pp.generation AS publication_generation,
           pp.published_at_utc,
           sr.parser_version,
           sr.source_count_final,
           ps.structured_review_count,
           ps.displayed_review_count,
           ps.displayed_score_tenths,
           ps.rating_scores_json,
           fia.oldest_unique_count,
           fia.newest_unique_count,
           fia.oldest_identity_sha256,
           fia.newest_identity_sha256,
           fia.oldest_records_sha256,
           fia.newest_records_sha256,
           sda.contract_version AS discrepancy_contract_version,
           sda.contract_kind AS discrepancy_contract_kind,
           sda.property_key AS discrepancy_property_key,
           sda.booking_hotel_id AS discrepancy_booking_hotel_id,
           sda.advertised_review_count
             AS discrepancy_advertised_review_count,
           sda.retrievable_review_count
             AS discrepancy_retrievable_review_count,
           sda.gap_count AS discrepancy_gap_count,
           sda.score_bucket AS discrepancy_score_bucket,
           sda.advertised_bucket_count
             AS discrepancy_advertised_bucket_count,
           sda.retrievable_bucket_count
             AS discrepancy_retrievable_bucket_count,
           sda.advertised_score_buckets_json
             AS discrepancy_advertised_score_buckets_json,
           sda.retrievable_score_buckets_json
             AS discrepancy_retrievable_score_buckets_json
         FROM properties p
         LEFT JOIN property_publications pp
           ON pp.property_id = p.property_id
         LEFT JOIN scrape_runs sr
           ON sr.run_id = pp.last_successful_run_id
         LEFT JOIN property_snapshots ps
           ON ps.run_id = pp.last_successful_run_id
          LEFT JOIN full_inventory_attestations fia
            ON fia.run_id = pp.last_successful_run_id
         LEFT JOIN source_discrepancy_attestations sda
           ON sda.run_id = pp.last_successful_run_id
         WHERE p.enabled = 1
         ORDER BY p.property_id`,
      )
      .all()
      .map((row) => {
        const config = configuredByKey.get(row.property_key);
        return {
          ...row,
          config_visible_review_count: config?.visibleReviewCount ?? null,
          config_hotel_score: config?.hotelScore ?? null,
          categoryScores: normalizeCategoryScores(row.rating_scores_json),
        };
      });
    const rows = db
      .prepare(
        `SELECT
           p.property_key, p.business_name,
           r.source_review_token,
           v.reviewed_epoch, v.reviewed_local_date, v.score_tenths,
           v.title, v.positive_text, v.negative_text,
           v.source_language, v.partner_reply, v.helpful_votes_count,
           v.booking_details_json, v.guest_details_json
         FROM property_publications pp
         JOIN properties p ON p.property_id = pp.property_id
         JOIN reviews r
           ON r.property_id = p.property_id
          AND r.presence_state = 'present'
         JOIN review_versions v
           ON v.review_id = r.review_id
          AND v.is_current = 1
         ORDER BY v.reviewed_epoch DESC, r.review_id`,
      )
      .all();
    const reviews = rows.map(normalizeReview);
    const countByProperty = new Map();
    for (const review of reviews) {
      countByProperty.set(
        review.propertyKey,
        (countByProperty.get(review.propertyKey) ?? 0) + 1,
      );
    }
    const storedByKey = new Map(
      properties.map((property) => [property.property_key, property]),
    );
    const normalizedProperties = configured.map((config) => {
      const property = storedByKey.get(config.key) ?? {
        property_id: null,
        property_key: config.key,
        business_name: config.businessName,
        booking_hotel_id: config.hotelId,
        booking_name: config.bookingName,
        published_run_id: null,
        publication_generation: null,
        published_at_utc: null,
        parser_version: null,
        source_count_final: null,
        structured_review_count: null,
        displayed_review_count: null,
        displayed_score_tenths: null,
        rating_scores_json: null,
        oldest_unique_count: null,
        newest_unique_count: null,
        oldest_identity_sha256: null,
        newest_identity_sha256: null,
        oldest_records_sha256: null,
        newest_records_sha256: null,
        discrepancy_contract_version: null,
        discrepancy_contract_kind: null,
        discrepancy_property_key: null,
        discrepancy_booking_hotel_id: null,
        discrepancy_advertised_review_count: null,
        discrepancy_retrievable_review_count: null,
        discrepancy_gap_count: null,
        discrepancy_score_bucket: null,
        discrepancy_advertised_bucket_count: null,
        discrepancy_retrievable_bucket_count: null,
        discrepancy_advertised_score_buckets_json: null,
        discrepancy_retrievable_score_buckets_json: null,
        categoryScores: [],
        config_visible_review_count: config.visibleReviewCount,
        config_hotel_score: config.hotelScore,
      };
      const presentCount = countByProperty.get(property.property_key) ?? 0;
      const evidence = validatePropertyEvidence(property, presentCount);
      return {
        ...property,
        presentCount,
        ...evidence,
      };
    });
    return {
      properties: normalizedProperties,
      reviews,
      databaseIntegrity:
        integrity.length === 1 && integrity[0].integrity_check === "ok"
          ? "ok"
          : "error",
    };
  } finally {
    db.close();
  }
}

function matchesDate(review, from, to) {
  return (
    (!from || compareDate(review.reviewedLocalDate, from) >= 0) &&
    (!to || compareDate(review.reviewedLocalDate, to) <= 0)
  );
}

function filterGlobal(reviews, query) {
  const propertySet = new Set(query.properties);
  return reviews.filter(
    (review) =>
      (propertySet.size === 0 || propertySet.has(review.propertyKey)) &&
      matchesDate(review, query.from, query.to),
  );
}

function filterProperties(reviews, propertyKeys) {
  const propertySet = new Set(propertyKeys);
  if (propertySet.size === 0) return reviews;
  return reviews.filter((review) => propertySet.has(review.propertyKey));
}

function periodReviews(reviews, start, end) {
  return reviews.filter((review) =>
    matchesDate(review, start, end),
  );
}

function periodMetric(reviews, start, end) {
  const positiveCount = reviews.filter(
    (review) => review.sentiment === "positive",
  ).length;
  const mixedCount = reviews.filter(
    (review) => review.sentiment === "mixed",
  ).length;
  const negativeCount = reviews.filter(
    (review) => review.sentiment === "negative",
  ).length;
  const unclassifiedCount = reviews.filter(
    (review) => review.sentiment === "unclassified",
  ).length;
  return {
    start,
    end,
    average: average(reviews.map((review) => review.score)),
    reviewCount: reviews.length,
    positiveCount,
    mixedCount,
    negativeCount,
    negativeFeedbackCount: reviews.filter(
      (review) => review.hasNegativeFeedback,
    ).length,
    unclassifiedCount,
    responseCount: reviews.filter((review) => review.partnerReply).length,
  };
}

function comparison(current, previous) {
  const valueDelta = delta(current, previous);
  return {
    current,
    previous,
    delta: valueDelta,
    direction: direction(valueDelta),
  };
}

function weeklyTrend(reviews, query, today) {
  const anchor = mondayWeekStart(query.to || today);
  let start = addDays(anchor, -77);
  if (query.from) {
    const requestedStart = mondayWeekStart(query.from);
    if (requestedStart > start) start = requestedStart;
  }
  const points = [];
  for (let week = start, guard = 0; week <= anchor && guard < 53; guard += 1) {
    const scheduledEnd = addDays(week, 6);
    const end = scheduledEnd > today ? today : scheduledEnd;
    const rows = periodReviews(reviews, week, end);
    const negative = rows.filter(
      (review) => review.sentiment === "negative",
    ).length;
    const positive = rows.filter(
      (review) => review.sentiment === "positive",
    ).length;
    const mixed = rows.filter(
      (review) => review.sentiment === "mixed",
    ).length;
    const unclassified = rows.filter(
      (review) => review.sentiment === "unclassified",
    ).length;
    points.push({
      periodStart: week,
      periodEnd: end,
      isPartial: end < scheduledEnd,
      label: week.slice(5),
      average: average(rows.map((review) => review.score)),
      reviewCount: rows.length,
      positiveShare: percentage(positive, rows.length),
      mixedShare: percentage(mixed, rows.length),
      negativeShare: percentage(negative, rows.length),
      unclassifiedShare: percentage(unclassified, rows.length),
      responseRate: percentage(
        rows.filter((review) => review.partnerReply).length,
        rows.length,
      ),
    });
    week = addDays(week, 7);
  }
  return points;
}

function scoreDistribution(reviews) {
  const buckets = [
    { label: "9–10", min: 9, max: 10.0001 },
    { label: "7–8.9", min: 7, max: 9 },
    { label: "5–6.9", min: 5, max: 7 },
    { label: "3–4.9", min: 3, max: 5 },
    { label: "0–2.9", min: 0, max: 3 },
  ];
  return buckets.map((bucket) => {
    const count = reviews.filter(
      (review) =>
        review.score >= bucket.min && review.score < bucket.max,
    ).length;
    return {
      ...bucket,
      max: Math.min(10, bucket.max),
      count,
      share: percentage(count, reviews.length) ?? 0,
    };
  });
}

function topicMetrics(globalReviews, currentRows, previousRows, properties) {
  const currentNegative = currentRows.filter(
    (review) => review.hasNegativeFeedback,
  );
  const previousNegative = previousRows.filter(
    (review) => review.hasNegativeFeedback,
  );
  return REVIEW_INSIGHT_TOPIC_DEFINITIONS.map(({ topic, label }) => {
    const hasNegativeTopic = (review) =>
      review.topics.some(
        (match) =>
          match.topic === topic &&
          (match.polarity === "negative" || match.polarity === "mixed"),
      );
    const currentMatches = currentNegative.filter(hasNegativeTopic);
    const previousMatches = previousNegative.filter(hasNegativeTopic);
    const currentShare = percentage(
      currentMatches.length,
      currentNegative.length,
    );
    const previousShare = percentage(
      previousMatches.length,
      previousNegative.length,
    );
    const shareDelta = delta(currentShare, previousShare);
    const allMatches = globalReviews.filter((review) =>
      review.topics.some((match) => match.topic === topic),
    );
    const propertyCounts = new Map();
    for (const review of currentMatches) {
      propertyCounts.set(
        review.propertyKey,
        (propertyCounts.get(review.propertyKey) ?? 0) + 1,
      );
    }
    const leadingKey = [...propertyCounts.entries()].sort(
      (left, right) => right[1] - left[1],
    )[0]?.[0];
    const leadingProperty = properties.find(
      (property) => property.property_key === leadingKey,
    );
    return {
      topic,
      label,
      description: `Reviews explicitly mentioning ${label.toLocaleLowerCase(
        "en",
      )} among feedback with a substantive negative channel or a negative score, based on versioned phrase rules.`,
      negativeMentionCount: currentMatches.length,
      negativeMentionShare: currentShare,
      previousNegativeMentionShare: previousShare,
      shareDelta,
      allMentionCount: allMatches.length,
      affectedPropertyCount: new Set(
        currentMatches.map((review) => review.propertyKey),
      ).size,
      leadingPropertyName: leadingProperty?.business_name ?? null,
      trend:
        shareDelta == null
          ? "unavailable"
          : shareDelta > 2
            ? "worsening"
            : shareDelta < -2
              ? "improving"
              : "stable",
    };
  });
}

function propertyMetrics(
  dataset,
  propertyScopedReviews,
  currentStart,
  currentEnd,
  previousStart,
  previousEnd,
  selectedPropertyKeys,
) {
  const selected = new Set(selectedPropertyKeys);
  return dataset.properties
    .filter(
      (property) =>
        selected.size === 0 || selected.has(property.property_key),
    )
    .map((property) => {
    const all = propertyScopedReviews.filter(
      (review) => review.propertyKey === property.property_key,
    );
    const current = periodReviews(all, currentStart, currentEnd);
    const previous = periodReviews(all, previousStart, previousEnd);
    const currentAverage = average(current.map((review) => review.score));
    const previousAverage = average(previous.map((review) => review.score));
    const negativeCount = current.filter(
      (review) => review.sentiment === "negative",
    ).length;
    const negativeTopicCounts = new Map();
    for (const review of current) {
      if (!review.hasNegativeFeedback) continue;
      for (const match of review.topics) {
        if (match.polarity !== "negative" && match.polarity !== "mixed") {
          continue;
        }
        negativeTopicCounts.set(
          match.topic,
          (negativeTopicCounts.get(match.topic) ?? 0) + 1,
        );
      }
    }
    const topTopicKey = [...negativeTopicCounts.entries()].sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0]?.[0];
    return {
      propertyKey: property.property_key,
      propertyName: property.business_name,
      bookingHotelId: property.booking_hotel_id,
      publishedReviewCount: property.presentCount,
      averageScore: average(all.map((review) => review.score)),
      currentWeekAverage: currentAverage,
      previousWeekAverage: previousAverage,
      weekDelta: delta(currentAverage, previousAverage),
      currentWeekCount: current.length,
      negativeShare: percentage(negativeCount, current.length),
      responseRate: percentage(
        current.filter((review) => review.partnerReply).length,
        current.length,
      ),
      topNegativeTopic: topTopicKey
        ? (TOPIC_LABELS.get(topTopicKey) ?? topTopicKey)
        : null,
      lastReviewedLocalDate:
        all.reduce(
          (latest, review) =>
            !latest || review.reviewedLocalDate > latest
              ? review.reviewedLocalDate
              : latest,
          null,
        ) ?? null,
      categoryScores: property.categoryScores,
      status: property.status,
    };
  });
}

function attentionItems(propertyRows, topics, qualityRows) {
  const items = [];
  const worseningProperty = [...propertyRows]
    .filter((property) => property.weekDelta != null)
    .sort((left, right) => left.weekDelta - right.weekDelta)[0];
  if (worseningProperty && worseningProperty.weekDelta <= -0.3) {
    items.push({
      id: `rating:${worseningProperty.propertyKey}`,
      severity:
        worseningProperty.weekDelta <= -1 ? "high" : "medium",
      title: `${worseningProperty.propertyName} rating declined`,
      detail: `The current-week average is ${Math.abs(
        worseningProperty.weekDelta,
      ).toFixed(1)} points below the previous week.`,
      propertyKey: worseningProperty.propertyKey,
      reviewCount: worseningProperty.currentWeekCount,
    });
  }
  const topTopic = [...topics]
    .filter((topic) => topic.negativeMentionShare != null)
    .sort(
      (left, right) =>
        right.negativeMentionShare - left.negativeMentionShare,
    )[0];
  if (topTopic && topTopic.negativeMentionShare >= 20) {
    items.push({
      id: `topic:${topTopic.topic}`,
      severity:
        topTopic.negativeMentionShare >= 40 ? "high" : "medium",
      title: `${topTopic.label} is a recurring negative theme`,
      detail: `${topTopic.negativeMentionShare.toFixed(
        0,
      )}% of reviews containing negative feedback this week mention this topic.`,
      topic: topTopic.topic,
      reviewCount: topTopic.negativeMentionCount,
    });
  }
  for (const property of qualityRows.filter(
    (row) => row.status === "source-gap",
  )) {
    items.push({
      id: `quality:${property.propertyKey}`,
      severity: "low",
      title: `${property.propertyName} has a disclosed source gap`,
      detail: property.note,
      propertyKey: property.propertyKey,
    });
  }
  for (const property of qualityRows.filter(
    (row) => row.status === "evidence-error",
  )) {
    items.push({
      id: `quality-error:${property.propertyKey}`,
      severity: "high",
      title: `${property.propertyName} evidence needs attention`,
      detail: property.note,
      propertyKey: property.propertyKey,
    });
  }
  return items.slice(0, 4);
}

function qualityProperties(dataset) {
  return dataset.properties.map((property) => {
    const advertised = property.published_run_id
      ? property.displayed_review_count
      : null;
    const retrievable = property.published_run_id
      ? property.presentCount
      : null;
    const sourceGap =
      advertised != null && retrievable != null
        ? advertised - retrievable
        : 0;
    return {
      propertyKey: property.property_key,
      propertyName: property.business_name,
      status: property.status,
      retrievableCount: retrievable,
      advertisedCount: advertised,
      sourceGap,
      publicationGeneration: property.publication_generation ?? null,
      parserVersion: property.parser_version ?? null,
      publishedAtUtc: property.published_at_utc ?? null,
      inventoriesMatch: property.published_run_id
        ? property.oldest_unique_count === property.newest_unique_count &&
          property.oldest_identity_sha256 ===
            property.newest_identity_sha256
        : null,
      recordsMatch: property.published_run_id
        ? property.oldest_records_sha256 ===
          property.newest_records_sha256
        : null,
      sourceDiscrepancy: property.sourceDiscrepancy,
      note:
        property.status === "verified"
          ? "Advertised count, retrievable inventory, identities, and semantic records agree."
          : property.status === "source-gap"
            ? `${sourceGap} review is advertised but not returned by Booking's structured list. The exact stored exception evidence passed; no review was invented.`
            : property.status === "evidence-error"
              ? property.evidenceError
            : "No accepted full publication is available yet.",
    };
  });
}

function reviewSearchText(review) {
  return [
    review.propertyName,
    review.title,
    review.positiveText,
    review.negativeText,
    review.guest?.countryName,
    review.guest?.guestType,
    review.stay?.roomName,
    review.stay?.customerType,
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase("en");
}

function reviewPage(dataset, query) {
  const propertySet = new Set(query.properties);
  const sentimentSet = new Set(query.sentiments);
  const topicSet = new Set(query.topics);
  const needle = query.query.toLocaleLowerCase("en");
  let rows = dataset.reviews.filter((review) => {
    const topics = new Set(review.topics.map((topic) => topic.topic));
    return (
      (propertySet.size === 0 || propertySet.has(review.propertyKey)) &&
      matchesDate(review, query.from, query.to) &&
      review.score >= query.minScore &&
      review.score <= query.maxScore &&
      (sentimentSet.size === 0 || sentimentSet.has(review.sentiment)) &&
      (topicSet.size === 0 ||
        [...topicSet].every((topic) => topics.has(topic))) &&
      (!query.language || review.sourceLanguage === query.language) &&
      (!query.guestType || review.guest?.guestType === query.guestType) &&
      (!query.roomType || review.stay?.roomName === query.roomType) &&
      (!needle || reviewSearchText(review).includes(needle))
    );
  });
  const sorters = {
    newest: (left, right) =>
      right.reviewedEpoch - left.reviewedEpoch ||
      left.reviewId.localeCompare(right.reviewId),
    oldest: (left, right) =>
      left.reviewedEpoch - right.reviewedEpoch ||
      left.reviewId.localeCompare(right.reviewId),
    highest: (left, right) =>
      right.score - left.score ||
      right.reviewedEpoch - left.reviewedEpoch,
    lowest: (left, right) =>
      left.score - right.score ||
      right.reviewedEpoch - left.reviewedEpoch,
    most_helpful: (left, right) =>
      (right.helpfulVotesCount ?? 0) -
        (left.helpfulVotesCount ?? 0) ||
      right.reviewedEpoch - left.reviewedEpoch,
  };
  rows = rows.sort(sorters[query.sort]);
  const total = rows.length;
  const pageCount = Math.ceil(total / query.pageSize);
  const page = Math.min(query.page, Math.max(1, pageCount));
  const offset = (page - 1) * query.pageSize;
  return {
    page,
    pageSize: query.pageSize,
    total,
    pageCount,
    items: rows.slice(offset, offset + query.pageSize).map(
      ({
        reviewedEpoch: _reviewedEpoch,
        hasNegativeFeedback: _hasNegativeFeedback,
        ...review
      }) => review,
    ),
  };
}

function filterOptions(dataset) {
  const values = (selector) =>
    [
      ...new Set(
        dataset.reviews
          .map(selector)
          .filter(
            (value) =>
              typeof value === "string" && value.trim().length > 0,
          ),
      ),
    ].sort((left, right) => left.localeCompare(right));
  const dates = dataset.reviews
    .map((review) => review.reviewedLocalDate)
    .sort();
  return {
    properties: dataset.properties.map((property) => ({
      propertyKey: property.property_key,
      propertyName: property.business_name,
      status: property.status,
    })),
    dateBounds: {
      min: dates[0] ?? null,
      max: dates.at(-1) ?? null,
    },
    topics: REVIEW_INSIGHT_TOPIC_DEFINITIONS,
    languages: values((review) => review.sourceLanguage),
    guestTypes: values((review) => review.guest?.guestType),
    roomTypes: values((review) => review.stay?.roomName),
  };
}

export function createDashboardDataService({
  dbPath,
  propertiesPath,
  now = () => new Date(),
}) {
  if (!dbPath || !propertiesPath) {
    throw new TypeError("dbPath and propertiesPath are required");
  }
  let cachedFingerprint = null;
  let cachedDataset = null;

  function dataset() {
    const fingerprint = databaseFingerprint(dbPath);
    if (!cachedDataset || cachedFingerprint !== fingerprint) {
      cachedDataset = loadDataset(dbPath, propertiesPath);
      cachedFingerprint = fingerprint;
    }
    return cachedDataset;
  }

  return {
    build(search = new URLSearchParams()) {
      const query = parseDashboardQuery(search);
      const currentDataset = dataset();
      const requestedKeys = [
        ...new Set([...query.properties, ...query.review.properties]),
      ];
      const knownKeys = new Set(
        currentDataset.properties.map(
          (property) => property.property_key,
        ),
      );
      const unknown = requestedKeys.filter((key) => !knownKeys.has(key));
      if (unknown.length > 0) {
        throw new DashboardDataError(
          "INVALID_QUERY",
          "A requested property is not configured",
          { unknown },
        );
      }
      const date = now();
      if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
        throw new TypeError("now must return a valid Date");
      }
      const today = sydneyDateFromEpoch(
        Math.max(1, Math.floor(date.getTime() / 1000)),
      );
      const availableDates = currentDataset.reviews
        .map((review) => review.reviewedLocalDate)
        .sort();
      const period = reportingPeriod(query, today, {
        earliestAvailable: availableDates[0] ?? today,
        latestAvailable: availableDates.at(-1) ?? today,
      });
      const currentStart = period.start;
      const currentEnd = period.end;
      const previousStart = period.previousStart;
      const previousEnd = period.previousEnd;
      const propertyScopedReviews = filterProperties(
        currentDataset.reviews,
        query.properties,
      );
      const globalReviews = filterGlobal(currentDataset.reviews, query);
      const currentRows = periodReviews(
        propertyScopedReviews,
        currentStart,
        currentEnd,
      );
      const previousRows = periodReviews(
        propertyScopedReviews,
        previousStart,
        previousEnd,
      );
      const currentMetric = periodMetric(
        currentRows,
        currentStart,
        currentEnd,
      );
      const previousMetric = periodMetric(
        previousRows,
        previousStart,
        previousEnd,
      );
      const currentNegativeShare = percentage(
        currentMetric.negativeCount,
        currentMetric.reviewCount,
      );
      const previousNegativeShare = percentage(
        previousMetric.negativeCount,
        previousMetric.reviewCount,
      );
      const currentResponseRate = percentage(
        currentMetric.responseCount,
        currentMetric.reviewCount,
      );
      const previousResponseRate = percentage(
        previousMetric.responseCount,
        previousMetric.reviewCount,
      );
      const topics = topicMetrics(
        globalReviews,
        currentRows,
        previousRows,
        currentDataset.properties,
      );
      const properties = propertyMetrics(
        currentDataset,
        propertyScopedReviews,
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        query.properties,
      );
      const qualityRows = qualityProperties(currentDataset);
      const latestDate =
        globalReviews.reduce(
          (latest, review) =>
            !latest || review.reviewedLocalDate > latest
              ? review.reviewedLocalDate
              : latest,
          null,
        ) ?? null;
      const hasUnpublished = qualityRows.some(
        (property) => property.status === "collecting",
      );
      const hasGap = qualityRows.some(
        (property) => property.status === "source-gap",
      );
      const hasEvidenceError = qualityRows.some(
        (property) => property.status === "evidence-error",
      );
      return {
        contractVersion: DASHBOARD_CONTRACT_VERSION,
        timezone: "Australia/Sydney",
        overview: {
          periodKind: period.kind,
          currentWeek: currentMetric,
          previousWeek: previousMetric,
          averageRating: comparison(
            currentMetric.average,
            previousMetric.average,
          ),
          reviewVolume: comparison(
            currentMetric.reviewCount,
            previousMetric.reviewCount,
          ),
          negativeShare: comparison(
            currentNegativeShare,
            previousNegativeShare,
          ),
          responseRate: comparison(
            currentResponseRate,
            previousResponseRate,
          ),
          dataThrough: latestDate,
          attentionItems: attentionItems(
            properties,
            topics,
            qualityRows,
          ),
          recentReviews: reviewPage(currentDataset, {
            page: 1,
            pageSize: 5,
            query: "",
            properties: query.properties,
            from: query.from,
            to: query.to,
            minScore: 0,
            maxScore: 10,
            sentiments: [],
            topics: [],
            language: "",
            guestType: "",
            roomType: "",
            sort: "newest",
          }).items.slice(0, 4),
        },
        trends: weeklyTrend(globalReviews, query, today),
        scoreDistribution: scoreDistribution(globalReviews),
        properties,
        topics,
        reviews: reviewPage(currentDataset, query.review),
        filterOptions: filterOptions(currentDataset),
        quality: {
          overallStatus: hasEvidenceError
            ? "error"
            : hasUnpublished
            ? "collecting"
            : hasGap
              ? "attention"
              : "verified",
          databaseIntegrity: currentDataset.databaseIntegrity,
          classifierVersion: `rules ${REVIEW_INSIGHTS_VERSION}`,
          collectionMethod:
            "Anonymous browser-assisted structured review collection with two complete reconciled inventories.",
          generatedAtUtc: date.toISOString(),
          properties: qualityRows,
        },
      };
    },
    invalidate() {
      cachedFingerprint = null;
      cachedDataset = null;
    },
  };
}

export const dashboardDataInternals = Object.freeze({
  addDays,
  daysBetween,
  reportingPeriod,
  validatePropertyEvidence,
  average,
  percentage,
  delta,
  direction,
  publicReviewId,
  scoreDistribution,
  periodMetric,
  weeklyTrend,
  filterProperties,
});
