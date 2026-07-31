import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  auditExportData,
  auditExportFiles,
} from "../src/export-audit.mjs";
import { sydneyDateFromEpoch } from "../src/date-utils.mjs";
import { PARSER_VERSION } from "../src/review-contract.mjs";

const CONFIGURED = Object.freeze([
  {
    key: "hotel_one",
    businessName: "Hotel One",
    bookingName: "Hotel One Booking Name",
    hotelId: 101,
    canonicalUrl: "https://www.booking.com/hotel/au/hotel-one.html",
    countryCode: "au",
    timeZone: "Australia/Sydney",
  },
  {
    key: "hotel_two",
    businessName: "Hotel Two",
    bookingName: "Hotel Two Booking Name",
    hotelId: 202,
    canonicalUrl: "https://www.booking.com/hotel/au/hotel-two.html",
    countryCode: "au",
    timeZone: "Australia/Sydney",
  },
]);
const CENTRAL = Object.freeze({
  key: "central_sydney",
  businessName: "Central Sydney",
  bookingName: "Central Sydney",
  hotelId: 9_888_182,
  canonicalUrl:
    "https://www.booking.com/hotel/au/venus-surry-hills.html",
  countryCode: "au",
  timeZone: "Australia/Sydney",
});

function record({
  property = CONFIGURED[0],
  reviewId = "a".repeat(24),
  reviewedEpoch = 1_700_000_000,
  score = 8,
  textTrivialFlag = 7,
  photos = [
    {
      id: 42,
      urls: [
        {
          size: "square80",
          url:
            "https://booking-photo-cdn.invalid/xdata/images/" +
            "hotel/square80/42.jpg?k=asset&hp=1#crop",
        },
      ],
    },
  ],
  ...overrides
} = {}) {
  return {
    propertyKey: property.key,
    propertyName: property.businessName,
    bookingHotelId: property.hotelId,
    reviewId,
    reviewedEpoch,
    reviewedAtUtc: new Date(reviewedEpoch * 1000).toISOString(),
    reviewedLocalDate: sydneyDateFromEpoch(reviewedEpoch),
    score,
    title: "PRIVATE REVIEW TITLE",
    positiveText: "PRIVATE POSITIVE REVIEW TEXT",
    negativeText: null,
    sourceLanguage: "en",
    partnerReply: null,
    helpfulVotesCount: 0,
    bookingDetails: {
      customerType: "COUPLE",
      numNights: 2,
    },
    guestDetails: {
      username: "PRIVATE GUEST NAME",
      countryCode: "au",
      countryName: "Australia",
      anonymous: false,
      guestTypeTranslation: "Couple",
      joinedDate: null,
      userReviewCount: 3,
    },
    photos,
    highlights: {
      positive: [],
      negative: [],
    },
    textTrivialFlag,
    isApproved: true,
    isTranslatable: false,
    ...overrides,
  };
}

function manifest(records, {
  properties = CONFIGURED,
  totalRecords = records.length,
  ...overrides
} = {}) {
  return {
    generatedAt: "2026-07-31T00:00:00.000Z",
    mode: "all_current_reviews",
    samplePerProperty: null,
    strictAll: true,
    requestedPropertyCount: CONFIGURED.length,
    omittedPropertyKeys: [],
    properties: properties.map((property) => {
      const propertyRows = records.filter(
        (item) => item.propertyKey === property.key,
      );
      return {
        propertyKey: property.key,
        bookingHotelId: property.hotelId,
        publishedRunId: `run-${property.key}`,
        publicationGeneration: 1,
        parserVersion: PARSER_VERSION,
        totalPublishedReviews: propertyRows.length,
        exportedReviews: propertyRows.length,
        currentAverageScore:
          propertyRows.length === 0
            ? null
            : propertyRows.reduce(
                (sum, item) => sum + item.score,
                0,
              ) / propertyRows.length,
        authoritativeFullPublication: true,
        advertisedReviews: propertyRows.length,
        retrievableReviews: propertyRows.length,
        sourceReviewGap: 0,
        sourceDiscrepancyKind: null,
        sourceDiscrepancyScoreBucket: null,
        advertisedBucketReviews: null,
        retrievableBucketReviews: null,
      };
    }),
    totalRecords,
    ...overrides,
  };
}

function errorCodes(report) {
  return new Set(report.errors.map((error) => error.code));
}

test("audits a strict export without exposing review or guest content", () => {
  const records = [
    record(),
    record({
      property: CONFIGURED[1],
      reviewId: "b".repeat(24),
      score: 9.4,
      textTrivialFlag: 7,
    }),
  ];
  const report = auditExportData({
    manifest: manifest(records),
    records,
    configuredProperties: CONFIGURED,
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.counts, {
    configuredProperties: 2,
    manifestProperties: 2,
    manifestDeclaredRecords: 2,
    jsonlRows: 2,
    parsedRecords: 2,
    uniquePublicReviewIds: 2,
    weeklyReadyRows: 2,
    propertyReadyRows: 2,
    feedReadyRows: 2,
  });
  assert.deepEqual(
    report.properties.map((property) => property.jsonlRows),
    [1, 1],
  );
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("PRIVATE REVIEW"));
  assert.ok(!serialized.includes("PRIVATE GUEST"));
  assert.ok(!serialized.includes("a".repeat(24)));
});

