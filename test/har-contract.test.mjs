import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateReviewListResponse } from "../src/review-contract.mjs";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const parent = resolve(here, "..", "..");
const fixtureDirectory = resolve(here, "fixtures", "har-contract");
const olympicHarAvailable = existsSync(
  resolve(parent, "Olympic Paddington network logs.har"),
);
const surryHarAvailable = existsSync(
  resolve(parent, "SUrry network logs.har"),
);

async function readFixture(fileName) {
  return JSON.parse(
    await readFile(resolve(fixtureDirectory, fileName), "utf8"),
  );
}

function validateFixture(fixture, { unfiltered = false } = {}) {
  const input = fixture.request.variables.input;
  return validateReviewListResponse(fixture.response, {
    propertyKey: fixture.propertyKey,
    skip: input.skip,
    limit: input.limit,
    unfiltered,
  });
}

function decode(content) {
  if (!content?.text) return null;
  return content.encoding === "base64"
    ? Buffer.from(content.text, "base64").toString("utf8")
    : content.text;
}

async function validateHar(fileName, propertyKey) {
  const har = JSON.parse(
    await readFile(resolve(parent, fileName), "utf8"),
  );
  const reviewEntries = har.log.entries.filter(
    (entry) =>
      entry.request.url.includes("/dml/graphql") &&
      (entry.request.postData?.text ?? "").includes("query ReviewList"),
  );
  assert.ok(reviewEntries.length > 0);

  let validatedCards = 0;
  for (const entry of reviewEntries) {
    const payload = JSON.parse(entry.request.postData.text);
    const body = JSON.parse(decode(entry.response.content));
    const validated = validateReviewListResponse(body, {
      propertyKey,
      skip: payload.variables.input.skip,
      limit: payload.variables.input.limit,
    });
    validatedCards += validated.cardCount;
  }
  return { requestCount: reviewEntries.length, validatedCards };
}

test("sanitized Olympic fixture accepts the captured 12/12 unfiltered total contract", async () => {
  const fixture = await readFixture("olympic-consistent.json");
  const validated = validateFixture(fixture, { unfiltered: true });

  assert.equal(validated.reviewsCount, 12);
  assert.equal(validated.cardCount, 2);
  assert.equal(validated.totalConsistency.status, "consistent");
  assert.deepEqual(
    validated.totalConsistency.totals.map(({ count }) => count),
    [12, 12, 12, 12],
  );
});

test("sanitized Surry fixture discloses the captured 2194/2195 unfiltered gap", async () => {
  const fixture = await readFixture("surry-total-mismatch.json");
  const observed = validateFixture(fixture);

  assert.equal(observed.reviewsCount, 2194);
  assert.equal(
    observed.totalConsistency.status,
    "not_evaluated_filtered",
  );
  assert.deepEqual(
    observed.totalConsistency.totals.map(({ count }) => count),
    [2195, 2195, 2195, 2195],
  );

  // Booking really does advertise one review it will not paginate. The
  // response stays valid and the gap is carried forward as a disclosure.
  const unfiltered = validateFixture(fixture, { unfiltered: true });
  assert.equal(unfiltered.reviewsCount, 2194);
  assert.equal(
    unfiltered.totalConsistency.status,
    "inconsistent",
  );
  assert.deepEqual(
    unfiltered.totalConsistency.disagreements.map(
      ({ count }) => count,
    ),
    [2195, 2195, 2195, 2195],
  );
});

test("all captured Olympic ReviewList responses satisfy the contract", {
  skip: !olympicHarAvailable,
}, async () => {
  const result = await validateHar(
    "Olympic Paddington network logs.har",
    "olympic_paddington",
  );
  assert.equal(result.requestCount, 9);
  assert.ok(result.validatedCards > 0);
});

test("all captured Surry ReviewList responses satisfy the contract", {
  skip: !surryHarAvailable,
}, async () => {
  const result = await validateHar(
    "SUrry network logs.har",
    "surry_fixture",
  );
  assert.equal(result.requestCount, 10);
  assert.ok(result.validatedCards > 0);
});

