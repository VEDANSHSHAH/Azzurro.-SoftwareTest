function cookiePairs(setCookieHeaders) {
  return setCookieHeaders
    .map((header) => header.split(";", 1)[0])
    .filter((pair) => pair.includes("="));
}

function cookieNames(pairs) {
  return pairs.map((pair) => pair.slice(0, pair.indexOf("=")));
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractAnonymousContext(html) {
  return {
    csrfToken: firstMatch(html, [
      /"b_csrf_token"\s*:\s*"([^"]+)"/i,
      /"csrf_token"\s*:\s*"([^"]+)"/i,
      /\bb_csrf_token\s*=\s*["']([^"']+)["']/i,
      /"csrfToken"\s*:\s*"([^"]+)"/i,
    ]),
    pageviewId: firstMatch(html, [
      /"pageview_id"\s*:\s*"([^"]+)"/i,
      /"pageviewId"\s*:\s*"([^"]+)"/i,
      /\bpageview_id\s*=\s*["']([^"']+)["']/i,
    ]),
    serializedState: firstMatch(html, [
      /"et_serialized_state"\s*:\s*"([^"]+)"/i,
      /"serializedState"\s*:\s*"([^"]+)"/i,
    ]),
  };
}

export async function bootstrapAnonymousProperty(
  canonicalUrl,
  { timeoutMs = 20_000 } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const response = await fetch(canonicalUrl, {
      method: "GET",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.8",
        "user-agent": "AzzurroTrialReviewValidator/0.1",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const html = await response.text();
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    const pairs = cookiePairs(setCookies);
    const context = extractAnonymousContext(html);

    return {
      status: response.status,
      elapsedMs: Math.round(performance.now() - started),
      finalUrl: response.url,
      contentType: response.headers.get("content-type") ?? "",
      html,
      cookieHeader: pairs.join("; "),
      context,
      diagnostics: {
        htmlBytes: Buffer.byteLength(html),
        cookieNames: cookieNames(pairs),
        hasCsrfToken: Boolean(context.csrfToken),
        hasPageviewId: Boolean(context.pageviewId),
        hasSerializedState: Boolean(context.serializedState),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function contextHeaders(bootstrap) {
  const headers = {};
  if (bootstrap.cookieHeader) {
    headers.cookie = bootstrap.cookieHeader;
  }
  if (bootstrap.context.csrfToken) {
    headers["x-booking-csrf-token"] = bootstrap.context.csrfToken;
  }
  if (bootstrap.context.pageviewId) {
    headers["x-booking-pageview-id"] = bootstrap.context.pageviewId;
  }
  if (bootstrap.context.serializedState) {
    headers["x-booking-et-serialized-state"] =
      bootstrap.context.serializedState;
  }
  return headers;
}
