import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  canonicalBookingPropertyUrl,
  derivePropertyKey,
  loadProperties,
} from "../src/property-config.mjs";

const valid = {
  key: "example",
  businessName: "Example",
  bookingName: "Example Hotel",
  hotelId: 123,
  canonicalUrl: "https://www.booking.com/hotel/au/example.html",
  countryCode: "au",
  timeZone: "Australia/Sydney",
};

async function config(value) {
  const directory = await mkdtemp(join(tmpdir(), "azzurro-config-"));
  const path = join(directory, "properties.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

test("loads and selects clean, unique configured properties", async () => {
  const second = {
    ...valid,
    key: "second",
    hotelId: 456,
    canonicalUrl: "https://www.booking.com/hotel/au/second.html",
  };
  const path = await config([valid, second]);
  const selected = await loadProperties(path, ["second"]);
  assert.deepEqual(selected.map((item) => item.key), ["second"]);
});

test("rejects tracking/session query parameters", async () => {
  const path = await config([
    { ...valid, canonicalUrl: `${valid.canonicalUrl}?sid=secret` },
  ]);
  await assert.rejects(loadProperties(path), /clean Booking/);
});

test("rejects duplicate identities and unknown selections", async () => {
  await assert.rejects(
    loadProperties(await config([valid, { ...valid }])),
    /Duplicate property/,
  );
  await assert.rejects(
    loadProperties(await config([valid]), ["missing"]),
    /Unknown property/,
  );
});

test("canonicalizes an onboarding URL without retaining session tracking", () => {
  const canonical = canonicalBookingPropertyUrl(
    "https://www.booking.com/hotel/au/New-Hotel.html?sid=secret&aid=123#reviews",
  );
  assert.equal(
    canonical,
    "https://www.booking.com/hotel/au/New-Hotel.html",
  );
  assert.equal(derivePropertyKey(canonical), "new_hotel");
});
