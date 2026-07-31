import test from "node:test";
import assert from "node:assert/strict";

import {
  collectExportRecords,
  ExportValidationError,
  exportReviewRecord,
  exporterInternals,
  recordsToCsv,
} from "../src/exporter.mjs";
import {
  CANONICAL_REVIEW_PHOTO_HOSTNAME,
} from "../src/photo-url-parity.mjs";
import { PARSER_VERSION } from "../src/review-contract.mjs";

test("exports analytics fields without exposing the Booking source token", () => {
  const record = exportReviewRecord(
    {
      property_key: "hotel",
      business_name: "Hotel",
      booking_hotel_id: 123,
    },
    {
      source_review_token: "PRIVATE_SOURCE_TOKEN",
      reviewed_epoch: 1_700_000_000,
      reviewed_at_utc: "2023-11-14T22:13:20.000Z",
      reviewed_local_date: "2023-11-15",
      score_tenths: 80,
      title: "Good",
      positive_text: "Clean",
      negative_text: null,
      source_language: "en",
      partner_reply: "Thanks",
      helpful_votes_count: 2,
      booking_details_json: JSON.stringify({
        roomType: { name: "Double" },
        numNights: 2,
      }),
      guest_details_json: JSON.stringify({
        username: "Guest",
        countryName: "Australia",
        avatarUrl: "https://private.example/avatar",
      }),
      photos_json: "[]",
      highlights_json: JSON.stringify({ positive: [], negative: [] }),
      source_card_json: JSON.stringify({
        textDetails: { textTrivialFlag: 0 },
        isApproved: true,
        isTranslatable: false,
      }),
    },
  );
  assert.equal(record.score, 8);
  assert.equal(record.bookingDetails.roomType.name, "Double");
  assert.equal(record.guestDetails.username, "Guest");
  assert.equal(record.guestDetails.avatarUrl, undefined);
  assert.equal(record.sourceReviewToken, undefined);
  assert.ok(!JSON.stringify(record).includes("PRIVATE_SOURCE_TOKEN"));
  assert.equal(record.reviewId.length, 24);
});

test("CSV quoting preserves commas, quotes and newlines", () => {
  const csv = recordsToCsv([
    {
      propertyKey: "hotel",
      propertyName: 'Hotel, "Sydney"',
      bookingHotelId: 123,
      reviewId: "abc",
      reviewedLocalDate: "2026-07-31",
      score: 8,
      title: "Line 1\nLine 2",
      positiveText: "Good",
      negativeText: null,
      sourceLanguage: "en",
      partnerReply: null,
      helpfulVotesCount: 0,
      bookingDetails: null,
      guestDetails: null,
    },
  ]);
  assert.match(csv, /"Hotel, ""Sydney"""/);
  assert.match(csv, /"Line 1\nLine 2"/);
});

test("public IDs are stable per property and token", () => {
  const first = exporterInternals.publicReviewId("a", "token");
  assert.equal(first, exporterInternals.publicReviewId("a", "token"));
  assert.notEqual(first, exporterInternals.publicReviewId("b", "token"));
});

test("already-canonical photo URLs are exported byte-for-byte", () => {
  const semanticUrl =
    `https://${CANONICAL_REVIEW_PHOTO_HOSTNAME}:8443` +
    "/xdata/images/xphoto/square80/photo%2Fname.jpg" +
    "?o=owner&k=content&k=second#fragment%2Fvalue";
  const record = exportReviewRecord(
    {
      property_key: "hotel",
      business_name: "Hotel",
      booking_hotel_id: 123,
    },
    {
      source_review_token: "photo-token",
      score_tenths: 80,
      photos_json: JSON.stringify([
        {
          __typename: "ReviewPhoto",
          id: 1,
          kind: null,
          mlTagHighestProbability: null,
          urls: [
            {
              __typename: "ReviewPhotoUrl",
              size: "square80",
              url: semanticUrl,
            },
          ],
        },
      ]),
      highlights_json: JSON.stringify({
        positive: [],
        negative: [],
      }),
      source_card_json: "{}",
    },
  );

  assert.equal(record.photos[0].urls[0].url, semanticUrl);
});

