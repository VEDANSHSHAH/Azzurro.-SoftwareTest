import { createHash } from "node:crypto";

import { fetchValidatedPage } from "./collector.mjs";
import {
  REVIEW_SCORE_RANGE_VALUES,
  reviewScoreMatchesRange,
} from "./live-template.mjs";

export const SCORE_RANGE_DIAGNOSTIC_PAGE_SIZE = 10;
export const SCORE_RANGE_DIAGNOSTIC_PACE_MS = 750;

const SCORE_RANGE_SET = new Set(REVIEW_SCORE_RANGE_VALUES);
const SAFE_PATH_COMPONENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_RECORD_DIFF_DEPTH = 8;
const MAX_RECORD_DIFF_NODES_PER_IDENTITY = 20_000;
const MAX_RECORD_DIFF_PATHS_PER_IDENTITY = 256;
const MAX_TRACKED_RECORD_DIFF_PATHS = 256;
const MAX_OUTPUT_RECORD_DIFF_PATHS = 64;
const MAX_RECORD_DIFF_COUNT = 200_000;
const MAX_PRIVATE_URL_LENGTH = 8_192;
const PHOTO_URL_FIELD_PATH =
  "sourceCard.photos.items.urls.items.url";

export class ScoreRangeDiagnosticError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ScoreRangeDiagnosticError";
    this.code = code;
    this.details = details;
  }
}

function assertScoreRange(scoreRange) {
  if (!SCORE_RANGE_SET.has(scoreRange)) {
    throw new ScoreRangeDiagnosticError(
      "UNSUPPORTED_SCORE_RANGE",
      `Unsupported deep score range: ${String(scoreRange)}`,
    );
  }
}

function sha256SortedSet(values) {
  const sorted = [...new Set(values)].sort();
  return createHash("sha256")
    .update(JSON.stringify(sorted))
    .digest("hex");
}

function safePathComponent(value) {
  return SAFE_PATH_COMPONENT.test(value) ? value : "other";
}

function emptyPhotoUrlComponentChangeCounts() {
  return {
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
  };
}

function incrementBoundedCount(counts, key) {
  counts[key] = Math.min(
    MAX_RECORD_DIFF_COUNT,
    counts[key] + 1,
  );
}

function queryValueMap(url) {
  const output = new Map();
  for (const [key, value] of url.searchParams) {
    const values = output.get(key) ?? [];
    values.push(value);
    output.set(key, values);
  }
  for (const values of output.values()) values.sort();
  return output;
}

function sameStringSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function sharedQueryValueChanged(left, right) {
  const leftValues = queryValueMap(left);
  const rightValues = queryValueMap(right);
  for (const [key, values] of leftValues) {
    const other = rightValues.get(key);
    if (
      other != null &&
      (values.length !== other.length ||
        values.some((value, index) => value !== other[index]))
    ) {
      return true;
    }
  }
  return false;
}

function comparePrivatePhotoUrlPair(leftValue, rightValue, counts) {
  if (
    typeof leftValue !== "string" ||
    typeof rightValue !== "string" ||
    leftValue.length > MAX_PRIVATE_URL_LENGTH ||
    rightValue.length > MAX_PRIVATE_URL_LENGTH
  ) {
    incrementBoundedCount(counts, "unparsablePairCount");
    return;
  }
  let left;
  let right;
  try {
    left = new URL(leftValue);
    right = new URL(rightValue);
  } catch {
    incrementBoundedCount(counts, "unparsablePairCount");
    return;
  }

  incrementBoundedCount(counts, "parseablePairCount");
  if (left.protocol !== right.protocol) {
    incrementBoundedCount(counts, "protocolChanged");
  }
  if (left.hostname !== right.hostname) {
    incrementBoundedCount(counts, "hostnameChanged");
  }
  if (left.pathname !== right.pathname) {
    incrementBoundedCount(counts, "pathnameChanged");
  }
  if (left.search !== right.search) {
    incrementBoundedCount(counts, "searchChanged");
  }
  if (left.hash !== right.hash) {
    incrementBoundedCount(counts, "hashChanged");
  }
  const leftKeys = new Set(left.searchParams.keys());
  const rightKeys = new Set(right.searchParams.keys());
  if (!sameStringSet(leftKeys, rightKeys)) {
    incrementBoundedCount(counts, "queryKeySetChanged");
  }
  if (sharedQueryValueChanged(left, right)) {
    incrementBoundedCount(counts, "queryValueChanged");
  }
  left.search = "";
  left.hash = "";
  right.search = "";
  right.hash = "";
  if (left.href === right.href) {
    incrementBoundedCount(
      counts,
      "equalAfterDroppingSearchAndHash",
    );
  }
}

function valueKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function addDifferencePath(paths, path) {
  if (paths.size >= MAX_RECORD_DIFF_PATHS_PER_IDENTITY) return false;
  paths.add(path.join("."));
  return true;
}

function collectDifferencePaths(
  left,
  right,
  path,
  paths,
  state,
  depth = 0,
) {
  if (
    state.nodes >= MAX_RECORD_DIFF_NODES_PER_IDENTITY ||
    paths.size >= MAX_RECORD_DIFF_PATHS_PER_IDENTITY
  ) {
    state.truncated = true;
    addDifferencePath(paths, [...path, "truncated"]);
    return;
  }
  state.nodes += 1;
  if (Object.is(left, right)) return;

  const leftKind = valueKind(left);
  const rightKind = valueKind(right);
  if (leftKind !== rightKind) {
    addDifferencePath(paths, path);
    return;
  }
  if (
    leftKind !== "array" &&
    leftKind !== "object"
  ) {
    if (path.join(".") === PHOTO_URL_FIELD_PATH) {
      comparePrivatePhotoUrlPair(
        left,
        right,
        state.photoUrlComponentChangeCounts,
      );
    }
    addDifferencePath(paths, path);
    return;
  }
  if (depth >= MAX_RECORD_DIFF_DEPTH) {
    state.truncated = true;
    addDifferencePath(paths, [...path, "deeper"]);
    return;
  }

  if (leftKind === "array") {
    if (left.length !== right.length) {
      addDifferencePath(paths, [...path, "length"]);
    }
    const sharedLength = Math.min(left.length, right.length);
    for (let index = 0; index < sharedLength; index += 1) {
      collectDifferencePaths(
        left[index],
        right[index],
        [...path, "items"],
        paths,
        state,
        depth + 1,
      );
      if (state.truncated) return;
    }
    return;
  }

  const keys = [...new Set([
    ...Object.keys(left),
    ...Object.keys(right),
  ])].sort();
  for (const key of keys) {
    const component = safePathComponent(key);
    if (
      !Object.hasOwn(left, key) ||
      !Object.hasOwn(right, key)
    ) {
      addDifferencePath(paths, [...path, component]);
      continue;
    }
    collectDifferencePaths(
      left[key],
      right[key],
      [...path, component],
      paths,
      state,
      depth + 1,
    );
    if (state.truncated) return;
  }
}

