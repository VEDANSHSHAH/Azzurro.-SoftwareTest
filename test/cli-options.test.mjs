import test from "node:test";
import assert from "node:assert/strict";

import {
  parseScrapeOptions,
  SCRAPE_HELP,
} from "../src/cli-options.mjs";

test("defaults to a safe canary and sequential pacing", () => {
  const options = parseScrapeOptions([], "C:\\project", {});
  assert.equal(options.mode, "canary");
  assert.equal(options.delayMs, 750);
  assert.equal(options.headed, false);
  assert.equal(options.interactiveChallenge, false);
  assert.equal(options.executablePath, null);
  assert.equal(options.challengeTimeoutMs, 180_000);
  assert.deepEqual(options.propertyKeys, []);
});

test("uses Playwright Chromium by default and accepts explicit Chrome overrides", () => {
  const environmentPath = "C:\\Browsers\\Chrome\\chrome.exe";
  const fromEnvironment = parseScrapeOptions(
    [],
    "C:\\project",
    { AZZURRO_CHROME_PATH: environmentPath },
  );
  assert.equal(fromEnvironment.executablePath, environmentPath);

  const explicitPath = "C:\\Portable\\Chrome\\chrome.exe";
  const explicit = parseScrapeOptions(
    ["--chrome", explicitPath],
    "C:\\project",
    { AZZURRO_CHROME_PATH: environmentPath },
  );
  assert.equal(explicit.executablePath, explicitPath);
  assert.match(SCRAPE_HELP, /Playwright's installed Chromium/);
});

test("parses selected properties and full mode", () => {
  const options = parseScrapeOptions(
    [
      "--mode",
      "full",
      "--property",
      "a,b",
      "--property",
      "b",
      "--delay-ms",
      "500",
      "--headed",
    ],
    "C:\\project",
  );
  assert.equal(options.mode, "full");
  assert.deepEqual(options.propertyKeys, ["a", "b"]);
  assert.equal(options.delayMs, 500);
  assert.equal(options.headed, true);
});

test("interactive challenge mode is always headed and validates its timeout", () => {
  const options = parseScrapeOptions(
    [
      "--interactive-challenge",
      "--challenge-timeout-ms",
      "45000",
      "--headless",
    ],
    "C:\\project",
  );
  assert.equal(options.interactiveChallenge, true);
  assert.equal(options.headed, true);
  assert.equal(options.challengeTimeoutMs, 45_000);

  assert.throws(
    () =>
      parseScrapeOptions(
        ["--challenge-timeout-ms", "999"],
        "C:\\project",
      ),
    /1000/,
  );
  assert.throws(
    () =>
      parseScrapeOptions(
        ["--challenge-timeout-ms", "900001"],
        "C:\\project",
      ),
    /900000/,
  );
});

test("rejects unsafe or ambiguous options", () => {
  assert.throws(
    () => parseScrapeOptions(["--delay-ms", "10"], "C:\\project"),
    /250/,
  );
  assert.throws(
    () => parseScrapeOptions(["--property"], "C:\\project"),
    /requires a value/,
  );
  assert.throws(
    () => parseScrapeOptions(["--unknown"], "C:\\project"),
    /Unknown option/,
  );
  assert.throws(
    () =>
      parseScrapeOptions(
        ["--mode", "incremental"],
        "C:\\project",
      ),
    (error) =>
      error?.code === "INCREMENTAL_DISABLED" &&
      /rerun --mode full/.test(error.message),
  );
  assert.doesNotMatch(SCRAPE_HELP, /incremental/);
});