test("photo export rejects a raw rotating CDN host without echoing its value", () => {
  assert.throws(
    () =>
      exportReviewRecord(
        {
          property_key: "hotel",
          business_name: "Hotel",
          booking_hotel_id: 123,
        },
        {
          source_review_token: "photo-token",
          score_tenths: 80,
          photos_json: JSON.stringify([
            {
              urls: [
                {
                  url:
                    "https://q-xx.bstatic.com/xdata/images/xphoto/photo.jpg?token=secret",
                },
              ],
            },
          ]),
          highlights_json: JSON.stringify({
            positive: [],
            negative: [],
          }),
          source_card_json: "{}",
        },
      ),
    (error) => {
      assert.ok(error instanceof ExportValidationError);
      assert.equal(error.code, "INVALID_PHOTO_URL");
      assert.equal(
        JSON.stringify(error.details).includes("secret"),
        false,
      );
      return true;
    },
  );
});

function authoritativeFixture(propertyKeys, overrides = {}) {
  const statsByKey = new Map();
  const runsById = new Map();
  const attestationsById = new Map();
  const sourceDiscrepanciesById = new Map();
  const reviewReads = [];

  propertyKeys.forEach((propertyKey, index) => {
    const runId = `full-${propertyKey}`;
    const propertyId = index + 1;
    statsByKey.set(propertyKey, {
      property: {
        property_id: propertyId,
        property_key: propertyKey,
        business_name: `Hotel ${index + 1}`,
        booking_hotel_id: 10_000 + index,
      },
      publication: {
        last_successful_run_id: runId,
        last_successful_full_run_id: runId,
        generation: 1,
      },
      presentCount: 0,
      currentAverageScore: null,
    });
    runsById.set(runId, {
      run_id: runId,
      property_id: propertyId,
      mode: "full",
      status: "succeeded",
      complete_inventory: 1,
      source_count_final: 0,
      parser_version: PARSER_VERSION,
    });
    attestationsById.set(runId, {
      run_id: runId,
      contract_version: 1,
      expected_count: 0,
      oldest_unique_count: 0,
      newest_unique_count: 0,
      oldest_identity_sha256: "a".repeat(64),
      newest_identity_sha256: "a".repeat(64),
      oldest_records_sha256: "b".repeat(64),
      newest_records_sha256: "b".repeat(64),
      oldest_terminal_offset: 0,
      newest_terminal_offset: 0,
      final_head_response_sha256: "c".repeat(64),
    });
  });

  const storage = {
    getPublishedStats(propertyKey) {
      return statsByKey.get(propertyKey) ?? null;
    },
    getRun(runId) {
      return runsById.get(runId) ?? null;
    },
    getFullInventoryAttestation(runId) {
      return attestationsById.get(runId) ?? null;
    },
    getSourceDiscrepancyAttestation(runId) {
      return sourceDiscrepanciesById.get(runId) ?? null;
    },
    getCurrentReviews(propertyKey) {
      reviewReads.push(propertyKey);
      return [];
    },
  };
  Object.assign(storage, overrides);
  return {
    storage,
    statsByKey,
    runsById,
    attestationsById,
    sourceDiscrepanciesById,
    reviewReads,
  };
}

