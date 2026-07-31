import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

export async function loadReviewListTemplate(harPath) {
  const har = parseJson(await readFile(harPath, "utf8"), "HAR");
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error("HAR is missing log.entries");
  }

  const candidates = entries
    .filter((entry) => entry?.request?.url?.includes("/dml/graphql"))
    .map((entry) => ({
      entry,
      payload: parseJson(entry?.request?.postData?.text ?? "null", "POST body"),
    }))
    .filter(
      ({ payload }) =>
        payload?.operationName === "ReviewList" &&
        payload?.query?.includes("query ReviewList"),
    );

  const selected =
    candidates.find(
      ({ payload }) =>
        payload.variables?.input?.skip === 0 &&
        payload.variables?.input?.filters?.text === "",
    ) ?? candidates[0];

  if (!selected) {
    throw new Error("No ReviewList request was found in the HAR");
  }

  const { payload } = selected;
  return {
    operationName: "ReviewList",
    query: payload.query,
    extensions: structuredClone(payload.extensions ?? {}),
    baseVariables: structuredClone(payload.variables ?? {}),
    querySha256: createHash("sha256").update(payload.query).digest("hex"),
  };
}

export function buildReviewListPayload(
  template,
  property,
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
    throw new Error("limit must be an integer from 1 to the proven maximum of 10");
  }

  return {
    operationName: template.operationName,
    variables: {
      ...template.baseVariables,
      input: {
        ...(template.baseVariables?.input ?? {}),
        hotelId: property.hotelId,
        ufi: property.ufi,
        hotelCountryCode: property.countryCode,
        sorter,
        filters,
        skip,
        limit,
        hotelScore: property.hotelScore,
        upsortReviewUrl: "",
        searchFeatures: {
          destId: property.ufi,
          destType: "CITY",
        },
      },
    },
    extensions: template.extensions,
    query: template.query,
  };
}
