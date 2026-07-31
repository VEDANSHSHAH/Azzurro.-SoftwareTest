export const RETRYABLE_KINDS = Object.freeze([
  "timeout",
  "network_error",
  "temporary_server_error",
]);

function nonNegativeFinite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`);
  }
  return value;
}

function positiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export function parseRetryAfter(value, { nowMs = Date.now() } = {}) {
  nonNegativeFinite(nowMs, "nowMs");
  if (value == null) return null;
  const text = String(value).trim();
  if (text === "") return null;

  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    if (!Number.isSafeInteger(seconds)) return null;
    const milliseconds = seconds * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }

  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round(timestamp - nowMs));
}

export function computeBackoffDelay({
  attempt,
  baseDelayMs = 500,
  maxDelayMs = 30_000,
  jitterRatio = 0.2,
  random = Math.random,
} = {}) {
  positiveSafeInteger(attempt, "attempt");
  nonNegativeFinite(baseDelayMs, "baseDelayMs");
  nonNegativeFinite(maxDelayMs, "maxDelayMs");
  if (
    typeof jitterRatio !== "number" ||
    !Number.isFinite(jitterRatio) ||
    jitterRatio < 0 ||
    jitterRatio > 1
  ) {
    throw new TypeError("jitterRatio must be between 0 and 1");
  }
  if (typeof random !== "function") {
    throw new TypeError("random must be a function");
  }
  const sample = random();
  if (
    typeof sample !== "number" ||
    !Number.isFinite(sample) ||
    sample < 0 ||
    sample > 1
  ) {
    throw new TypeError("random must return a number between 0 and 1");
  }

  const exponent = Math.min(attempt - 1, 52);
  const unbounded = baseDelayMs * 2 ** exponent;
  const base = Math.min(maxDelayMs, unbounded);
  const jitter = base * jitterRatio;
  const jittered = base - jitter + 2 * jitter * sample;
  return Math.round(Math.max(0, Math.min(maxDelayMs, jittered)));
}

export function retryDecision({
  classification,
  attempt,
  maxAttempts = 3,
  retryAfter = null,
  nowMs = Date.now(),
  baseDelayMs = 500,
  maxDelayMs = 30_000,
  jitterRatio = 0.2,
  random = Math.random,
} = {}) {
  positiveSafeInteger(attempt, "attempt");
  positiveSafeInteger(maxAttempts, "maxAttempts");
  const kind =
    typeof classification === "string"
      ? classification
      : classification?.kind;

  if (kind === "rate_limited") {
    return {
      retry: false,
      delayMs: null,
      rescheduleAfterMs: parseRetryAfter(retryAfter, { nowMs }),
      reason: "rate_limited",
    };
  }
  if (!RETRYABLE_KINDS.includes(kind)) {
    return {
      retry: false,
      delayMs: null,
      rescheduleAfterMs: null,
      reason: "not_retryable",
    };
  }
  if (attempt >= maxAttempts) {
    return {
      retry: false,
      delayMs: null,
      rescheduleAfterMs: null,
      reason: "attempt_budget_exhausted",
    };
  }
  return {
    retry: true,
    delayMs: computeBackoffDelay({
      attempt,
      baseDelayMs,
      maxDelayMs,
      jitterRatio,
      random,
    }),
    rescheduleAfterMs: null,
    reason: "temporary_failure",
  };
}
