const IMMEDIATE_CIRCUIT_CODES = new Set([
  "RATE_LIMITED",
  "ACCESS_DENIED",
  "CHALLENGE",
  "CHALLENGE_TIMEOUT",
  "REVIEW_HTTP_ERROR",
]);

export const REVIEW_CAPTURE_TIMEOUT_CIRCUIT_THRESHOLD = 2;

export function nextCircuitDecision({
  code,
  consecutiveReviewCaptureTimeouts = 0,
}) {
  if (
    !Number.isSafeInteger(consecutiveReviewCaptureTimeouts) ||
    consecutiveReviewCaptureTimeouts < 0
  ) {
    throw new TypeError(
      "consecutiveReviewCaptureTimeouts must be a non-negative integer",
    );
  }
  if (code === "REVIEW_CAPTURE_TIMEOUT") {
    const consecutive = consecutiveReviewCaptureTimeouts + 1;
    return {
      open:
        consecutive >= REVIEW_CAPTURE_TIMEOUT_CIRCUIT_THRESHOLD,
      consecutiveReviewCaptureTimeouts: consecutive,
    };
  }
  return {
    open: IMMEDIATE_CIRCUIT_CODES.has(code),
    consecutiveReviewCaptureTimeouts: 0,
  };
}

export const circuitPolicyInternals = Object.freeze({
  IMMEDIATE_CIRCUIT_CODES,
});
