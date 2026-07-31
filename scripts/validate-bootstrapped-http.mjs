import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bootstrapAnonymousProperty,
  contextHeaders,
} from "../src/anonymous-bootstrap.mjs";
import {
  buildReviewListPayload,
  loadReviewListTemplate,
} from "../src/har-template.mjs";
import { fetchReviewPage } from "../src/http-transport.mjs";
import {
  ContractError,
  validateReviewListResponse,
} from "../src/review-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const harPath = resolve(
  projectRoot,
  "..",
  "Olympic Paddington network logs.har",
);
const properties = JSON.parse(
  await readFile(
    resolve(projectRoot, "config", "properties.json"),
    "utf8",
  ),
);
const propertyArgumentIndex = process.argv.indexOf("--property");
const propertyKey =
  propertyArgumentIndex >= 0
    ? process.argv[propertyArgumentIndex + 1]
    : "olympic_paddington";
if (!propertyKey) throw new Error("--property requires a value");
const property = properties.find((item) => item.key === propertyKey);
if (!property) throw new Error(`Unknown property: ${propertyKey}`);

const template = await loadReviewListTemplate(harPath);
const bootstrap = await bootstrapAnonymousProperty(
  property.canonicalUrl,
);
const payload = buildReviewListPayload(template, property);

let result = {
  property: property.key,
  bootstrap: {
    status: bootstrap.status,
    elapsedMs: bootstrap.elapsedMs,
    finalUrlMatches: bootstrap.finalUrl.startsWith(
      property.canonicalUrl,
    ),
    contentType: bootstrap.contentType,
    ...bootstrap.diagnostics,
  },
};

if (
  bootstrap.status !== 200 ||
  !bootstrap.contentType.toLowerCase().includes("text/html")
) {
  result = { ...result, outcome: "bootstrap_failed" };
} else {
  const response = await fetchReviewPage({
    payload,
    referer: property.canonicalUrl,
    profile: "semantic",
    extraHeaders: contextHeaders(bootstrap),
  });

  result = {
    ...result,
    request: {
      status: response.status,
      elapsedMs: response.elapsedMs,
      classification: response.classification.kind,
    },
  };

  if (response.classification.kind === "json") {
    try {
      const validated = validateReviewListResponse(
        response.classification.body,
        {
          propertyKey: property.key,
          skip: 0,
          limit: 10,
        },
      );
      result = {
        ...result,
        outcome: "valid",
        request: {
          ...result.request,
          reviewsCount: validated.reviewsCount,
          cardCount: validated.cardCount,
        },
      };
    } catch (error) {
      result = {
        ...result,
        outcome: "contract_error",
        error:
          error instanceof ContractError ? error.message : String(error),
      };
    }
  } else {
    result = { ...result, outcome: "transport_error" };
  }
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.outcome !== "valid") process.exitCode = 2;
