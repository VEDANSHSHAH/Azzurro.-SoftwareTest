import { randomUUID } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseScrapeOptions,
  SCRAPE_HELP,
} from "../src/cli-options.mjs";
import {
  executeCanary,
  executeFullProperty,
} from "../src/orchestrator.mjs";
import { nextCircuitDecision } from "../src/circuit-policy.mjs";
import {
  launchScraperBrowser,
  sanitizeCaptureDiagnostics,
} from "../src/playwright-capture.mjs";
import { loadProperties } from "../src/property-config.mjs";
import { redactForLog } from "../src/redact.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const options = parseScrapeOptions(process.argv.slice(2), projectRoot);

if (options.help) {
  process.stdout.write(SCRAPE_HELP);
  process.exit(0);
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function errorSummary(error) {
  const redacted = redactForLog(error);
  const summary = {
    code: error?.code ?? "UNEXPECTED_ERROR",
    name: error?.name ?? "Error",
    message:
      typeof redacted?.message === "string"
        ? redacted.message
        : "The property run failed",
  };
  if (error?.code === "REVIEW_CAPTURE_TIMEOUT") {
    summary.details = sanitizeCaptureDiagnostics(error.details);
  }
  return summary;
}

if (options.executablePath) {
  await access(options.executablePath);
}
const properties = await loadProperties(
  options.propertiesPath,
  options.propertyKeys,
);
if (options.mode !== "canary") {
  await mkdir(dirname(options.databasePath), { recursive: true });
}

const generatedAt = new Date().toISOString();
const summary = {
  generatedAt,
  mode: options.mode,
  policy: {
    browserContext: options.interactiveChallenge
      ? "shared_ephemeral_anonymous_for_process"
      : "fresh_anonymous_per_property",
    accountOrPersistentProfile: false,
    humanChallengeHandoff: options.interactiveChallenge,
    challengeTimeoutMs: options.interactiveChallenge
      ? options.challengeTimeoutMs
      : null,
    concurrency: 1,
    delayMs: options.delayMs,
    maxAttempts: options.maxRetries + 1,
    stopOnChallengeAccessDenialOrRateLimit: true,
    stopAfterConsecutiveReviewCaptureTimeouts: 2,
    authoritativeUpdateMode: "full_rerun_only",
    incrementalPublicationEnabled: false,
    publicationAtomicity:
      options.mode === "full"
        ? "per_property_transaction_only"
        : "no_publication_in_canary_mode",
    multiPropertyPublicationAtomic:
      options.mode === "full" ? false : null,
    stopAfterFirstPropertyFailure: options.mode === "full",
    strictAllExportRequiresEveryConfiguredFullPublication: true,
  },
  requestedProperties: properties.map((property) => property.key),
  results: [],
};

let storage = null;
if (options.mode !== "canary") {
  const { ReviewStorage } = await import("../src/storage.mjs");
  storage = new ReviewStorage(options.databasePath);
}
const browser = await launchScraperBrowser({
  executablePath: options.executablePath,
  headed: options.headed,
  interactiveChallenge: options.interactiveChallenge,
  challengeTimeoutMs: options.challengeTimeoutMs,
  onChallenge: ({ propertyKey, timeoutMs }) => {
    process.stderr.write(
      `[${new Date().toISOString()}] manual action required: resolve the visible browser challenge for ${propertyKey} within ${timeoutMs} ms; the collector will not interact with the challenge\n`,
    );
  },
});
let circuitOpen = false;
let consecutiveReviewCaptureTimeouts = 0;
let stopAfterPropertyFailure = false;

try {
  for (const property of properties) {
    if (circuitOpen || stopAfterPropertyFailure) break;
    process.stdout.write(
      `[${new Date().toISOString()}] ${options.mode}: ${property.key}\n`,
    );
    let session = null;
    try {
      session = await browser.openPropertySession(property, {
        requestTimeoutMs: options.requestTimeoutMs,
      });
      let result;
      if (options.mode === "canary") {
        result = await executeCanary({
          property,
          session,
          maxAttempts: options.maxRetries + 1,
          delayMs: options.delayMs,
        });
      } else {
        result = await executeFullProperty({
          property,
          session,
          storage,
          maxAttempts: options.maxRetries + 1,
          delayMs: options.delayMs,
          maxPages: options.maxPages,
          onProgress: ({
            phaseKey,
            processedCount,
            expectedCount,
            cardCount,
            terminal,
          }) => {
            if (phaseKey === "final_head") {
              process.stdout.write(
                `[${new Date().toISOString()}] progress: ${property.key} final head verified (${cardCount} cards)\n`,
              );
              return;
            }
            if (
              processedCount === Math.min(10, expectedCount) ||
              processedCount % 100 === 0 ||
              terminal
            ) {
              const pass =
                phaseKey === "inventory_oldest"
                  ? "oldest-first"
                  : "newest-first";
              process.stdout.write(
                `[${new Date().toISOString()}] progress: ${property.key} ${pass} ${processedCount}/${expectedCount}${terminal ? " verified" : ""}\n`,
              );
            }
          },
        });
      }
      summary.results.push(result);
      consecutiveReviewCaptureTimeouts = 0;
      process.stdout.write(
        `[${new Date().toISOString()}] passed: ${property.key} (${result.structuredReviewCount} reviews)\n`,
      );
    } catch (error) {
      const failure = {
        propertyKey: property.key,
        outcome: "failed",
        error: errorSummary(error),
      };
      summary.results.push(failure);
      process.stderr.write(
        `[${new Date().toISOString()}] failed: ${property.key}: ${failure.error.code} ${failure.error.message}\n`,
      );
      const circuitDecision = nextCircuitDecision({
        code: failure.error.code,
        consecutiveReviewCaptureTimeouts,
      });
      consecutiveReviewCaptureTimeouts =
        circuitDecision.consecutiveReviewCaptureTimeouts;
      if (circuitDecision.open) {
        circuitOpen = true;
        summary.circuitOpenedBy = {
          propertyKey: property.key,
          code: failure.error.code,
        };
      }
      if (options.mode === "full") {
        stopAfterPropertyFailure = true;
        summary.stoppedAfterPropertyFailure = property.key;
      }
    } finally {
      await session?.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
  if (storage) {
    summary.databaseIntegrity = storage.integrityCheck();
    summary.published = Object.fromEntries(
      properties.map((property) => [
        property.key,
        storage.getPublishedStats(property.key),
      ]),
    );
    storage.close();
  }
}

summary.finishedAt = new Date().toISOString();
summary.circuitOpen = circuitOpen;
summary.passed = summary.results.filter(
  (result) => ["passed", "published"].includes(result.outcome),
).length;
summary.failed = summary.results.filter(
  (result) => result.outcome === "failed",
).length;
summary.skipped = properties.length - summary.results.length;
summary.multiPropertyPublication = {
  atomic: false,
  scope:
    options.mode === "full"
      ? "each successful property is committed independently"
      : "canary mode publishes nothing",
  complete:
    options.mode === "full"
      ? summary.failed === 0 && summary.skipped === 0
      : null,
  strictAllExportRequired: options.mode === "full",
};

await writeJsonAtomic(options.summaryPath, summary);
process.stdout.write(
  `${JSON.stringify(
    {
      mode: summary.mode,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      circuitOpen: summary.circuitOpen,
      summaryPath: options.summaryPath,
    },
    null,
    2,
  )}\n`,
);
if (summary.failed > 0 || summary.skipped > 0) {
  process.exitCode = 2;
}