export function summarizeRecordDifferences(
  newestRecords,
  oldestRecords,
) {
  if (
    !(newestRecords instanceof Map) ||
    !(oldestRecords instanceof Map)
  ) {
    throw new TypeError(
      "summarizeRecordDifferences requires two record maps",
    );
  }
  let recordMismatchIdentityCount = 0;
  let recordMismatchIdentityCountCapped = false;
  let pathCountsTruncated = false;
  const pathCounts = new Map();
  const photoUrlComponentChangeCounts =
    emptyPhotoUrlComponentChangeCounts();

  for (const [token, newest] of newestRecords) {
    const oldest = oldestRecords.get(token);
    if (
      oldest == null ||
      newest?.recordHash === oldest?.recordHash
    ) {
      continue;
    }
    if (recordMismatchIdentityCount < MAX_RECORD_DIFF_COUNT) {
      recordMismatchIdentityCount += 1;
    } else {
      recordMismatchIdentityCountCapped = true;
    }

    const paths = new Set();
    const state = {
      nodes: 0,
      truncated: false,
      photoUrlComponentChangeCounts,
    };
    collectDifferencePaths(
      newest.sourceCard,
      oldest.sourceCard,
      ["sourceCard"],
      paths,
      state,
    );
    if (state.truncated) pathCountsTruncated = true;
    for (const path of paths) {
      if (
        !pathCounts.has(path) &&
        pathCounts.size >= MAX_TRACKED_RECORD_DIFF_PATHS
      ) {
        pathCountsTruncated = true;
        continue;
      }
      pathCounts.set(
        path,
        Math.min(
          MAX_RECORD_DIFF_COUNT,
          (pathCounts.get(path) ?? 0) + 1,
        ),
      );
    }
  }

  const ordered = [...pathCounts]
    .map(([path, count]) => ({ path, count }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.path.localeCompare(right.path),
    );
  if (ordered.length > MAX_OUTPUT_RECORD_DIFF_PATHS) {
    pathCountsTruncated = true;
  }
  return {
    recordMismatchIdentityCount,
    recordMismatchIdentityCountCapped,
    recordDifferencePathCounts: ordered.slice(
      0,
      MAX_OUTPUT_RECORD_DIFF_PATHS,
    ),
    recordDifferencePathCountsTruncated: pathCountsTruncated,
    photoUrlComponentChangeCounts,
  };
}

function advertisedScoreRangeCount(page, scoreRange) {
  const matches = (page?.filters?.reviewScores ?? []).filter(
    (filter) => filter?.value === scoreRange,
  );
  if (
    matches.length !== 1 ||
    !Number.isSafeInteger(matches[0].count) ||
    matches[0].count < 0
  ) {
    throw new ScoreRangeDiagnosticError(
      "MISSING_SCORE_RANGE_COUNT",
      "The requested score range did not have one valid advertised count",
      { scoreRange },
    );
  }
  return matches[0].count;
}

function assertSorterAdvertised(page, sorter) {
  if (!(page?.sorters ?? []).some((item) => item?.value === sorter)) {
    throw new ScoreRangeDiagnosticError(
      "SORTER_NOT_ADVERTISED",
      `The response did not advertise ${sorter}`,
      { sorter },
    );
  }
}

function assertStablePageFacts(
  page,
  {
    skip,
    sorter,
    reportedCount,
    advertisedCount,
    expectedCardCount,
    scoreRange,
  },
) {
  if (page.reviewsCount !== reportedCount) {
    throw new ScoreRangeDiagnosticError(
      "MOVING_REVIEW_COUNT",
      "The filtered reviewsCount changed during the diagnostic",
      {
        skip,
        sorter,
        expected: reportedCount,
        actual: page.reviewsCount,
      },
    );
  }
  const pageAdvertisedCount = advertisedScoreRangeCount(
    page,
    scoreRange,
  );
  if (pageAdvertisedCount !== advertisedCount) {
    throw new ScoreRangeDiagnosticError(
      "MOVING_ADVERTISED_COUNT",
      "The advertised score-range count changed during the diagnostic",
      {
        skip,
        sorter,
        expected: advertisedCount,
        actual: pageAdvertisedCount,
      },
    );
  }
  if (
    page.cardCount !== expectedCardCount ||
    page.reviews.length !== expectedCardCount
  ) {
    throw new ScoreRangeDiagnosticError(
      "PAGE_SHAPE_MISMATCH",
      "A filtered page did not contain the expected number of cards",
      {
        skip,
        sorter,
        expected: expectedCardCount,
        actual: page.cardCount,
      },
    );
  }
  assertSorterAdvertised(page, sorter);
}

function assertMonotonic(previousEpoch, reviews, sorter) {
  let prior = previousEpoch;
  for (const review of reviews) {
    const epoch = review.reviewedDateRaw;
    if (
      !Number.isSafeInteger(epoch) ||
      (prior !== null &&
        ((sorter === "NEWEST_FIRST" && epoch > prior) ||
          (sorter === "OLDEST_FIRST" && epoch < prior)))
    ) {
      throw new ScoreRangeDiagnosticError(
        "NON_MONOTONIC_SCORE_RANGE",
        "Filtered review dates moved in the wrong direction",
        { sorter },
      );
    }
    prior = epoch;
  }
  return prior;
}

function addReviewsToInventory(state, reviews, scoreRange) {
  for (const review of reviews) {
    if (
      typeof review.sourceReviewToken !== "string" ||
      review.sourceReviewToken.length === 0 ||
      typeof review.recordHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(review.recordHash)
    ) {
      throw new ScoreRangeDiagnosticError(
        "MALFORMED_NORMALIZED_REVIEW",
        "A validated review did not contain a safe identity/hash pair",
      );
    }
    if (
      review.sourceCard === null ||
      typeof review.sourceCard !== "object" ||
      Array.isArray(review.sourceCard)
    ) {
      throw new ScoreRangeDiagnosticError(
        "MALFORMED_SOURCE_CARD",
        "A validated review did not retain an object sourceCard",
      );
    }
    state.occurrenceCount += 1;
    state.identitySet.add(review.sourceReviewToken);
    state.recordSet.add(
      JSON.stringify([
        review.sourceReviewToken,
        review.recordHash.toLowerCase(),
      ]),
    );
    if (!state.recordMap.has(review.sourceReviewToken)) {
      state.recordMap.set(review.sourceReviewToken, {
        recordHash: review.recordHash.toLowerCase(),
        sourceCard: review.sourceCard,
      });
    }
    if (!reviewScoreMatchesRange(review.reviewScore, scoreRange)) {
      state.allCardsInRange = false;
    }
  }
}

async function crawlOneSorter({
  property,
  fetchRaw,
  scoreRange,
  sorter,
  requestPage,
  maxAttempts,
  maxDataPages,
}) {
  const first = await requestPage({
    property,
    fetchRaw,
    skip: 0,
    limit: SCORE_RANGE_DIAGNOSTIC_PAGE_SIZE,
    sorter,
    filters: { scoreRange },
    maxAttempts,
  });
  const reportedCount = first.reviewsCount;
  const advertisedCount = advertisedScoreRangeCount(
    first,
    scoreRange,
  );
  const dataPageCount = Math.ceil(
    reportedCount / SCORE_RANGE_DIAGNOSTIC_PAGE_SIZE,
  );
  if (dataPageCount > maxDataPages) {
    throw new ScoreRangeDiagnosticError(
      "PAGE_SAFETY_CAP",
      "The filtered inventory exceeds the diagnostic page safety cap",
      { dataPageCount, maxDataPages },
    );
  }

  const state = {
    occurrenceCount: 0,
    identitySet: new Set(),
    recordSet: new Set(),
    recordMap: new Map(),
    allCardsInRange: true,
  };
  let previousEpoch = null;

  for (let pageNumber = 0; pageNumber < dataPageCount; pageNumber += 1) {
    const skip = pageNumber * SCORE_RANGE_DIAGNOSTIC_PAGE_SIZE;
    const page =
      pageNumber === 0
        ? first
        : await requestPage({
            property,
            fetchRaw,
            skip,
            limit: SCORE_RANGE_DIAGNOSTIC_PAGE_SIZE,
            sorter,
            filters: { scoreRange },
            maxAttempts,
          });
    const expectedCardCount = Math.min(
      SCORE_RANGE_DIAGNOSTIC_PAGE_SIZE,
      reportedCount - skip,
    );
    assertStablePageFacts(page, {
      skip,
      sorter,
      reportedCount,
      advertisedCount,
      expectedCardCount,
      scoreRange,
    });
    previousEpoch = assertMonotonic(
      previousEpoch,
      page.reviews,
      sorter,
    );
    addReviewsToInventory(state, page.reviews, scoreRange);
  }

  const terminalOffset =
    dataPageCount * SCORE_RANGE_DIAGNOSTIC_PAGE_SIZE;
  const terminal =
    reportedCount === 0
      ? first
      : await requestPage({
          property,
          fetchRaw,
          skip: terminalOffset,
          limit: SCORE_RANGE_DIAGNOSTIC_PAGE_SIZE,
          sorter,
          filters: { scoreRange },
          maxAttempts,
        });
  assertStablePageFacts(terminal, {
    skip: terminalOffset,
    sorter,
    reportedCount,
    advertisedCount,
    expectedCardCount: 0,
    scoreRange,
  });

  const summary = {
    sorter,
    reportedCounts: {
      reviewsCount: reportedCount,
      advertisedScoreRangeCount: advertisedCount,
      agree: reportedCount === advertisedCount,
    },
    dataPageCount,
    requestCount: dataPageCount + 1,
    occurrenceCount: state.occurrenceCount,
    uniqueIdentityCount: state.identitySet.size,
    uniqueTokenRecordHashCount: state.recordSet.size,
    identitySetSha256: sha256SortedSet(state.identitySet),
    tokenRecordHashSetSha256: sha256SortedSet(state.recordSet),
    terminalEvidence: {
      offset: terminalOffset,
      reviewsCount: terminal.reviewsCount,
      advertisedScoreRangeCount: advertisedCount,
      cardCount: terminal.cardCount,
      empty: terminal.cardCount === 0,
      stableReportedCount: terminal.reviewsCount === reportedCount,
    },
    allCardsInRange: state.allCardsInRange,
  };
  return {
    summary,
    identitySet: state.identitySet,
    recordSet: state.recordSet,
    recordMap: state.recordMap,
  };
}

export function summarizeSetParity(newestSet, oldestSet) {
  if (!(newestSet instanceof Set) || !(oldestSet instanceof Set)) {
    throw new TypeError("summarizeSetParity requires two sets");
  }
  let intersectionCount = 0;
  for (const value of newestSet) {
    if (oldestSet.has(value)) intersectionCount += 1;
  }
  const newestOnlyCount = newestSet.size - intersectionCount;
  const oldestOnlyCount = oldestSet.size - intersectionCount;
  return {
    parity:
      newestOnlyCount === 0 &&
      oldestOnlyCount === 0,
    intersectionCount,
    unionCount:
      newestSet.size + oldestSet.size - intersectionCount,
    newestOnlyCount,
    oldestOnlyCount,
    symmetricDifferenceCount:
      newestOnlyCount + oldestOnlyCount,
  };
}

export function parseDiagnosticArgs(argv) {
  let propertyKey = null;
  let deepScoreRange = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--deep-score-range") {
      if (deepScoreRange !== null) {
        throw new ScoreRangeDiagnosticError(
          "DUPLICATE_DEEP_SCORE_RANGE",
          "--deep-score-range may be provided only once",
        );
      }
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) {
        throw new ScoreRangeDiagnosticError(
          "MISSING_DEEP_SCORE_RANGE",
          "--deep-score-range requires a value",
        );
      }
      assertScoreRange(value);
      deepScoreRange = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new ScoreRangeDiagnosticError(
        "UNKNOWN_ARGUMENT",
        `Unknown diagnostic argument: ${argument}`,
      );
    }
    if (propertyKey !== null) {
      throw new ScoreRangeDiagnosticError(
        "TOO_MANY_PROPERTIES",
        "Only one property key may be diagnosed",
      );
    }
    propertyKey = argument;
  }
  return {
    propertyKey: propertyKey ?? "central_sydney",
    deepScoreRange,
  };
}