test("aggregates identity, privacy, date, score, photo, duplicate and readiness failures without leaking values", () => {
  const privateUrl =
    "https://cf.bstatic.com/xdata/private.jpg?sid=PRIVATE_SESSION";
  const duplicateId = "c".repeat(24);
  const first = record({
    reviewId: duplicateId,
    score: 11,
    reviewedLocalDate: "2026-02-30",
    photos: [{ urls: [{ url: privateUrl }] }],
    bookingDetails: {
      detailsUrl:
        "https://example.test/details?sid=PRIVATE_SESSION",
    },
    sourceReviewToken: "PRIVATE_SOURCE_TOKEN",
  });
  const second = record({
    reviewId: duplicateId,
    bookingHotelId: 999,
  });
  const records = [first, second];
  const badManifest = manifest(records, {
    properties: [CONFIGURED[0]],
    totalRecords: 3,
  });
  badManifest.properties[0].exportedReviews = 3;
  badManifest.properties[0].totalPublishedReviews = 3;

  const report = auditExportData({
    manifest: badManifest,
    records,
    configuredProperties: CONFIGURED,
  });
  const codes = errorCodes(report);

  assert.equal(report.ok, false);
  for (const code of [
    "MANIFEST_PROPERTY_COVERAGE_MISMATCH",
    "MANIFEST_PROPERTY_COUNT_MISMATCH",
    "MANIFEST_TOTAL_MISMATCH",
    "PUBLIC_REVIEW_ID_DUPLICATE",
    "PROPERTY_IDENTITY_MISMATCH",
    "SCORE_INVALID",
    "SYDNEY_LOCAL_DATE_INVALID",
    "PRIVACY_FIELD_PRESENT",
    "SESSION_DATA_PRESENT",
    "PHOTO_URL_NOT_CANONICAL",
    "ANALYTICS_WEEKLY_NOT_READY",
    "ANALYTICS_PROPERTY_NOT_READY",
    "ANALYTICS_FEED_NOT_READY",
  ]) {
    assert.ok(codes.has(code), code);
  }
  const serialized = JSON.stringify(report);
  for (const secret of [
    "PRIVATE REVIEW",
    "PRIVATE GUEST",
    "PRIVATE_SOURCE_TOKEN",
    "PRIVATE_SESSION",
    duplicateId,
    privateUrl,
  ]) {
    assert.ok(!serialized.includes(secret), secret);
  }
});