test("strict all export fails before reading rows when a configured property is missing", () => {
  const keys = ["one", "two", "three", "four"];
  const fixture = authoritativeFixture(keys);
  fixture.statsByKey.delete("three");

  assert.throws(
    () =>
      collectExportRecords(fixture.storage, keys, {
        samplePerProperty: Infinity,
        strictAll: true,
      }),
    (error) => {
      assert.ok(error instanceof ExportValidationError);
      assert.equal(error.code, "INCOMPLETE_AUTHORITATIVE_EXPORT");
      assert.deepEqual(error.details, {
        requestedPropertyCount: 4,
        authoritativePropertyCount: 3,
        missingPropertyCount: 1,
        missingPropertyKeys: ["three"],
        nonAuthoritativePropertyCount: 0,
        nonAuthoritativeProperties: [],
      });
      return true;
    },
  );
  assert.deepEqual(fixture.reviewReads, []);
});

test("strict all export rejects a latest incremental publication", () => {
  const keys = ["one", "two", "three", "four"];
  const fixture = authoritativeFixture(keys);
  const stats = fixture.statsByKey.get("two");
  stats.publication.last_successful_run_id = "incremental-two";
  fixture.runsById.set("incremental-two", {
    run_id: "incremental-two",
    property_id: stats.property.property_id,
    mode: "incremental",
    status: "succeeded",
    complete_inventory: 0,
    source_count_final: 0,
  });

  assert.throws(
    () =>
      collectExportRecords(fixture.storage, keys, {
        samplePerProperty: Infinity,
        strictAll: true,
      }),
    (error) => {
      assert.ok(error instanceof ExportValidationError);
      assert.equal(error.code, "INCOMPLETE_AUTHORITATIVE_EXPORT");
      assert.equal(error.details.missingPropertyCount, 0);
      assert.equal(error.details.nonAuthoritativePropertyCount, 1);
      assert.equal(
        error.details.nonAuthoritativeProperties[0].propertyKey,
        "two",
      );
      assert.ok(
        error.details.nonAuthoritativeProperties[0].reasons.includes(
          "latest_run_not_complete_inventory",
        ),
      );
      assert.ok(
        error.details.nonAuthoritativeProperties[0].reasons.includes(
          "latest_run_is_not_latest_full_run",
        ),
      );
      return true;
    },
  );
  assert.deepEqual(fixture.reviewReads, []);
});

test("strict all export rejects a publication from an older parser before reading rows", () => {
  const keys = ["one", "two", "three", "four"];
  const fixture = authoritativeFixture(keys);
  fixture.runsById.get("full-two").parser_version = "older-parser";

  assert.throws(
    () =>
      collectExportRecords(fixture.storage, keys, {
        samplePerProperty: Infinity,
        strictAll: true,
      }),
    (error) => {
      assert.ok(error instanceof ExportValidationError);
      assert.equal(error.code, "INCOMPLETE_AUTHORITATIVE_EXPORT");
      assert.deepEqual(error.details.nonAuthoritativeProperties, [
        {
          propertyKey: "two",
          reasons: ["latest_run_parser_version_mismatch"],
        },
      ]);
      return true;
    },
  );
  assert.deepEqual(fixture.reviewReads, []);
});

test("strict all export accepts all configured attested full publications", () => {
  const keys = ["one", "two", "three", "four"];
  const fixture = authoritativeFixture(keys);
  const exported = collectExportRecords(fixture.storage, keys, {
    samplePerProperty: Infinity,
    strictAll: true,
  });

  assert.equal(exported.strictAll, true);
  assert.equal(exported.requestedPropertyCount, 4);
  assert.deepEqual(exported.omittedPropertyKeys, []);
  assert.deepEqual(
    exported.properties.map((property) => property.propertyKey),
    keys,
  );
  assert.ok(
    exported.properties.every(
      (property) =>
        property.authoritativeFullPublication &&
        property.parserVersion === PARSER_VERSION &&
        property.advertisedReviews === 0 &&
        property.retrievableReviews === 0 &&
        property.sourceReviewGap === 0 &&
        property.sourceDiscrepancyKind === null &&
        property.sourceDiscrepancyScoreBucket === null &&
        property.advertisedBucketReviews === null &&
        property.retrievableBucketReviews === null,
    ),
  );
  assert.deepEqual(fixture.reviewReads, keys);
});

