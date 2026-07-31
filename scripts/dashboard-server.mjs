import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDashboardDataService,
  DashboardDataError,
} from "../src/dashboard-data.mjs";
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
const configuredProperties = await loadProperties(propertiesPath);
const configuredPropertyKeys = new Set(
  configuredProperties.map((property) => property.key),
);

let activeCollection = null;
let collectionStatus = {
  status: "idle",
  propertyKeys: [],
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  message: "No collection has been started in this local session.",
};

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

function collectionPayload() {
  return {
    ...collectionStatus,
    running: activeCollection !== null,
  };
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_048) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function selectedPropertyKeys(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Collection options must be an object.");
  }
  const { propertyKeys } = value;
  if (propertyKeys === undefined) {
    return configuredProperties.map((property) => property.key);
  }
  if (!Array.isArray(propertyKeys) || propertyKeys.length === 0) {
    return configuredProperties.map((property) => property.key);
  }
  if (
    propertyKeys.some(
      (propertyKey) =>
        typeof propertyKey !== "string" || !configuredPropertyKeys.has(propertyKey),
    )
  ) {
    throw new Error("One or more selected properties are not configured.");
  }
  return [...new Set(propertyKeys)];
}

function startCollection(propertyKeys) {
  if (activeCollection) {
    const error = new Error("A collection is already running.");
    error.code = "COLLECTION_RUNNING";
    throw error;
  }
  const child = spawn(
    process.execPath,
    [
      "scripts/scrape.mjs",
      "--mode",
      "full",
      "--property",
      propertyKeys.join(","),
      "--headed",
      "--interactive-challenge",
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    },
  );
  activeCollection = child;
  collectionStatus = {
    status: "running",
    propertyKeys,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    message:
      "Collection is running in a visible browser. Complete any Booking verification there; only complete verified results are published.",
  };
  child.on("error", (error) => {
    activeCollection = null;
    collectionStatus = {
      ...collectionStatus,
      status: "failed",
      finishedAt: new Date().toISOString(),
      message: `The collector could not start: ${error.message}`,
    };
  });
  child.on("close", (exitCode) => {
    activeCollection = null;
    collectionStatus = {
      ...collectionStatus,
      status: exitCode === 0 ? "completed" : "failed",
      finishedAt: new Date().toISOString(),
      exitCode,
      message:
        exitCode === 0
          ? "Collection finished. Reloading the dashboard will show any newly verified publications."
          : "Collection stopped without publishing a complete verified result for at least one property. Check the visible browser and run it again when ready.",
    };
  });
  return collectionPayload();
}

function sendJson(request, response, status, value) {
  response.writeHead(status, responseHeaders(request));
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
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
  if (request.method === "GET" && url.pathname === "/api/collection") {
    sendJson(request, response, 200, collectionPayload());
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/collection") {
    try {
      const body = await readJsonBody(request);
      const propertyKeys = selectedPropertyKeys(body);
      sendJson(request, response, 202, startCollection(propertyKeys));
    } catch (error) {
      const status = error?.code === "COLLECTION_RUNNING" ? 409 : 400;
      sendJson(request, response, status, {
        error:
          error instanceof Error
            ? error.message
            : "The collection could not be started.",
      });
    }
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
  activeCollection?.kill("SIGTERM");
  server.close((error) => {
    if (error) {
      process.stderr.write(`[dashboard] shutdown failed after ${signal}\n`);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
