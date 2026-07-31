import { randomUUID } from "node:crypto";
import {
  access,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { executeCanary } from "../src/orchestrator.mjs";
import { launchScraperBrowser } from "../src/playwright-capture.mjs";
import {
  canonicalBookingPropertyUrl,
  derivePropertyKey,
  loadProperties,
} from "../src/property-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const inputUrl = argument("--url");
const businessName = argument("--business-name");
if (!inputUrl || !businessName) {
  throw new Error(
    "Usage: npm run add-property -- --url <booking-url> --business-name <name> [--key key]",
  );
}
const canonicalUrl = canonicalBookingPropertyUrl(inputUrl);
if (!new URL(canonicalUrl).pathname.startsWith("/hotel/au/")) {
  throw new Error("This trial configuration accepts Australian properties only");
}
const key = argument("--key", derivePropertyKey(canonicalUrl));
if (!/^[a-z0-9_]+$/.test(key)) {
  throw new Error("--key must contain lowercase letters, numbers and underscores");
}
const configPath = resolve(
  argument(
    "--properties",
    resolve(projectRoot, "config", "properties.json"),
  ),
);
const requestedChromePath = argument(
  "--chrome",
  process.env.AZZURRO_CHROME_PATH || null,
);
const chromePath = requestedChromePath
  ? resolve(requestedChromePath)
  : null;
if (chromePath) {
  await access(chromePath);
}

const existing = JSON.parse(await readFile(configPath, "utf8"));
if (
  existing.some(
    (property) =>
      property.key === key || property.canonicalUrl === canonicalUrl,
  )
) {
  throw new Error("The property key or canonical URL already exists");
}

const browser = await launchScraperBrowser({
  executablePath: chromePath,
  headed: !process.argv.includes("--headless"),
});
let session;
try {
  const provisional = {
    key,
    hotelId: null,
    canonicalUrl,
  };
  session = await browser.openPropertySession(provisional, {
    allowHotelIdDiscovery: true,
  });
  const discovered = {
    key,
    businessName,
    bookingName:
      argument("--booking-name") ||
      session.pageTitle?.replace(/\s*[-|]\s*Booking\.com.*$/i, "") ||
      businessName,
    hotelId: session.capturedHotelId,
    canonicalUrl,
    hotelScore: session.capturedHotelScore ?? undefined,
    visibleReviewCount: session.visibleReviewCount ?? undefined,
    countryCode: "au",
    timeZone: "Australia/Sydney",
  };
  await executeCanary({
    property: discovered,
    session,
    maxAttempts: 3,
    delayMs: 750,
  });

  const prospective = [...existing, discovered];
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(prospective, null, 2)}\n`,
    "utf8",
  );
  await loadProperties(temporary);
  await rename(temporary, configPath);
  process.stdout.write(
    `${JSON.stringify(
      {
        added: key,
        hotelId: discovered.hotelId,
        canonicalUrl,
        canary: "passed",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await session?.close().catch(() => {});
  await browser.close();
}