function centralDiscrepancy() {
  return {
    contractKind: "central_sydney_known_source_gap_v1",
    contractVersion: 1,
    propertyKey: "central_sydney",
    bookingHotelId: 9_888_182,
    advertisedReviewCount: 2_537,
    retrievableReviewCount: 2_536,
    gapCount: 1,
    scoreBucket: "REVIEW_ADJ_AVERAGE_PASSABLE",
    advertisedBucketCount: 323,
    retrievableBucketCount: 322,
    advertisedScoreBuckets: [
      { value: "REVIEW_ADJ_SUPERB", count: 200 },
      { value: "REVIEW_ADJ_GOOD", count: 400 },
      {
        value: "REVIEW_ADJ_AVERAGE_PASSABLE",
        count: 323,
      },
      { value: "REVIEW_ADJ_POOR", count: 600 },
      { value: "REVIEW_ADJ_VERY_POOR", count: 1_014 },
    ],
    retrievableScoreBuckets: [
      { value: "REVIEW_ADJ_SUPERB", count: 200 },
      { value: "REVIEW_ADJ_GOOD", count: 400 },
      {
        value: "REVIEW_ADJ_AVERAGE_PASSABLE",
        count: 322,
      },
      { value: "REVIEW_ADJ_POOR", count: 600 },
      { value: "REVIEW_ADJ_VERY_POOR", count: 1_014 },
    ],
  };
}

function centralFixture() {
  const fixture = authoritativeFixture(["central_sydney"]);
  const stats = fixture.statsByKey.get("central_sydney");
  const run = fixture.runsById.get("full-central_sydney");
  const attestation = fixture.attestationsById.get(
    "full-central_sydney",
  );
  stats.property.booking_hotel_id = 9_888_182;
  stats.presentCount = 2_536;
  run.source_count_final = 2_536;
  Object.assign(attestation, {
    expected_count: 2_536,
    oldest_unique_count: 2_536,
    newest_unique_count: 2_536,
    oldest_terminal_offset: 2_540,
    newest_terminal_offset: 2_540,
  });
  fixture.sourceDiscrepanciesById.set(
    "full-central_sydney",
    centralDiscrepancy(),
  );
  return fixture;
}

function advancedCentralFixture() {
  const fixture = centralFixture();
  const stats = fixture.statsByKey.get("central_sydney");
  const run = fixture.runsById.get("full-central_sydney");
  const inventory = fixture.attestationsById.get(
    "full-central_sydney",
  );
  const discrepancy = fixture.sourceDiscrepanciesById.get(
    "full-central_sydney",
  );
  stats.presentCount = 2_537;
  run.source_count_final = 2_537;
  Object.assign(inventory, {
    expected_count: 2_537,
    oldest_unique_count: 2_537,
    newest_unique_count: 2_537,
  });
  discrepancy.advertisedReviewCount = 2_538;
  discrepancy.retrievableReviewCount = 2_537;
  for (const buckets of [
    discrepancy.advertisedScoreBuckets,
    discrepancy.retrievableScoreBuckets,
  ]) {
    buckets.find(
      ({ value }) => value === "REVIEW_ADJ_GOOD",
    ).count += 1;
  }
  return fixture;
}