export function deepScoreRangeDiagnosticPassed(result) {
  const summaries = [result?.newestFirst, result?.oldestFirst];
  return (
    summaries.every(
      (summary) =>
        summary?.reportedCounts?.agree === true &&
        summary?.allCardsInRange === true &&
        summary?.terminalEvidence?.empty === true &&
        summary?.terminalEvidence?.stableReportedCount === true &&
        summary?.occurrenceCount ===
          summary?.reportedCounts?.reviewsCount &&
        summary?.uniqueIdentityCount === summary?.occurrenceCount &&
        summary?.uniqueTokenRecordHashCount ===
          summary?.occurrenceCount,
    ) &&
    result?.oldestNewestParity?.reportedReviewsCount === true &&
    result?.oldestNewestParity?.advertisedScoreRangeCount === true &&
    result?.oldestNewestParity?.identities?.parity === true &&
    result?.oldestNewestParity?.records?.parity === true
  );
}

export async function runDeepScoreRangeDiagnostic({
  property,
  fetchRaw,
  scoreRange,
  fetchPage = fetchValidatedPage,
  delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 3,
  maxDataPages = 20_000,
}) {
  assertScoreRange(scoreRange);
  if (typeof fetchPage !== "function") {
    throw new TypeError("fetchPage must be a function");
  }
  if (typeof delay !== "function") {
    throw new TypeError("delay must be a function");
  }

  let requestCount = 0;
  const requestPage = async (options) => {
    if (requestCount > 0) {
      await delay(SCORE_RANGE_DIAGNOSTIC_PACE_MS);
    }
    requestCount += 1;
    return fetchPage(options);
  };

  const newest = await crawlOneSorter({
    property,
    fetchRaw,
    scoreRange,
    sorter: "NEWEST_FIRST",
    requestPage,
    maxAttempts,
    maxDataPages,
  });
  const oldest = await crawlOneSorter({
    property,
    fetchRaw,
    scoreRange,
    sorter: "OLDEST_FIRST",
    requestPage,
    maxAttempts,
    maxDataPages,
  });
  const identityParity = summarizeSetParity(
    newest.identitySet,
    oldest.identitySet,
  );
  const recordParity = summarizeSetParity(
    newest.recordSet,
    oldest.recordSet,
  );
  const recordDifferences = summarizeRecordDifferences(
    newest.recordMap,
    oldest.recordMap,
  );

  return {
    scoreRange,
    newestFirst: newest.summary,
    oldestFirst: oldest.summary,
    oldestNewestParity: {
      reportedReviewsCount:
        newest.summary.reportedCounts.reviewsCount ===
        oldest.summary.reportedCounts.reviewsCount,
      advertisedScoreRangeCount:
        newest.summary.reportedCounts.advertisedScoreRangeCount ===
        oldest.summary.reportedCounts.advertisedScoreRangeCount,
      identities: identityParity,
      records: recordParity,
      ...recordDifferences,
    },
  };
}
