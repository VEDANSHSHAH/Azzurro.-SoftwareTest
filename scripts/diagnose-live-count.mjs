import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { launchScraperBrowser } from "../src/playwright-capture.mjs";
import { loadProperties } from "../src/property-config.mjs";
import {
  REVIEW_SCORE_RANGE_VALUES,
  reviewScoreMatchesRange,
} from "../src/live-template.mjs";
import {
  deepScoreRangeDiagnosticPassed,
  parseDiagnosticArgs,
  runDeepScoreRangeDiagnostic,
} from "../src/score-range-diagnostic.mjs";

function safePageFacts(raw, offset, requestedScoreRange = null) {
  if (
    raw.status !== 200 ||
    !String(raw.contentType).toLowerCase().includes("json")
  ) {
    return {
      offset,
      status: raw.status,
      contentType: raw.contentType,
      validJson: false,
    };
  }
  let body;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return {
      offset,
      status: raw.status,
      validJson: false,
    };
  }
  const list = body?.data?.reviewListFrontend;
  const cards = Array.isArray(list?.reviewCard)
    ? list.reviewCard
    : null;
  const trustedTotals = [
    ...(Array.isArray(list?.reviewScoreFilter)
      ? list.reviewScoreFilter
          .filter((item) => item?.value === "ALL")
          .map((item) => ({
            source: "reviewScoreFilter.ALL",
            count: item.count,
          }))
      : []),
    ...(Array.isArray(list?.languageFilter)
      ? list.languageFilter
          .filter((item) => item?.value === "")
          .map((item) => ({
            source: "languageFilter.empty",
            count: item.count,
          }))
      : []),
    ...(Array.isArray(list?.timeOfYearFilter)
      ? list.timeOfYearFilter
          .filter((item) => item?.value === "ALL")
          .map((item) => ({
            source: "timeOfYearFilter.ALL",
            count: item.count,
          }))
      : []),
    ...(Array.isArray(list?.customerTypeFilter)
      ? list.customerTypeFilter
          .filter((item) => item?.value === "ALL")
          .map((item) => ({
            source: "customerTypeFilter.ALL",
            count: item.count,
          }))
      : []),
  ];
  const scoreBuckets = Array.isArray(list?.reviewScoreFilter)
    ? list.reviewScoreFilter
        .filter((item) => item?.value !== "ALL")
        .map((item) => ({
          value: item.value,
          count: item.count,
        }))
    : [];
  const selectedBucketCount =
    requestedScoreRange === null
      ? null
      : scoreBuckets.find(
          ({ value }) => value === requestedScoreRange,
        )?.count ?? null;
  const matchingCardCount =
    cards === null || requestedScoreRange === null
      ? null
      : cards.filter((card) =>
          reviewScoreMatchesRange(
            card?.reviewScore,
            requestedScoreRange,
          ),
        ).length;
  const scoreRangeValidation =
    requestedScoreRange === null
      ? null
      : {
          requestedScoreRange,
          advertisedBucketCount:
            Number.isSafeInteger(selectedBucketCount) &&
            selectedBucketCount >= 0
              ? selectedBucketCount
              : null,
          evaluatedCardCount: cards?.length ?? null,
          matchingCardCount,
          invalidCardCount:
            cards === null ? null : cards.length - matchingCardCount,
          allCardsMatch:
            cards !== null && matchingCardCount === cards.length,
        };
  return {
    offset,
    status: raw.status,
    validJson: true,
    typename: list?.__typename ?? null,
    reviewsCount: list?.reviewsCount ?? null,
    cardCount: cards?.length ?? null,
    trustedTotals,
    scoreBuckets,
    scoreRangeValidation,
  };
}

async function main() {
  const { propertyKey, deepScoreRange } = parseDiagnosticArgs(
    process.argv.slice(2),
  );
  const projectRoot = resolve(import.meta.dirname, "..");
  const chromePath = process.env.AZZURRO_CHROME_PATH
    ? resolve(process.env.AZZURRO_CHROME_PATH)
    : null;

  if (chromePath) {
    await access(chromePath);
  }
  const [property] = await loadProperties(
    resolve(projectRoot, "config", "properties.json"),
    [propertyKey],
  );
  const browser = await launchScraperBrowser({
    executablePath: chromePath,
    interactiveChallenge: true,
    challengeTimeoutMs: 300_000,
    onChallenge: ({ propertyKey: key, timeoutMs }) => {
      process.stderr.write(
        `Manual human-check resolution may be required for ${key} within ${timeoutMs} ms; this diagnostic will not interact with it.\n`,
      );
    },
  });

  let session = null;
  try {
    session = await browser.openPropertySession(property);
    if (deepScoreRange !== null) {
      const result = await runDeepScoreRangeDiagnostic({
        property,
        fetchRaw: session.fetchRaw,
        scoreRange: deepScoreRange,
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            propertyKey: property.key,
            ...result,
          },
          null,
          2,
        )}\n`,
      );
      if (!deepScoreRangeDiagnosticPassed(result)) {
        process.exitCode = 1;
      }
      return;
    }

    const visible = session.visibleReviewCount;
    const configured = property.visibleReviewCount;
    const candidateTotals = [visible, configured].filter(
      (value) => Number.isSafeInteger(value) && value >= 0,
    );
    const offsets = new Set([0]);
    for (const total of candidateTotals) {
      if (total > 0) {
        offsets.add(Math.floor((total - 1) / 10) * 10);
      }
      offsets.add(Math.ceil(total / 10) * 10);
    }

    const pages = [];
    for (const offset of [...offsets].sort((a, b) => a - b)) {
      const raw = await session.fetchRaw({
        skip: offset,
        limit: 10,
        sorter: "NEWEST_FIRST",
        filters: { text: "" },
      });
      pages.push(safePageFacts(raw, offset));
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, 750),
      );
    }

    // This is a bounded first-page probe only. It validates that each
    // allowlisted partition returns cards from the requested numeric range;
    // it does not publish reviews or expose any card-level content.
    const scorePartitions = [];
    for (const scoreRange of REVIEW_SCORE_RANGE_VALUES) {
      const raw = await session.fetchRaw({
        skip: 0,
        limit: 10,
        sorter: "NEWEST_FIRST",
        filters: { scoreRange },
      });
      scorePartitions.push(safePageFacts(raw, 0, scoreRange));
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, 750),
      );
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          propertyKey: property.key,
          capturedHotelId: session.capturedHotelId,
          visibleReviewCount: visible,
          configuredReviewCount: configured,
          pages,
          scorePartitions,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await session?.close().catch(() => {});
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  const code =
    typeof error?.code === "string" &&
    /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)
      ? error.code
      : "DIAGNOSTIC_FAILED";
  const contractMessage =
    typeof error?.details?.contractMessage === "string"
      ? ` (${error.details.contractMessage})`
      : "";
  process.stderr.write(
    `Diagnostic failed: ${code}${contractMessage}\n`,
  );
  process.exitCode = 1;
}
