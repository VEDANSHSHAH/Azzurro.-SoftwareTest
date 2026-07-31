export class BrowserBootstrapError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BrowserBootstrapError";
    this.code = code;
    this.details = details;
  }
}

const CHALLENGE_PATTERNS = [
  /\bcaptcha\b/i,
  /verify (?:that )?you(?:'re| are) (?:a )?human/i,
  /unusual traffic/i,
  /automated (?:queries|requests|traffic)/i,
  /access (?:is )?denied/i,
  /security challenge/i,
];

export function isChallengeDocument({
  status,
  title = "",
  bodyText = "",
}) {
  if (status === 202) return true;
  const diagnosticText = `${title}\n${bodyText.slice(0, 10_000)}`;
  return CHALLENGE_PATTERNS.some((pattern) =>
    pattern.test(diagnosticText),
  );
}

export function isCanonicalPropertyDocument({
  finalUrl,
  canonicalUrl,
  allowLocalTestOrigin = false,
}) {
  let actual;
  let expected;
  try {
    actual = new URL(finalUrl);
    expected = new URL(canonicalUrl);
  } catch {
    return false;
  }
  const local =
    allowLocalTestOrigin &&
    ["127.0.0.1", "localhost"].includes(expected.hostname);
  return (
    actual.origin === expected.origin &&
    actual.pathname === expected.pathname &&
    (local || actual.hostname === "www.booking.com")
  );
}

export function inspectBootstrapDocument({
  status,
  finalUrl,
  canonicalUrl,
  title = "",
  bodyText = "",
  allowLocalTestOrigin = false,
}) {
  if (status === 202) {
    throw new BrowserBootstrapError(
      "CHALLENGE",
      "Booking returned a 202 challenge page",
    );
  }
  if (status === 401 || status === 403 || status === 429) {
    throw new BrowserBootstrapError(
      status === 429 ? "RATE_LIMITED" : "ACCESS_DENIED",
      `Property document returned HTTP ${status}`,
    );
  }
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    throw new BrowserBootstrapError(
      "DOCUMENT_HTTP_ERROR",
      `Property document returned HTTP ${status}`,
    );
  }
  if (isChallengeDocument({ status, title, bodyText })) {
    throw new BrowserBootstrapError(
      "CHALLENGE",
      "A browser challenge or access-denial page was detected",
    );
  }
  if (
    !isCanonicalPropertyDocument({
      finalUrl,
      canonicalUrl,
      allowLocalTestOrigin,
    })
  ) {
    const expected = new URL(canonicalUrl);
    const actual = new URL(finalUrl);
    throw new BrowserBootstrapError(
      "PROPERTY_REDIRECT",
      "Property navigation ended at an unexpected URL",
      { expectedPath: expected.pathname, actualPath: actual.pathname },
    );
  }
  return true;
}
