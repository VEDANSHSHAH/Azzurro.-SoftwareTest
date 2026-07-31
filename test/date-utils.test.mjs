import test from "node:test";
import assert from "node:assert/strict";

import {
  mondayWeekStart,
  sydneyDateFromEpoch,
  sydneyWeekStartFromEpoch,
} from "../src/date-utils.mjs";

test("converts a source epoch to the Sydney calendar date", () => {
  const epoch = Math.floor(
    Date.parse("2026-07-30T15:30:00Z") / 1000,
  );
  assert.equal(sydneyDateFromEpoch(epoch), "2026-07-31");
});

test("uses Monday as the dashboard week boundary", () => {
  assert.equal(mondayWeekStart("2026-08-02"), "2026-07-27");
  assert.equal(mondayWeekStart("2026-08-03"), "2026-08-03");
  assert.equal(mondayWeekStart("2024-02-29"), "2024-02-26");
});

test("rejects impossible calendar dates instead of rolling them over", () => {
  for (const invalid of [
    "2026-02-29",
    "2026-02-31",
    "2026-04-31",
    "2026-00-10",
    "2026-13-10",
    "0000-01-01",
    "2026-1-01",
    "not-a-date",
  ]) {
    assert.throws(() => mondayWeekStart(invalid));
  }
});

test("week assignment is based on Sydney time, not machine time", () => {
  const justAfterSydneyMonday = Math.floor(
    Date.parse("2026-08-02T14:05:00Z") / 1000,
  );
  assert.equal(
    sydneyWeekStartFromEpoch(justAfterSydneyMonday),
    "2026-08-03",
  );
});

test("Sydney date conversion remains stable around daylight saving", () => {
  const beforeTransition = Math.floor(
    Date.parse("2026-10-03T15:30:00Z") / 1000,
  );
  const afterTransition = Math.floor(
    Date.parse("2026-10-03T16:30:00Z") / 1000,
  );
  assert.equal(sydneyDateFromEpoch(beforeTransition), "2026-10-04");
  assert.equal(sydneyDateFromEpoch(afterTransition), "2026-10-04");
});

test("rejects unsafe or unsupported epoch values explicitly", () => {
  for (const invalid of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(() => sydneyDateFromEpoch(invalid));
  }
});
