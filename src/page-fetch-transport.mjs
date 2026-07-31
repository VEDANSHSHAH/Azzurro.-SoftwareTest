import { buildLivePayload } from "./live-template.mjs";

export function createPageFetchTransport({
  page,
  template,
  timeoutMs = 20_000,
}) {
  if (!page || typeof page.evaluate !== "function") {
    throw new TypeError("A Playwright page is required");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new TypeError("timeoutMs must be at least 1000");
  }

  return async function fetchRaw(options) {
    const payload = buildLivePayload(template, options);
    try {
      return await page.evaluate(
        async ({
          endpoint,
          headers,
          payload: body,
          requestTimeoutMs,
          requestWasBatch,
        }) => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            requestTimeoutMs,
          );
          const started = performance.now();
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              credentials: "include",
              cache: "no-store",
              redirect: "error",
              signal: controller.signal,
            });
            const responseText = await response.text();
            let text = responseText;
            if (
              requestWasBatch &&
              response.headers
                .get("content-type")
                ?.toLowerCase()
                .includes("json")
            ) {
              try {
                const batch = JSON.parse(responseText);
                if (!Array.isArray(batch) || batch.length !== 1) {
                  throw new Error("Unexpected GraphQL batch response");
                }
                text = JSON.stringify(batch[0]);
              } catch {
                // Leave the original body intact so normal response
                // classification fails closed with useful contract evidence.
              }
            }
            return {
              status: response.status,
              contentType: response.headers.get("content-type") ?? "",
              retryAfter: response.headers.get("retry-after"),
              text,
              responseBytes: new TextEncoder().encode(responseText).length,
              elapsedMs: Math.round(performance.now() - started),
            };
          } catch (error) {
            return {
              status: null,
              contentType: "",
              retryAfter: null,
              text: "",
              responseBytes: 0,
              elapsedMs: Math.round(performance.now() - started),
              classification: {
                kind:
                  error?.name === "AbortError"
                    ? "timeout"
                    : "network_error",
              },
            };
          } finally {
            clearTimeout(timeout);
          }
        },
        {
          endpoint: template.endpoint,
          headers: template.headers,
          payload,
          requestTimeoutMs: timeoutMs,
          requestWasBatch: template.requestWasBatch === true,
        },
      );
    } catch {
      return {
        status: null,
        contentType: "",
        retryAfter: null,
        text: "",
        responseBytes: 0,
        elapsedMs: 0,
        classification: { kind: "network_error" },
      };
    }
  };
}
