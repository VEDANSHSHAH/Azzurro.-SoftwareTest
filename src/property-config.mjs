import { readFile } from "node:fs/promises";

const REQUIRED_KEYS = [
  "key",
  "businessName",
  "bookingName",
  "hotelId",
  "canonicalUrl",
  "countryCode",
  "timeZone",
];

export function canonicalBookingPropertyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Booking property URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.booking.com" ||
    !/^\/hotel\/[a-z]{2}\/[^/]+\.html$/i.test(url.pathname)
  ) {
    throw new Error(
      "URL must be an HTTPS www.booking.com /hotel/{country}/{slug}.html URL",
    );
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function derivePropertyKey(canonicalUrl) {
  const slug = new URL(canonicalUrl).pathname
    .split("/")
    .at(-1)
    .replace(/\.html$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) throw new Error("Could not derive a property key from the URL");
  return slug;
}

function assertProperty(property, index) {
  if (property === null || typeof property !== "object") {
    throw new Error(`Property at index ${index} must be an object`);
  }
  for (const key of REQUIRED_KEYS) {
    if (property[key] === null || property[key] === undefined) {
      throw new Error(`Property at index ${index} is missing ${key}`);
    }
  }
  for (const key of ["key", "businessName", "bookingName", "countryCode"]) {
    if (typeof property[key] !== "string" || property[key].trim() === "") {
      throw new Error(`${property.key ?? index}.${key} must be a non-empty string`);
    }
  }
  if (!Number.isInteger(property.hotelId) || property.hotelId <= 0) {
    throw new Error(`${property.key}.hotelId must be a positive integer`);
  }
  if (property.timeZone !== "Australia/Sydney") {
    throw new Error(`${property.key}.timeZone must be Australia/Sydney`);
  }

  let url;
  try {
    url = new URL(property.canonicalUrl);
  } catch {
    throw new Error(`${property.key}.canonicalUrl is invalid`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.booking.com" ||
    !/^\/hotel\/au\/[^/]+\.html$/.test(url.pathname) ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `${property.key}.canonicalUrl must be a clean Booking.com /hotel/au/*.html URL`,
    );
  }
  if (
    property.visibleReviewCount !== undefined &&
    (!Number.isInteger(property.visibleReviewCount) ||
      property.visibleReviewCount < 0)
  ) {
    throw new Error(
      `${property.key}.visibleReviewCount must be a non-negative integer`,
    );
  }
  if (
    property.hotelScore !== undefined &&
    (typeof property.hotelScore !== "number" ||
      !Number.isFinite(property.hotelScore) ||
      property.hotelScore < 0 ||
      property.hotelScore > 10)
  ) {
    throw new Error(`${property.key}.hotelScore must be between 0 and 10`);
  }
}

export async function loadProperties(configPath, selectedKeys = []) {
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Property configuration must be a non-empty array");
  }

  const keys = new Set();
  const hotelIds = new Set();
  const paths = new Set();
  parsed.forEach((property, index) => {
    assertProperty(property, index);
    const path = new URL(property.canonicalUrl).pathname;
    for (const [set, value, label] of [
      [keys, property.key, "key"],
      [hotelIds, property.hotelId, "hotelId"],
      [paths, path, "canonical URL path"],
    ]) {
      if (set.has(value)) {
        throw new Error(`Duplicate property ${label}: ${value}`);
      }
      set.add(value);
    }
  });

  if (!Array.isArray(selectedKeys)) {
    throw new Error("selectedKeys must be an array");
  }
  if (selectedKeys.length === 0) return parsed;

  const selected = new Set(selectedKeys);
  const unknown = [...selected].filter((key) => !keys.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unknown property key(s): ${unknown.join(", ")}`);
  }
  return parsed.filter((property) => selected.has(property.key));
}
