import { classifyHttpBody } from "./review-contract.mjs";

const ENDPOINT = "https://www.booking.com/dml/graphql?lang=en-us";

function headersFor(profile, referer) {
  const headers = {
    accept: "*/*",
    "content-type": "application/json",
  };

  if (profile === "semantic") {
    Object.assign(headers, {
      origin: "https://www.booking.com",
      referer,
      "x-apollo-operation-name": "ReviewList",
      "apollographql-client-name": "b-property-web-property-page",
      "x-booking-context-action": "hotel",
      "x-booking-context-action-name": "hotel",
      "x-booking-site-type-id": "1",
      "x-booking-topic":
        "capla_browser_b-property-web-property-page",
    });
  } else if (profile !== "minimal") {
    throw new Error(`Unknown HTTP header profile: ${profile}`);
  }

  return headers;
}

export async function fetchReviewPage({
  payload,
  referer,
  profile = "minimal",
  timeoutMs = 15_000,
  extraHeaders = {},
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        ...headersFor(profile, referer),
        ...extraHeaders,
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      status: response.status,
      elapsedMs: Math.round(performance.now() - started),
      contentType: response.headers.get("content-type") ?? "",
      retryAfter: response.headers.get("retry-after"),
      classification: classifyHttpBody({
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        text,
      }),
    };
  } catch (error) {
    return {
      status: null,
      elapsedMs: Math.round(performance.now() - started),
      contentType: "",
      retryAfter: null,
      classification: {
        kind:
          error?.name === "AbortError" ? "timeout" : "network_error",
        detail: error?.message ?? String(error),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
