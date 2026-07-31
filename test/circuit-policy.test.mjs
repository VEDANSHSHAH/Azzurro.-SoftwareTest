import test from "node:test";
import assert from "node:assert/strict";

import {
  nextCircuitDecision,
  REVIEW_CAPTURE_TIMEOUT_CIRCUIT_THRESHOLD,
} from "../src/circuit-policy.mjs";

test("capture timeout opens the circuit only when repeated", () => {
  assert.equal(REVIEW_CAPTURE_TIMEOUT_CIRCUIT_THRESHOLD, 2);
  const first = nextCircuitDecision({
    code: "REVIEW_CAPTURE_TIMEOUT",
  });
  assert.deepEqual(first, {
    open: false,
    consecutiveReviewCaptureTimeouts: 1,
  });
  const second = nextCircuitDecision({
    code: "REVIEW_CAPTURE_TIMEOUT",
    consecutiveReviewCaptureTimeouts:
      first.consecutiveReviewCaptureTimeouts,
  });
  assert.deepEqual(second, {
    open: true,
    consecutiveReviewCaptureTimeouts: 2,
  });
});

test("other outcomes reset capture-timeout streaks and hard stops remain immediate", () => {
  assert.deepEqual(
    nextCircuitDecision({
      code: "CONTRACT_ERROR",
      consecutiveReviewCaptureTimeouts: 1,
    }),
    {
      open: false,
      consecutiveReviewCaptureTimeouts: 0,
    },
  );
  assert.deepEqual(
    nextCircuitDecision({
      code: "RATE_LIMITED",
      consecutiveReviewCaptureTimeouts: 1,
    }),
    {
      open: true,
      consecutiveReviewCaptureTimeouts: 0,
    },
  );
});