test("file audit counts malformed JSONL rows without echoing their content", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "azzurro-export-audit-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const propertiesPath = join(directory, "properties.json");
  const manifestPath = join(directory, "export-manifest.json");
  const jsonlPath = join(directory, "reviews.jsonl");
  const records = [
    record(),
    record({
      property: CONFIGURED[1],
      reviewId: "b".repeat(24),
    }),
  ];
  writeFileSync(
    propertiesPath,
    `${JSON.stringify(CONFIGURED)}\n`,
    "utf8",
  );
  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest(records))}\n`,
    "utf8",
  );
  writeFileSync(
    jsonlPath,
    `${JSON.stringify(records[0])}\n` +
      '{"title":"PRIVATE MALFORMED REVIEW"\n',
    "utf8",
  );

  const report = await auditExportFiles({
    manifestPath,
    jsonlPath,
    propertiesPath,
  });

  assert.equal(report.ok, false);
  assert.equal(report.counts.jsonlRows, 2);
  assert.equal(report.counts.parsedRecords, 1);
  assert.ok(errorCodes(report).has("JSONL_INVALID_JSON"));
  assert.ok(
    errorCodes(report).has("MANIFEST_PROPERTY_COUNT_MISMATCH"),
  );
  assert.ok(!JSON.stringify(report).includes("PRIVATE MALFORMED"));
});

test("recomputes property averages while allowing non-tenth aggregate precision", () => {
  const records = [
    record({ reviewId: "a".repeat(24), score: 8.1 }),
    record({ reviewId: "b".repeat(24), score: 8.2 }),
    record({
      property: CONFIGURED[1],
      reviewId: "c".repeat(24),
      score: 9,
    }),
  ];
  const correctManifest = manifest(records);
  assert.ok(
    Math.abs(
      correctManifest.properties[0].currentAverageScore - 8.15,
    ) < 1e-12,
  );
  assert.equal(
    auditExportData({
      manifest: correctManifest,
      records,
      configuredProperties: CONFIGURED,
    }).ok,
    true,
  );

  const wrongManifest = structuredClone(correctManifest);
  wrongManifest.properties[0].currentAverageScore = 8.2;
  const report = auditExportData({
    manifest: wrongManifest,
    records,
    configuredProperties: CONFIGURED,
  });
  assert.equal(report.ok, false);
  assert.ok(
    errorCodes(report).has("MANIFEST_PROPERTY_AVERAGE_MISMATCH"),
  );
});

test("rejects negative or non-integer trivial flags but accepts opaque non-negative values", () => {
  for (const textTrivialFlag of [null, 0, 1, 7, 255]) {
    const records = [
      record({ textTrivialFlag }),
      record({
        property: CONFIGURED[1],
        reviewId: "b".repeat(24),
      }),
    ];
    assert.equal(
      auditExportData({
        manifest: manifest(records),
        records,
        configuredProperties: CONFIGURED,
      }).ok,
      true,
      String(textTrivialFlag),
    );
  }

  for (const textTrivialFlag of [-1, 1.5]) {
    const records = [
      record({ textTrivialFlag }),
      record({
        property: CONFIGURED[1],
        reviewId: "b".repeat(24),
      }),
    ];
    const report = auditExportData({
      manifest: manifest(records),
      records,
      configuredProperties: CONFIGURED,
    });
    assert.equal(report.ok, false);
    assert.ok(errorCodes(report).has("FEED_FIELD_INVALID"));
  }
});

test("accepts only the exact known Central advertised/retrievable gap", () => {
  const records = Array.from({ length: 2_536 }, (_, index) =>
    record({
      property: CENTRAL,
      reviewId: (index + 1).toString(16).padStart(24, "0"),
      score: 6,
    }),
  );
  const exactManifest = manifest(records, {
    properties: [CENTRAL],
    requestedPropertyCount: 1,
  });
  Object.assign(exactManifest.properties[0], {
    advertisedReviews: 2_537,
    retrievableReviews: 2_536,
    sourceReviewGap: 1,
    sourceDiscrepancyKind:
      "central_sydney_known_source_gap_v1",
    sourceDiscrepancyScoreBucket:
      "REVIEW_ADJ_AVERAGE_PASSABLE",
    advertisedBucketReviews: 323,
    retrievableBucketReviews: 322,
  });

  const report = auditExportData({
    manifest: exactManifest,
    records,
    configuredProperties: [CENTRAL],
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);

  const advancedRecords = [
    ...records,
    record({
      property: CENTRAL,
      reviewId: (2_537).toString(16).padStart(24, "0"),
      score: 8,
    }),
  ];
  const advancedManifest = manifest(advancedRecords, {
    properties: [CENTRAL],
    requestedPropertyCount: 1,
  });
  Object.assign(advancedManifest.properties[0], {
    advertisedReviews: 2_538,
    retrievableReviews: 2_537,
    sourceReviewGap: 1,
    sourceDiscrepancyKind:
      "central_sydney_known_source_gap_v1",
    sourceDiscrepancyScoreBucket:
      "REVIEW_ADJ_AVERAGE_PASSABLE",
    advertisedBucketReviews: 323,
    retrievableBucketReviews: 322,
  });
  assert.equal(
    auditExportData({
      manifest: advancedManifest,
      records: advancedRecords,
      configuredProperties: [CENTRAL],
    }).ok,
    true,
  );

  for (const mutate of [
    (property) => {
      property.advertisedReviews = 2_538;
      property.sourceReviewGap = 2;
    },
    (property) => {
      property.sourceDiscrepancyKind = "unknown_gap";
    },
    (property) => {
      property.advertisedBucketReviews = 324;
    },
  ]) {
    const drifted = structuredClone(exactManifest);
    mutate(drifted.properties[0]);
    const driftReport = auditExportData({
      manifest: drifted,
      records,
      configuredProperties: [CENTRAL],
    });
    assert.equal(driftReport.ok, false);
    assert.ok(
      errorCodes(driftReport).has(
        "MANIFEST_SOURCE_COUNT_MISMATCH",
      ),
    );
  }
});

test("rejects hidden or partial source-gap metadata on a normal export", () => {
  const records = [
    record(),
    record({
      property: CONFIGURED[1],
      reviewId: "b".repeat(24),
    }),
  ];
  const badManifest = manifest(records);
  Object.assign(badManifest.properties[0], {
    advertisedReviews: 2,
    sourceReviewGap: 1,
    sourceDiscrepancyKind:
      "central_sydney_known_source_gap_v1",
    sourceDiscrepancyScoreBucket:
      "REVIEW_ADJ_AVERAGE_PASSABLE",
    advertisedBucketReviews: 323,
    retrievableBucketReviews: 322,
  });

  const report = auditExportData({
    manifest: badManifest,
    records,
    configuredProperties: CONFIGURED,
  });
  assert.equal(report.ok, false);
  assert.ok(
    errorCodes(report).has("MANIFEST_SOURCE_COUNT_MISMATCH"),
  );
});
