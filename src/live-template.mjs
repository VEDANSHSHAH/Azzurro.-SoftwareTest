import { createHash } from "node:crypto";

export const PROVEN_REVIEW_LIST_QUERY_SHA256 =
  "778f81af03c40adf2a26d48a457d20892b6514132c6bf2b825bb43899a3dc513";

const APPLICATION_HEADER_NAMES = new Set([
  "accept",
  "content-type",
  "apollographql-client-name",
  "apollographql-client-version",
  "x-apollo-operation-name",
  "x-booking-context-action",
  "x-booking-context-action-name",
  "x-booking-site-type-id",
  "x-booking-timeout-ms",
  "x-booking-topic",
  "x-envoy-upstream-rq-timeout-ms",
]);

function clone(value) {
  return structuredClone(value);
}

const REVIEW_SORTERS = new Set([
  "MOST_RELEVANT",
  "NEWEST_FIRST",
  "OLDEST_FIRST",
  "SCORE_DESC",
  "SCORE_ASC",
]);

export const REVIEW_SCORE_RANGE_VALUES = Object.freeze([
  "REVIEW_ADJ_SUPERB",
  "REVIEW_ADJ_GOOD",
  "REVIEW_ADJ_AVERAGE_PASSABLE",
  "REVIEW_ADJ_POOR",
  "REVIEW_ADJ_VERY_POOR",
]);

const REVIEW_SCORE_RANGE_SET = new Set(REVIEW_SCORE_RANGE_VALUES);

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isNeutralFilterValue(key, value) {
  switch (key) {
    case "text":
      return value === "";
    case "scoreRange":
    case "timeOfYear":
      return value === "ALL";
    case "languages":
      return (
        Array.isArray(value) &&
        (value.length === 0 ||
          (value.length === 1 &&
            ["0", "ALL"].includes(value[0])))
      );
    default:
      return false;
  }
}

export function isSemanticallyUnfiltered(filters) {
  if (filters == null) return true;
  if (!isPlainObject(filters)) return false;
  return Object.entries(filters).every(([key, value]) =>
    isNeutralFilterValue(key, value),
  );
}

function assertAllowedCollectionFilters(filters) {
  if (!isPlainObject(filters)) {
    throw new Error("filters must be an object");
  }
  if (isSemanticallyUnfiltered(filters)) {
    return { mode: "unfiltered", scoreRange: null };
  }

  const keys = Object.keys(filters);
  if (keys.length === 1 && keys[0] === "scoreRange") {
    if (!REVIEW_SCORE_RANGE_SET.has(filters.scoreRange)) {
      throw new Error(
        `Unsupported ReviewList scoreRange: ${String(filters.scoreRange)}`,
      );
    }
    return {
      mode: "score_partition",
      scoreRange: filters.scoreRange,
    };
  }
  if (Object.hasOwn(filters, "scoreRange")) {
    throw new Error(
      "ReviewList score partition filters must contain only one supported scoreRange",
    );
  }
  throw new Error(
    "ReviewList collection filters must be unfiltered or one supported scoreRange",
  );
}

export function reviewScoreMatchesRange(score, scoreRange) {
  if (!REVIEW_SCORE_RANGE_SET.has(scoreRange)) {
    throw new Error(
      `Unsupported ReviewList scoreRange: ${String(scoreRange)}`,
    );
  }
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return false;
  }
  switch (scoreRange) {
    case "REVIEW_ADJ_SUPERB":
      return score >= 9 && score <= 10;
    case "REVIEW_ADJ_GOOD":
      return score >= 7 && score < 9;
    case "REVIEW_ADJ_AVERAGE_PASSABLE":
      return score >= 5 && score < 7;
    case "REVIEW_ADJ_POOR":
      return score >= 3 && score < 5;
    case "REVIEW_ADJ_VERY_POOR":
      return score >= 1 && score < 3;
    default:
      return false;
  }
}

export function reviewListOperationFacts(payload) {
  const input = isPlainObject(payload?.variables?.input)
    ? payload.variables.input
    : {};
  const filters = input.filters;
  const filterKeys = isPlainObject(filters)
    ? Object.keys(filters)
        .filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key))
        .sort()
        .slice(0, 20)
    : [];
  return {
    skip: Number.isSafeInteger(input.skip) ? input.skip : null,
    limit: Number.isSafeInteger(input.limit) ? input.limit : null,
    sorter: REVIEW_SORTERS.has(input.sorter) ? input.sorter : null,
    filterKeys,
    semanticallyUnfiltered: isSemanticallyUnfiltered(filters),
  };
}

