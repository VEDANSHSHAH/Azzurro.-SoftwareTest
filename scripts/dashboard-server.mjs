import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDashboardDataService,
  DashboardDataError,
} from "../src/dashboard-data.mjs";
import {
  CollectJobError,
  createCollectJobRunner,
} from "../src/collect-job.mjs";
import { loadProperties } from "../src/property-config.mjs";

const projectRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const host = readArgument("--host", "127.0.0.1");
const port = Number(readArgument("--port", "4318"));
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("--port must be an integer from 1 to 65535");
}
const dbPath = resolve(
  projectRoot,
  readArgument("--db", "data/azzurro-reviews.sqlite"),
);
const propertiesPath = resolve(
  projectRoot,
  readArgument("--properties", "config/properties.json"),
);

const service = createDashboardDataService({
  dbPath,
  propertiesPath,
});

const collectRunner = createCollectJobRunner({
  projectRoot,
  databasePath: dbPath,
  propertiesPath,
});

function allowedOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      (url.protocol === "http:" || url.protocol === "https:")
    ) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

/*
 * The collect endpoints start a real browser process, so they are guarded
 * beyond ordinary CORS. The listener is already bound to loopback; these checks
 * additionally stop a page in the user's browser from driving the collector via
 * a cross-site request or a rebound DNS name.
 */
const COLLECT_INTENT_HEADER = "x-azzurro-collect";

function isLoopbackHost(value) {
  if (!value) return false;
  const withoutPort = value.replace(/:\d+$/, "").toLowerCase();
  return (
    withoutPort === "127.0.0.1" ||
    withoutPort === "localhost" ||
    withoutPort === "[::1]" ||
    withoutPort === "::1"
  );
}

function collectRequestIsTrusted(request) {
  if (!isLoopbackHost(request.headers.host)) return false;
  /* A cross-origin page cannot set this header without a preflight, and the
     preflight only succeeds for loopback origins. */
  if (request.headers[COLLECT_INTENT_HEADER] !== "1") return false;
  const origin = request.headers.origin;
  return !origin || allowedOrigin(origin) !== null;
}

function responseHeaders(request) {
  const origin = allowedOrigin(request.headers.origin);
  return {
    "Access-Control-Allow-Headers": `Accept, Content-Type, ${COLLECT_INTENT_HEADER}`,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...(origin
      ? {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
        }
      : {}),
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-site",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function sendJson(request, response, status, value) {
  response.writeHead(status, responseHeaders(request));
  response.end(JSON.stringify(value));
}

function readJsonBody(request, limitBytes = 8192) {
  return new Promise((resolvePromise, rejectPromise) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limitBytes) {
        rejectPromise(new CollectJobError("BODY_TOO_LARGE", "Request too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!raw.trim()) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(raw));
      } catch {
        rejectPromise(new CollectJobError("INVALID_JSON", "Invalid JSON body."));
      }
    });
    request.on("error", () =>
      rejectPromise(new CollectJobError("BODY_READ_FAILED", "Body read failed.")),
    );
  });
}

async function handleCollectStart(request, response) {
  if (!collectRequestIsTrusted(request)) {
    sendJson(request, response, 403, {
      error: "Collection can only be started from the local dashboard.",
      code: "COLLECT_FORBIDDEN",
    });
    return;
  }
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(request, response, 400, {
      error: error.message,
      code: error.code ?? "INVALID_BODY",
    });
    return;
  }

  const configured = await loadProperties(propertiesPath);
  const configuredKeys = configured.map((entry) => entry.key);
  const requested =
    Array.isArray(body.properties) && body.properties.length > 0
      ? body.properties
      : configuredKeys;
  const unknown = requested.filter((key) => !configuredKeys.includes(key));
  if (unknown.length > 0) {
    sendJson(request, response, 400, {
      error: `Unknown property: ${unknown.join(", ")}`,
      code: "COLLECT_UNKNOWN_PROPERTY",
    });
    return;
  }

  try {
    const started = collectRunner.start({
      propertyKeys: requested,
      headed: body.headed !== false,
      interactiveChallenge: body.interactiveChallenge !== false,
    });
    sendJson(request, response, 202, started);
  } catch (error) {
    if (error instanceof CollectJobError) {
      sendJson(request, response, 409, {
        error: error.message,
        code: error.code,
      });
      return;
    }
    throw error;
  }
}

const server = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, responseHeaders(request));
    response.end();
    return;
  }
  let url;
  try {
    url = new URL(request.url ?? "/", `http://${host}:${port}`);
  } catch {
    sendJson(request, response, 400, { error: "Invalid request URL." });
    return;
  }

  if (url.pathname === "/api/collect") {
    if (request.method === "POST") {
      handleCollectStart(request, response).catch(() => {
        sendJson(request, response, 500, {
          error: "The collection could not be started.",
        });
      });
      return;
    }
    if (request.method === "GET") {
      sendJson(request, response, 200, collectRunner.status());
      return;
    }
    if (request.method === "DELETE") {
      if (!collectRequestIsTrusted(request)) {
        sendJson(request, response, 403, {
          error: "Collection can only be controlled from the local dashboard.",
          code: "COLLECT_FORBIDDEN",
        });
        return;
      }
      try {
        sendJson(request, response, 200, collectRunner.cancel());
      } catch (error) {
        sendJson(request, response, 409, {
          error: error.message,
          code: error.code ?? "COLLECT_NOT_RUNNING",
        });
      }
      return;
    }
    sendJson(request, response, 405, {
      error: "Unsupported method for /api/collect.",
    });
    return;
  }

  if (request.method !== "GET") {
    sendJson(request, response, 405, {
      error: "Only GET requests are supported.",
    });
    return;
  }
  if (url.pathname === "/api/health") {
    sendJson(request, response, 200, {
      ok: true,
      service: "azzurro-review-dashboard",
    });
    return;
  }
  if (url.pathname !== "/api/dashboard") {
    sendJson(request, response, 404, { error: "Route not found." });
    return;
  }
  try {
    const payload = service.build(url.searchParams);
    sendJson(request, response, 200, payload);
  } catch (error) {
    if (error instanceof DashboardDataError) {
      sendJson(request, response, 400, {
        error: error.message,
        code: error.code,
      });
      return;
    }
    process.stderr.write(
      `[dashboard] ${new Date().toISOString()} request failed: ${
        error instanceof Error ? error.name : "UnknownError"
      }\n`,
    );
    sendJson(request, response, 500, {
      error: "The verified dashboard data could not be prepared.",
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `Azzurro dashboard data service: http://${host}:${port}\n`,
  );
});

function stop(signal) {
  collectRunner.dispose();
  server.close((error) => {
    if (error) {
      process.stderr.write(`[dashboard] shutdown failed after ${signal}\n`);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
