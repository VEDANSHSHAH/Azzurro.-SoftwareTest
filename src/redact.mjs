export const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "cookies",
  "cookieheader",
  "cookiejar",
  "setcookie",
  "setcookieheaders",
  "xbookingcsrftoken",
  "xbookingpageviewid",
  "xbookingetserializedstate",
  "csrftoken",
  "bcsrftoken",
  "pageviewid",
  "serializedstate",
  "password",
  "passwd",
  "clientsecret",
  "secret",
  "apikey",
  "accesskey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessionid",
  "sid",
  "sourcereviewtoken",
  "sourcekey",
  "reviewurl",
  "editurl",
  "username",
  "avatarurl",
  "title",
  "positivetext",
  "negativetext",
  "combinedtext",
  "reply",
  "partnerreply",
  "sourcecard",
  "html",
]);

const SENSITIVE_QUERY_PARAMETERS = new Set([
  "sid",
  "label",
  "aid",
  "srpvid",
  "srepoch",
  "session",
  "sessionid",
  "token",
  "csrf",
  "csrf_token",
  "auth",
  "authorization",
  "apikey",
  "api_key",
  "key",
  "password",
]);

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key) {
  const normalized = normalizedKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token")
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactUrl(value, replacement = REDACTED) {
  if (typeof value !== "string") return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return value;

  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAMETERS.has(key.toLowerCase())) {
      parsed.searchParams.set(key, replacement);
    }
  }
  return parsed.toString();
}

function redactString(value, replacement, sensitiveValues) {
  let redacted = value.replace(
    /([?&](?:sid|label|aid|srpvid|srepoch|session(?:id)?|token|csrf(?:_token)?|auth(?:orization)?|api_?key|key|password)=)[^&#\s]*/gi,
    `$1${replacement}`,
  );
  redacted = redacted.replace(
    /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-booking-csrf-token|x-booking-pageview-id|x-booking-et-serialized-state)\s*[:=]\s*[^\r\n]+/gi,
    (match) => `${match.split(/[:=]/, 1)[0]}: ${replacement}`,
  );
  redacted = redacted.replace(
    /https?:\/\/[^\s"'<>]+/gi,
    (url) => redactUrl(url, replacement),
  );
  for (const secret of sensitiveValues) {
    if (typeof secret === "string" && secret.length > 0) {
      redacted = redacted.replace(
        new RegExp(escapeRegExp(secret), "g"),
        replacement,
      );
    }
  }
  return redacted;
}

export function redactSensitive(
  value,
  {
    replacement = REDACTED,
    sensitiveValues = [],
    maxDepth = 20,
  } = {},
) {
  if (typeof replacement !== "string" || replacement.length === 0) {
    throw new TypeError("replacement must be a non-empty string");
  }
  if (!Array.isArray(sensitiveValues)) {
    throw new TypeError("sensitiveValues must be an array");
  }
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    throw new TypeError("maxDepth must be a positive safe integer");
  }

  const seen = new WeakSet();

  function visit(current, depth) {
    if (typeof current === "string") {
      return redactString(current, replacement, sensitiveValues);
    }
    if (
      current == null ||
      typeof current === "number" ||
      typeof current === "boolean" ||
      typeof current === "bigint"
    ) {
      return current;
    }
    if (typeof current !== "object") return String(current);
    if (depth >= maxDepth) return "[MaxDepth]";
    if (seen.has(current)) return "[Circular]";
    seen.add(current);

    if (current instanceof Date) return current.toISOString();
    if (
      typeof Headers !== "undefined" &&
      current instanceof Headers
    ) {
      return visit(Object.fromEntries(current.entries()), depth + 1);
    }
    if (current instanceof Map) {
      return visit(Object.fromEntries(current.entries()), depth + 1);
    }
    if (current instanceof Set) {
      return visit([...current], depth + 1);
    }
    if (current instanceof Error) {
      const errorValue = {
        name: current.name,
        message: current.message,
        stack: current.stack,
        ...Object.fromEntries(
          Object.entries(current).filter(
            ([key]) => !["name", "message", "stack"].includes(key),
          ),
        ),
      };
      return visit(errorValue, depth + 1);
    }
    if (Array.isArray(current)) {
      return current.map((item) => visit(item, depth + 1));
    }

    return Object.fromEntries(
      Object.entries(current).map(([key, item]) => [
        key,
        isSensitiveKey(key)
          ? replacement
          : visit(item, depth + 1),
      ]),
    );
  }

  return visit(value, 0);
}

export function redactHeaders(headers, options) {
  if (
    typeof Headers !== "undefined" &&
    headers instanceof Headers
  ) {
    return redactSensitive(
      Object.fromEntries(headers.entries()),
      options,
    );
  }
  if (headers instanceof Map) {
    return redactSensitive(Object.fromEntries(headers), options);
  }
  return redactSensitive(headers ?? {}, options);
}

export const redactForLog = redactSensitive;