function endpointUrl(value, { allowLocalTestOrigin = false } = {}) {
  const url = new URL(value);
  const local =
    allowLocalTestOrigin &&
    ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    (!local &&
      (url.protocol !== "https:" ||
        url.hostname !== "www.booking.com")) ||
    url.pathname !== "/dml/graphql"
  ) {
    throw new Error("ReviewList endpoint is not the expected Booking GraphQL URL");
  }
  return url.toString();
}

function safeHeaders(headers) {
  const output = {};
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    const name = rawName.toLowerCase();
    if (APPLICATION_HEADER_NAMES.has(name)) {
      output[name] = String(rawValue);
    }
  }
  if (!output["content-type"]?.toLowerCase().includes("application/json")) {
    throw new Error("Captured ReviewList request did not use JSON content");
  }
  return output;
}

function persistedQuerySha256(payload) {
  const persisted = payload?.extensions?.persistedQuery;
  if (
    !isPlainObject(persisted) ||
    persisted.version !== 1 ||
    typeof persisted.sha256Hash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(persisted.sha256Hash)
  ) {
    return null;
  }
  return persisted.sha256Hash.toLowerCase();
}

function queryDocumentError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function queryTextSha256(payload) {
  if (typeof payload?.query !== "string") return null;
  if (!/\bquery\s+ReviewList\b/.test(payload.query)) {
    throw queryDocumentError(
      "REVIEW_QUERY_DOCUMENT_INVALID",
      "Captured GraphQL query text does not declare ReviewList",
    );
  }
  return createHash("sha256").update(payload.query).digest("hex");
}

function assertedQuerySha256(
  payload,
  { testOnlyAllowUnpinnedQuery = false } = {},
) {
  const textSha256 = queryTextSha256(payload);
  const persistedSha256 = persistedQuerySha256(payload);
  if (textSha256 === null && persistedSha256 === null) {
    throw queryDocumentError(
      "REVIEW_QUERY_DOCUMENT_MISSING",
      "Captured ReviewList query text or persisted-query hash is missing",
    );
  }
  if (
    textSha256 !== null &&
    persistedSha256 !== null &&
    textSha256 !== persistedSha256
  ) {
    throw queryDocumentError(
      "REVIEW_QUERY_DOCUMENT_MISMATCH",
      "Captured ReviewList query text and persisted-query hash disagree",
      {
        queryTextSha256: textSha256,
        persistedQuerySha256: persistedSha256,
      },
    );
  }
  const querySha256 = textSha256 ?? persistedSha256;
  if (
    !testOnlyAllowUnpinnedQuery &&
    querySha256 !== PROVEN_REVIEW_LIST_QUERY_SHA256
  ) {
    throw queryDocumentError(
      "UNPROVEN_REVIEW_QUERY_DOCUMENT",
      "Captured ReviewList query document is not the proven production document",
      {
        expectedSha256: PROVEN_REVIEW_LIST_QUERY_SHA256,
        observedSha256: querySha256,
      },
    );
  }
  return querySha256;
}

function assertCapturedPayload(
  payload,
  property,
  {
    requireSkipZero = true,
    testOnlyAllowUnpinnedQuery = false,
  } = {},
) {
  if (payload?.operationName !== "ReviewList") {
    throw new Error("Captured GraphQL operation is not ReviewList");
  }
  assertedQuerySha256(payload, { testOnlyAllowUnpinnedQuery });
  const input = payload?.variables?.input;
  if (!input || typeof input !== "object") {
    throw new Error("Captured ReviewList input is missing");
  }
  if (Number(input.hotelId) !== property.hotelId) {
    throw new Error("Captured ReviewList hotel ID does not match the property");
  }
  if (requireSkipZero && input.skip !== 0) {
    throw new Error("Captured ReviewList template must be an unfiltered first page");
  }
  if (!isSemanticallyUnfiltered(input.filters)) {
    throw new Error("Captured ReviewList template must be unfiltered");
  }
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 10
  ) {
    throw new Error("Captured ReviewList page limit is outside the proven range");
  }
  return input;
}

