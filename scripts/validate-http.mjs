import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const harPath = resolve(
  argument(
    "--har",
    resolve(projectRoot, "..", "Olympic Paddington network logs.har"),
  ),
);
const configPath = resolve(
  argument(
    "--properties",
    resolve(projectRoot, "config", "properties.json"),
  ),
);
const profile = argument("--profile", "minimal");
const sessions = Number(argument("--sessions", "1"));
const delayMs = Number(argument("--delay-ms", "750"));
const propertyKey = argument("--property", null);
const includeTerminal = process.argv.includes("--terminal");

if (!Number.isInteger(sessions) || sessions < 1 || sessions > 3) {
  throw new Error("--sessions must be an integer from 1 to 3");
}
if (!Number.isFinite(delayMs) || delayMs < 500) {
  throw new Error("--delay-ms must be at least 500");
}

const configuredProperties = JSON.parse(await readFile(configPath, "utf8"));
const properties = propertyKey
  ? configuredProperties.filter((property) => property.key === propertyKey)
  : configuredProperties;
if (properties.length === 0) {
  throw new Error(`No configured property matched --property ${propertyKey}`);
}
const template = await loadReviewListTemplate(harPath);
const results = [];
let shouldStop = false;

const delay = () =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));

async function requestPage(property, session, skip, phase) {
  const payload = buildReviewListPayload(template, property, { skip });
  const response = await fetchReviewPage({
    payload,
    referer: property.canonicalUrl,
    profile,
  });

  const base = {
    property: property.key,
    session,
    phase,
    skip,
    status: response.status,
    elapsedMs: response.elapsedMs,
    transportClassification: response.classification.kind,
  };

  if (response.classification.kind !== "json") {
    results.push(base);
    if (
      ["rate_limited", "access_denied", "unexpected_content"].includes(
        response.classification.kind,
      )
    ) {
      shouldStop = true;
    }
    return null;
  }

  try {
    const validated = validateReviewListResponse(
      response.classification.body,
      { propertyKey: property.key, skip, limit: 10 },
    );
    results.push({
      ...base,
      contract: "valid",
      reviewsCount: validated.reviewsCount,
      cardCount: validated.cardCount,
      firstReviewedAt:
        validated.reviews[0]?.reviewedAtIso ?? null,
      firstReviewScore:
        validated.reviews[0]?.reviewScore ?? null,
      uniqueKeys: new Set(
        validated.reviews.map((review) => review.sourceKey),
      ).size,
    });
    return validated;
  } catch (error) {
    results.push({
      ...base,
      contract: "invalid",
      error:
        error instanceof ContractError ? error.message : String(error),
    });
    shouldStop = true;
    return null;
  }
}

for (let session = 1; session <= sessions && !shouldStop; session += 1) {
  for (const property of properties) {
    const first = await requestPage(property, session, 0, "first");
    if (shouldStop) break;
    await delay();

    if (includeTerminal && session === 1 && first) {
      const terminalSkip = Math.ceil(first.reviewsCount / 10) * 10;
      if (terminalSkip > 0) {
        await requestPage(
          property,
          session,
          terminalSkip,
          "after_end",
        );
        if (shouldStop) break;
        await delay();
      }
    }
  }
}

const successful = results.filter(
  (result) =>
    result.transportClassification === "json" &&
    result.contract === "valid",
).length;
const failed = results.length - successful;

process.stdout.write(
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      mode: "pure_http_no_cookie_jar",
      headerProfile: profile,
      querySha256: template.querySha256,
      requestedSessions: sessions,
      stoppedEarly: shouldStop,
      successful,
      failed,
      results,
    },
    null,
    2,
  )}\n`,
);

if (failed > 0 || shouldStop) {
  process.exitCode = 2;
}