test("captured Surry unfiltered totals expose the known 2194/2195 disagreement", {
  skip: !surryHarAvailable,
}, async () => {
  const har = JSON.parse(
    await readFile(resolve(parent, "SUrry network logs.har"), "utf8"),
  );
  const entry = har.log.entries.find((item) => {
    if (
      !item.request.url.includes("/dml/graphql") ||
      !(item.request.postData?.text ?? "").includes("query ReviewList")
    ) {
      return false;
    }
    const payload = JSON.parse(item.request.postData.text);
    const filters = payload.variables?.input?.filters;
    return (
      filters?.text === "" &&
      Object.keys(filters).length === 1
    );
  });
  assert.ok(entry);
  const payload = JSON.parse(entry.request.postData.text);
  const body = JSON.parse(decode(entry.response.content));
  const observed = validateReviewListResponse(body, {
    propertyKey: "surry_fixture",
    skip: payload.variables.input.skip,
    limit: payload.variables.input.limit,
  });
  assert.equal(observed.reviewsCount, 2194);
  assert.deepEqual(
    observed.totalConsistency.totals.map((total) => total.count),
    [2195, 2195, 2195, 2195],
  );
  const unfiltered = validateReviewListResponse(body, {
    propertyKey: "surry_fixture",
    skip: payload.variables.input.skip,
    limit: payload.variables.input.limit,
    unfiltered: true,
  });
  assert.equal(unfiltered.totalConsistency.status, "inconsistent");
});

test("captured Olympic unfiltered totals agree without summing season buckets", {
  skip: !olympicHarAvailable,
}, async () => {
  const har = JSON.parse(
    await readFile(
      resolve(parent, "Olympic Paddington network logs.har"),
      "utf8",
    ),
  );
  const entry = har.log.entries.find((item) => {
    if (
      !item.request.url.includes("/dml/graphql") ||
      !(item.request.postData?.text ?? "").includes("query ReviewList")
    ) {
      return false;
    }
    const payload = JSON.parse(item.request.postData.text);
    const filters = payload.variables?.input?.filters;
    return (
      filters?.text === "" &&
      Object.keys(filters).length === 1
    );
  });
  assert.ok(entry);
  const payload = JSON.parse(entry.request.postData.text);
  const body = JSON.parse(decode(entry.response.content));
  const validated = validateReviewListResponse(body, {
    propertyKey: "olympic_paddington",
    skip: payload.variables.input.skip,
    limit: payload.variables.input.limit,
    unfiltered: true,
  });
  assert.equal(validated.reviewsCount, 12);
  assert.equal(validated.totalConsistency.status, "consistent");
  assert.equal(validated.totalConsistency.totals.length, 4);
});

test("both HARs use the identical ReviewList query contract", {
  skip: !olympicHarAvailable || !surryHarAvailable,
}, async () => {
  const hashes = [];
  for (const fileName of [
    "Olympic Paddington network logs.har",
    "SUrry network logs.har",
  ]) {
    const har = JSON.parse(
      await readFile(resolve(parent, fileName), "utf8"),
    );
    const entry = har.log.entries.find(
      (item) =>
        item.request.url.includes("/dml/graphql") &&
        (item.request.postData?.text ?? "").includes(
          "query ReviewList",
        ),
    );
    const payload = JSON.parse(entry.request.postData.text);
    hashes.push(
      createHash("sha256").update(payload.query).digest("hex"),
    );
  }
  assert.equal(hashes[0], hashes[1]);
  assert.equal(
    hashes[0],
    "778f81af03c40adf2a26d48a457d20892b6514132c6bf2b825bb43899a3dc513",
  );
});

test("Olympic newest-first pages reconcile to exactly 12 unique reviews", {
  skip: !olympicHarAvailable,
}, async () => {
  const har = JSON.parse(
    await readFile(
      resolve(parent, "Olympic Paddington network logs.har"),
      "utf8",
    ),
  );
  const pages = har.log.entries
    .filter(
      (entry) =>
        entry.request.url.includes("/dml/graphql") &&
        (entry.request.postData?.text ?? "").includes(
          "query ReviewList",
        ),
    )
    .map((entry) => {
      const payload = JSON.parse(entry.request.postData.text);
      return { entry, input: payload.variables.input };
    })
    .filter(
      ({ input }) =>
        input.sorter === "NEWEST_FIRST" &&
        input.filters?.text === "" &&
        [0, 10].includes(input.skip),
    )
    .sort((a, b) => a.input.skip - b.input.skip)
    .map(({ entry, input }) => {
      const body = JSON.parse(decode(entry.response.content));
      return validateReviewListResponse(body, {
        propertyKey: "olympic_paddington",
        skip: input.skip,
        limit: input.limit,
      });
    });

  assert.deepEqual(
    pages.map((page) => page.cardCount),
    [10, 2],
  );
  assert.equal(pages[0].reviewsCount, 12);
  const keys = new Set(
    pages.flatMap((page) =>
      page.reviews.map((review) => review.sourceKey),
    ),
  );
  assert.equal(keys.size, 12);
});