export function parseReviewListPostData(request) {
  if (request.method() !== "POST") return null;
  let requestBody;
  try {
    requestBody = request.postDataJSON();
  } catch {
    return null;
  }
  const batched = Array.isArray(requestBody);
  const payloads = batched ? requestBody : [requestBody];
  const operations = payloads.flatMap((payload, responseIndex) =>
    payload?.operationName === "ReviewList"
      ? [{ payload, responseIndex }]
      : [],
  );
  if (operations.length === 0) return null;
  return {
    batched,
    batchSize: payloads.length,
    operations,
  };
}

export function createLiveTemplate({
  requestUrl,
  requestHeaders,
  payload,
  property,
  requestWasBatch = false,
  capturedBatchSize = 1,
  allowLocalTestOrigin = false,
  testOnlyAllowUnpinnedQuery = false,
}) {
  if (typeof requestWasBatch !== "boolean") {
    throw new TypeError("requestWasBatch must be a boolean");
  }
  if (
    !Number.isSafeInteger(capturedBatchSize) ||
    capturedBatchSize < 1
  ) {
    throw new TypeError("capturedBatchSize must be a positive integer");
  }
  if (typeof testOnlyAllowUnpinnedQuery !== "boolean") {
    throw new TypeError(
      "testOnlyAllowUnpinnedQuery must be a boolean",
    );
  }
  const endpoint = endpointUrl(requestUrl, { allowLocalTestOrigin });
  const endpointHostname = new URL(endpoint).hostname;
  const localTestEndpoint =
    allowLocalTestOrigin &&
    ["127.0.0.1", "localhost"].includes(endpointHostname);
  if (testOnlyAllowUnpinnedQuery && !localTestEndpoint) {
    throw new Error(
      "Unpinned ReviewList documents are allowed only for an explicit local test endpoint",
    );
  }
  const input = assertCapturedPayload(payload, property, {
    testOnlyAllowUnpinnedQuery:
      testOnlyAllowUnpinnedQuery && localTestEndpoint,
  });
  const headers = safeHeaders(requestHeaders);
  // Preserve a batched transport shape when one was observed, but never
  // replay unrelated sibling operations from the captured request.
  const payloadTemplate = requestWasBatch
    ? [clone(payload)]
    : clone(payload);
  const querySha256 = assertedQuerySha256(payload, {
    testOnlyAllowUnpinnedQuery:
      testOnlyAllowUnpinnedQuery && localTestEndpoint,
  });

  return {
    endpoint,
    headers,
    payloadTemplate,
    requestWasBatch,
    capturedBatchSize,
    querySha256,
    capturedHotelId: Number(input.hotelId),
    capturedHotelScore:
      typeof input.hotelScore === "number" ? input.hotelScore : null,
  };
}

export function buildLivePayload(
  template,
  {
    skip = 0,
    limit = 10,
    sorter = "NEWEST_FIRST",
    filters = { text: "" },
  } = {},
) {
  if (!Number.isInteger(skip) || skip < 0) {
    throw new Error("skip must be a non-negative integer");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error("limit must be an integer from 1 to 10");
  }
  if (!REVIEW_SORTERS.has(sorter)) {
    throw new Error(`Unsupported ReviewList sorter: ${sorter}`);
  }
  if (
    filters === null ||
    typeof filters !== "object" ||
    Array.isArray(filters)
  ) {
    throw new Error("filters must be an object");
  }
  assertAllowedCollectionFilters(filters);

  const requestBody = clone(template.payloadTemplate);
  const payload = template.requestWasBatch
    ? requestBody[0]
    : requestBody;
  if (
    payload?.operationName !== "ReviewList" ||
    !isPlainObject(payload?.variables?.input)
  ) {
    throw new Error("ReviewList payload template is malformed");
  }
  payload.variables.input = {
    ...payload.variables.input,
    skip,
    limit,
    sorter,
    filters: clone(filters),
  };
  return requestBody;
}

export const liveTemplateInternals = Object.freeze({
  safeHeaders,
  assertCapturedPayload,
  assertAllowedCollectionFilters,
  isNeutralFilterValue,
  persistedQuerySha256,
  queryTextSha256,
  assertedQuerySha256,
});
