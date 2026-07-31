import { resolve } from "node:path";

function takeValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function integer(value, name, { min, max }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

export function parseScrapeOptions(
  args,
  projectRoot,
  environment = process.env,
) {
  const options = {
    mode: "canary",
    propertyKeys: [],
    propertiesPath: resolve(projectRoot, "config", "properties.json"),
    databasePath: resolve(projectRoot, "data", "azzurro-reviews.sqlite"),
    summaryPath: resolve(projectRoot, "data", "last-run-summary.json"),
    headed: false,
    executablePath: environment.AZZURRO_CHROME_PATH
      ? resolve(environment.AZZURRO_CHROME_PATH)
      : null,
    delayMs: 750,
    requestTimeoutMs: 20_000,
    interactiveChallenge: false,
    challengeTimeoutMs: 180_000,
    maxRetries: 2,
    maxPages: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--mode") {
      options.mode = takeValue(args, index, name);
      index += 1;
    } else if (name === "--property") {
      const values = takeValue(args, index, name)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      options.propertyKeys.push(...values);
      index += 1;
    } else if (name === "--properties") {
      options.propertiesPath = resolve(takeValue(args, index, name));
      index += 1;
    } else if (name === "--db") {
      options.databasePath = resolve(takeValue(args, index, name));
      index += 1;
    } else if (name === "--summary") {
      options.summaryPath = resolve(takeValue(args, index, name));
      index += 1;
    } else if (name === "--chrome") {
      options.executablePath = resolve(takeValue(args, index, name));
      index += 1;
    } else if (name === "--delay-ms") {
      options.delayMs = integer(takeValue(args, index, name), name, {
        min: 250,
        max: 60_000,
      });
      index += 1;
    } else if (name === "--request-timeout-ms") {
      options.requestTimeoutMs = integer(
        takeValue(args, index, name),
        name,
        { min: 2_000, max: 120_000 },
      );
      index += 1;
    } else if (name === "--challenge-timeout-ms") {
      options.challengeTimeoutMs = integer(
        takeValue(args, index, name),
        name,
        { min: 1_000, max: 900_000 },
      );
      index += 1;
    } else if (name === "--max-retries") {
      options.maxRetries = integer(takeValue(args, index, name), name, {
        min: 0,
        max: 3,
      });
      index += 1;
    } else if (name === "--max-pages") {
      options.maxPages = integer(takeValue(args, index, name), name, {
        min: 1,
        max: 100_000,
      });
      index += 1;
    } else if (name === "--headed") {
      options.headed = true;
    } else if (name === "--headless") {
      options.headed = false;
    } else if (name === "--interactive-challenge") {
      options.interactiveChallenge = true;
    } else if (name === "--help" || name === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${name}`);
    }
  }

  if (options.mode === "incremental") {
    const error = new Error(
      "Incremental publication is disabled for accuracy-first operation; rerun --mode full to update reviews",
    );
    error.code = "INCREMENTAL_DISABLED";
    throw error;
  }
  if (!["canary", "full"].includes(options.mode)) {
    throw new Error("--mode must be canary or full");
  }
  if (options.interactiveChallenge) {
    // A human cannot resolve a challenge in an invisible browser.
    options.headed = true;
  }
  options.propertyKeys = [...new Set(options.propertyKeys)];
  return options;
}

export const SCRAPE_HELP = `Accuracy-first Azzurro Booking review collector

Usage:
  npm run canary
  npm run scrape -- --mode full [--property olympic_paddington]

Options:
  --mode canary|full
  --property key[,key]       Select one or more configured properties
  --properties path          Property configuration JSON
  --db path                  SQLite database path
  --summary path             Sanitized run summary JSON path
  --chrome path              Optional installed Chrome executable
  --delay-ms 250..60000      Delay between structured page requests
  --request-timeout-ms n     Per-request timeout
  --interactive-challenge    Show challenges for manual human resolution
  --challenge-timeout-ms n   Human resolution window, 1000..900000
  --max-retries 0..3         Retry budget for timeout/network/5xx only
  --max-pages n              Safety cap, mainly for testing
  --headed                   Show the fresh anonymous browser
  --headless                 Run the browser headlessly (default)

Without --chrome or AZZURRO_CHROME_PATH, Playwright's installed Chromium is used.
`;
