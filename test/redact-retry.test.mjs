import test from "node:test";
import assert from "node:assert/strict";

import {
  REDACTED,
  redactForLog,
  redactHeaders,
  redactSensitive,
  redactUrl,
} from "../src/redact.mjs";
import {
  computeBackoffDelay,
  parseRetryAfter,
  retryDecision,
} from "../src/retry.mjs";

test("deeply redacts sensitive keys case-insensitively without mutation", () => {
  const input = {
    headers: {
      Cookie: "session=secret-cookie",
      AUTHORIZATION: "Bearer secret-access",
      "X-Booking-CSRF-Token": "secret-csrf",
      Referer:
        "https://www.booking.com/hotel/au/example.html?sid=secret-sid&dest_id=12",
    },
    context: {
      PageView_ID: "secret-page",
      nested: {
        serialized_state: "secret-state",
        sourceReviewToken: "secret-review",
      },
    },
    cookieHeader: "session=secret-cookie-header",
    html: "<script>secret-page-state</script>",
    status: 200,
  };
  const original = structuredClone(input);
  const result = redactForLog(input);

  assert.deepEqual(input, original);
  assert.equal(result.headers.Cookie, REDACTED);
  assert.equal(result.headers.AUTHORIZATION, REDACTED);
  assert.equal(result.headers["X-Booking-CSRF-Token"], REDACTED);
  assert.equal(result.context.PageView_ID, REDACTED);
  assert.equal(result.context.nested.serialized_state, REDACTED);
  assert.equal(result.context.nested.sourceReviewToken, REDACTED);
  assert.equal(result.cookieHeader, REDACTED);
  assert.equal(result.html, REDACTED);
  assert.equal(result.status, 200);

  const referer = new URL(result.headers.Referer);
  assert.equal(referer.searchParams.get("sid"), REDACTED);
  assert.equal(referer.searchParams.get("dest_id"), "12");
});

test("redacts tracking query values while retaining safe URL structure", () => {
  const result = redactUrl(
    "https://www.booking.com/hotel/au/example.html?aid=123&label=campaign&ufi=-1",
  );
  const parsed = new URL(result);
  assert.equal(parsed.searchParams.get("aid"), REDACTED);
  assert.equal(parsed.searchParams.get("label"), REDACTED);
  assert.equal(parsed.searchParams.get("ufi"), "-1");
});

test("redacts headers, errors, URL text and explicit sentinel values", () => {
  const headers = redactHeaders({
    "set-cookie": "session=secret",
    Accept: "application/json",
  });
  assert.equal(headers["set-cookie"], REDACTED);
  assert.equal(headers.Accept, "application/json");

  const error = new Error(
    "failed https://example.test/?sid=secret-sid sentinel-secret",
  );
  error.context = { password: "secret-password" };
  const result = redactSensitive(error, {
    sensitiveValues: ["sentinel-secret"],
  });
  assert.equal(result.name, "Error");
  assert.doesNotMatch(result.message, /secret-sid|sentinel-secret/);
  assert.equal(result.context.password, REDACTED);
});

test("redaction handles circular and excessively deep structures safely", () => {
  const circular = { safe: true };
  circular.self = circular;
  assert.equal(redactSensitive(circular).self, "[Circular]");

  const deep = { level: { level: { value: "safe" } } };
  assert.equal(
    redactSensitive(deep, { maxDepth: 2 }).level.level,
    "[MaxDepth]",
  );
});

test("parses Retry-After delta seconds and HTTP dates", () => {
  const nowMs = Date.parse("2026-07-31T00:00:00Z");
  assert.equal(parseRetryAfter("12", { nowMs }), 12_000);
  assert.equal(
    parseRetryAfter("Fri, 31 Jul 2026 00:00:05 GMT", { nowMs }),
    5_000,
  );
  assert.equal(
    parseRetryAfter("Thu, 30 Jul 2026 23:59:59 GMT", { nowMs }),
    0,
  );
  assert.equal(parseRetryAfter("invalid", { nowMs }), null);
  assert.equal(parseRetryAfter("", { nowMs }), null);
  assert.equal(
    parseRetryAfter("999999999999999999999", { nowMs }),
    null,
  );
});

test("computes capped exponential backoff with deterministic jitter", () => {
  assert.equal(
    computeBackoffDelay({
      attempt: 1,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      jitterRatio: 0,
      random: () => 0.5,
    }),
    100,
  );
  assert.equal(
    computeBackoffDelay({
      attempt: 2,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      jitterRatio: 0,
      random: () => 0.5,
    }),
    200,
  );
  assert.equal(
    computeBackoffDelay({
      attempt: 20,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      jitterRatio: 0.5,
      random: () => 1,
    }),
    1_000,
  );
  assert.equal(
    computeBackoffDelay({
      attempt: 1,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      jitterRatio: 0.5,
      random: () => 0,
    }),
    50,
  );
});

test("retry policy is bounded and fails closed for non-temporary errors", () => {
  assert.deepEqual(
    retryDecision({
      classification: { kind: "timeout" },
      attempt: 1,
      maxAttempts: 3,
      baseDelayMs: 500,
      jitterRatio: 0,
      random: () => 0.5,
    }),
    {
      retry: true,
      delayMs: 500,
      rescheduleAfterMs: null,
      reason: "temporary_failure",
    },
  );
  assert.equal(
    retryDecision({
      classification: "network_error",
      attempt: 3,
      maxAttempts: 3,
    }).reason,
    "attempt_budget_exhausted",
  );
  assert.equal(
    retryDecision({
      classification: "invalid_json",
      attempt: 1,
    }).reason,
    "not_retryable",
  );
});

test("rate limiting is rescheduled from Retry-After, not immediately retried", () => {
  assert.deepEqual(
    retryDecision({
      classification: "rate_limited",
      attempt: 1,
      retryAfter: "120",
      nowMs: 0,
    }),
    {
      retry: false,
      delayMs: null,
      rescheduleAfterMs: 120_000,
      reason: "rate_limited",
    },
  );
});

test("retry helpers reject invalid policy inputs", () => {
  assert.throws(() => computeBackoffDelay({ attempt: 0 }));
  assert.throws(
    () =>
      computeBackoffDelay({
        attempt: 1,
        jitterRatio: 2,
      }),
  );
  assert.throws(
    () =>
      computeBackoffDelay({
        attempt: 1,
        random: () => -1,
      }),
  );
  assert.throws(
    () =>
      retryDecision({
        classification: "timeout",
        attempt: 1,
        maxAttempts: 0,
      }),
  );
});
