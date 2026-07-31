import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDashboardDataService,
  DashboardDataError,
} from "../src/dashboard-data.mjs";

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

function responseHeaders(request) {
  const origin = allowedOrigin(request.headers.origin);
  return {
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

const server = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, responseHeaders(request));
    response.end();
    return;
  }
  if (request.method !== "GET") {
    sendJson(request, response, 405, {
      error: "Only GET requests are supported.",
    });
    return;
  }
  let url;
  try {
    url = new URL(request.url ?? "/", `http://${host}:${port}`);
  } catch {
    sendJson(request, response, 400, { error: "Invalid request URL." });
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
  server.close((error) => {
    if (error) {
      process.stderr.write(`[dashboard] shutdown failed after ${signal}\n`);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