test("exports the exact persisted Central source gap as safe manifest fields", () => {
  const fixture = centralFixture();
  const exported = collectExportRecords(
    fixture.storage,
    ["central_sydney"],
    { strictAll: true, samplePerProperty: 1 },
  );

  assert.deepEqual(
    {
      advertisedReviews:
        exported.properties[0].advertisedReviews,
      retrievableReviews:
        exported.properties[0].retrievableReviews,
      sourceReviewGap: exported.properties[0].sourceReviewGap,
      sourceDiscrepancyKind:
        exported.properties[0].sourceDiscrepancyKind,
      sourceDiscrepancyScoreBucket:
        exported.properties[0].sourceDiscrepancyScoreBucket,
      advertisedBucketReviews:
        exported.properties[0].advertisedBucketReviews,
      retrievableBucketReviews:
        exported.properties[0].retrievableBucketReviews,
    },
    {
      advertisedReviews: 2_537,
      retrievableReviews: 2_536,
      sourceReviewGap: 1,
      sourceDiscrepancyKind:
        "central_sydney_known_source_gap_v1",
      sourceDiscrepancyScoreBucket:
        "REVIEW_ADJ_AVERAGE_PASSABLE",
      advertisedBucketReviews: 323,
      retrievableBucketReviews: 322,
    },
  );
  assert.equal(
    exported.properties[0].authoritativeFullPublication,
    true,
  );
});

test("strict export accepts a later Central snapshot with the same exact gap contract", () => {
  const fixture = advancedCentralFixture();
  const exported = collectExportRecords(
    fixture.storage,
    ["central_sydney"],
    { strictAll: true, samplePerProperty: 1 },
  );
  assert.equal(exported.properties[0].advertisedReviews, 2_538);
  assert.equal(exported.properties[0].retrievableReviews, 2_537);
  assert.equal(exported.properties[0].sourceReviewGap, 1);
  assert.equal(
    exported.properties[0].sourceDiscrepancyScoreBucket,
    "REVIEW_ADJ_AVERAGE_PASSABLE",
  );
});

test("rejects malformed, unexpected, or drifting source-gap attestations", () => {
  const mutations = [
    (fixture) => {
      fixture.sourceDiscrepanciesById.get(
        "full-central_sydney",
      ).advertisedReviewCount = 2_538;
    },
    (fixture) => {
      fixture.sourceDiscrepanciesById.get(
        "full-central_sydney",
      ).retrievableScoreBuckets[0].count -= 1;
    },
    (fixture) => {
      fixture.sourceDiscrepanciesById.get(
        "full-central_sydney",
      ).retrievableScoreBuckets.reverse();
    },
    (fixture) => {
      fixture.statsByKey.get(
        "central_sydney",
      ).property.booking_hotel_id = 123;
    },
  ];

  for (const mutate of mutations) {
    const fixture = centralFixture();
    mutate(fixture);
    assert.throws(
      () =>
        collectExportRecords(
          fixture.storage,
          ["central_sydney"],
          { strictAll: true, samplePerProperty: 1 },
        ),
      (error) => {
        assert.ok(error instanceof ExportValidationError);
        assert.equal(
          error.code,
          "INCOMPLETE_AUTHORITATIVE_EXPORT",
        );
        assert.deepEqual(
          error.details.nonAuthoritativeProperties[0].reasons,
          ["source_discrepancy_attestation_invalid"],
        );
        return true;
      },
    );
  }

  const unexpected = authoritativeFixture(["one"]);
  unexpected.sourceDiscrepanciesById.set(
    "full-one",
    centralDiscrepancy(),
  );
  assert.throws(
    () =>
      collectExportRecords(unexpected.storage, ["one"], {
        strictAll: true,
        samplePerProperty: 1,
      }),
    (error) => {
      assert.ok(error instanceof ExportValidationError);
      assert.deepEqual(
        error.details.nonAuthoritativeProperties[0].reasons,
        ["source_discrepancy_attestation_invalid"],
      );
      return true;
    },
  );

  const missing = centralFixture();
  missing.sourceDiscrepanciesById.clear();
  assert.throws(
    () =>
      collectExportRecords(
        missing.storage,
        ["central_sydney"],
        { strictAll: true, samplePerProperty: 1 },
      ),
    (error) => {
      assert.ok(error instanceof ExportValidationError);
      assert.deepEqual(
        error.details.nonAuthoritativeProperties[0].reasons,
        ["source_discrepancy_attestation_missing"],
      );
      return true;
    },
  );
});
