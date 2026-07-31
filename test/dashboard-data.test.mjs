import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createDashboardDataService,
  dashboardDataInternals,
  DashboardDataError,
  parseDashboardQuery,
} from "../src/dashboard-data.mjs";
import { SOURCE_GAP_CONTRACT } from "../src/source-discrepancy.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const ADVERTISED_BUCKETS = [
  { value: "REVIEW_ADJ_VERY_POOR", count: 414 },
  { value: "REVIEW_ADJ_POOR", count: 600 },
  { value: "REVIEW_ADJ_AVERAGE_PASSABLE", count: 323 },
  { value: "REVIEW_ADJ_GOOD", count: 700 },
  { value: "REVIEW_ADJ_SUPERB", count: 500 },
];
const RETRIEVABLE_BUCKETS = ADVERTISED_BUCKETS.map((bucket) => ({
  ...bucket,
  count:
    bucket.value === "REVIEW_ADJ_AVERAGE_PASSABLE"
      ? 322
      : bucket.count,
}));

function epoch(date) {
  return Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000);
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "azzurro-dashboard-"));
  const dbPath = join(directory, "reviews.sqlite");
  const propertiesPath = join(directory, "properties.json");
  await writeFile(
    propertiesPath,
    JSON.stringify([
      {
        key: "fixture_property",
        businessName: "Fixture Hotel",
        bookingName: "Fixture Hotel",
        hotelId: 123,
        canonicalUrl: "https://example.test/hotel",
        visibleReviewCount: 3,
        hotelScore: 7.7,
      },
    ]),
  );

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE properties (
      property_id INTEGER PRIMARY KEY,
      property_key TEXT,
      business_name TEXT,
      booking_hotel_id INTEGER,
      booking_name TEXT,
      enabled INTEGER
    );
    CREATE TABLE property_publications (
      property_id INTEGER,
      last_successful_run_id TEXT,
      generation INTEGER,
      published_at_utc TEXT
    );
    CREATE TABLE scrape_runs (
      run_id TEXT PRIMARY KEY,
      parser_version TEXT,
      source_count_final INTEGER
    );
    CREATE TABLE property_snapshots (
      run_id TEXT,
      structured_review_count INTEGER,
      displayed_review_count INTEGER,
      displayed_score_tenths INTEGER,
      rating_scores_json TEXT
    );
    CREATE TABLE full_inventory_attestations (
      run_id TEXT,
      oldest_unique_count INTEGER,
      newest_unique_count INTEGER,
      oldest_identity_sha256 TEXT,
      newest_identity_sha256 TEXT,
      oldest_records_sha256 TEXT,
      newest_records_sha256 TEXT
    );
    CREATE TABLE source_discrepancy_attestations (
      run_id TEXT,
      contract_version INTEGER,
      contract_kind TEXT,
      property_key TEXT,
      booking_hotel_id INTEGER,
      advertised_review_count INTEGER,
      retrievable_review_count INTEGER,
      gap_count INTEGER,
      score_bucket TEXT,
      advertised_bucket_count INTEGER,
      retrievable_bucket_count INTEGER,
      advertised_score_buckets_json TEXT,
      retrievable_score_buckets_json TEXT
    );
    CREATE TABLE reviews (
      review_id TEXT PRIMARY KEY,
      property_id INTEGER,
      source_review_token TEXT,
      presence_state TEXT
    );
    CREATE TABLE review_versions (
      review_id TEXT,
      reviewed_epoch INTEGER,
      reviewed_local_date TEXT,
      score_tenths INTEGER,
      title TEXT,
      positive_text TEXT,
      negative_text TEXT,
      source_language TEXT,
      partner_reply TEXT,
      helpful_votes_count INTEGER,
      booking_details_json TEXT,
      guest_details_json TEXT,
      is_current INTEGER
    );
  `);
  db.prepare(
    `INSERT INTO properties
       VALUES (1, 'fixture_property', 'Fixture Hotel', 123, 'Fixture Hotel', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO property_publications
       VALUES (1, 'run-1', 1, '2026-07-31T00:00:00.000Z')`,
  ).run();
  db.prepare(`INSERT INTO scrape_runs VALUES ('run-1', '2.4.0', 3)`).run();
  db.prepare(
    `INSERT INTO property_snapshots VALUES (
       'run-1', 3, 3, 77, ?
     )`,
  ).run(JSON.stringify([{ translation: "Cleanliness", value: 8.5 }]));
  db.prepare(
    `INSERT INTO full_inventory_attestations
       VALUES ('run-1', 3, 3, ?, ?, ?, ?)`,
  ).run(HASH_A, HASH_A, HASH_B, HASH_B);

  const addReview = db.prepare(
    `INSERT INTO reviews VALUES (?, 1, ?, 'present')`,
  );
  const addVersion = db.prepare(
    `INSERT INTO review_versions VALUES (
       ?, ?, ?, ?, ?, ?, ?, 'en-gb', NULL, ?, ?, ?, 1
     )`,
  );
  const stay = JSON.stringify({
    roomType: { name: "Standard Room" },
    customerType: "couple",
    numNights: 2,
  });
  const guest = JSON.stringify({
    username: "Guest",
    countryName: "Australia",
    guestTypeTranslation: "Couple",
  });
  for (const review of [
    {
      id: "r-current-positive",
      token: "private-token-positive",
      date: "2026-07-30",
      score: 90,
      title: "Great stay",
      positive: "Great location near the station",
      negative: null,
      helpful: 2,
    },
    {
      id: "r-current-negative",
      token: "private-token-negative",
      date: "2026-07-29",
      score: 60,
      title: "Needs work",
      positive: null,
      negative: "The room was dirty",
      helpful: 1,
    },
    {
      id: "r-previous-positive",
      token: "private-token-previous",
      date: "2026-07-24",
      score: 80,
      title: "Good",
      positive: "Friendly staff",
      negative: null,
      helpful: 0,
    },
  ]) {
    addReview.run(review.id, review.token);
    addVersion.run(
      review.id,
      epoch(review.date),
      review.date,
      review.score,
      review.title,
      review.positive,
      review.negative,
      review.helpful,
      stay,
      guest,
    );
  }
  db.close();

  return {
    dbPath,
    propertiesPath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("dashboard query defaults and validation fail safely", () => {
  const defaults = parseDashboardQuery(new URLSearchParams());
  assert.equal(defaults.review.page, 1);
  assert.equal(defaults.review.pageSize, 20);
  assert.equal(defaults.review.minScore, 0);
  assert.equal(defaults.review.maxScore, 10);

  assert.throws(
    () =>
      parseDashboardQuery(
        new URLSearchParams("from=2026-08-01&to=2026-07-01"),
      ),
    (error) =>
      error instanceof DashboardDataError &&
      error.code === "INVALID_QUERY",
  );
  assert.throws(
    () =>
      parseDashboardQuery(
        new URLSearchParams("reviewSentiments=invented"),
      ),
    (error) =>
      error instanceof DashboardDataError &&
      error.code === "INVALID_QUERY",
  );
});

test("weekly metrics use matched week-to-date periods and exact topic evidence", async () => {
  const source = await fixture();
  try {
    const service = createDashboardDataService({
      dbPath: source.dbPath,
      propertiesPath: source.propertiesPath,
      now: () => new Date("2026-07-31T04:00:00.000Z"),
    });
    const result = service.build();

    assert.equal(result.overview.periodKind, "current-week");
    assert.deepEqual(
      {
        start: result.overview.currentWeek.start,
        end: result.overview.currentWeek.end,
        count: result.overview.currentWeek.reviewCount,
        average: result.overview.currentWeek.average,
      },
      {
        start: "2026-07-27",
        end: "2026-07-31",
        count: 2,
        average: 7.5,
      },
    );
    assert.equal(result.overview.previousWeek.start, "2026-07-20");
    assert.equal(result.overview.previousWeek.end, "2026-07-24");
    assert.equal(result.overview.previousWeek.reviewCount, 1);
    assert.equal(result.overview.averageRating.delta, -0.5);
    assert.equal(result.overview.currentWeek.negativeCount, 1);
    assert.equal(result.overview.currentWeek.negativeFeedbackCount, 1);

    const cleanliness = result.topics.find(
      (topic) => topic.topic === "cleanliness",
    );
    assert.equal(cleanliness.negativeMentionCount, 1);
    assert.equal(cleanliness.negativeMentionShare, 100);
    assert.equal(result.properties[0].topNegativeTopic, "Cleanliness");
    assert.equal(result.properties[0].status, "verified");
    assert.deepEqual(result.properties[0].categoryScores, [
      { name: "Cleanliness", score: 8.5 },
    ]);
    assert.equal(result.quality.overallStatus, "verified");
    assert.equal(result.overview.recentReviews.length, 3);

    const currentTrend = result.trends.at(-1);
    assert.equal(currentTrend.periodEnd, "2026-07-31");
    assert.equal(currentTrend.isPartial, true);
    assert.equal(currentTrend.positiveShare, 50);
    assert.equal(currentTrend.negativeShare, 50);
    assert.equal(currentTrend.mixedShare, 0);
    assert.equal(currentTrend.unclassifiedShare, 0);

    assert.equal(result.reviews.total, 3);
    assert.equal(
      Object.hasOwn(result.reviews.items[0], "reviewedEpoch"),
      false,
    );
    assert.equal(
      JSON.stringify(result.reviews.items).includes("private-token"),
      false,
    );
  } finally {
    await source.cleanup();
  }
});

test("custom and one-sided date filters use one consistent reporting corpus", async () => {
  const source = await fixture();
  try {
    const service = createDashboardDataService({
      dbPath: source.dbPath,
      propertiesPath: source.propertiesPath,
      now: () => new Date("2026-07-31T04:00:00.000Z"),
    });
    const fromOnly = service.build(
      new URLSearchParams("from=2026-07-29"),
    );
    assert.equal(fromOnly.overview.periodKind, "custom");
    assert.equal(fromOnly.overview.currentWeek.start, "2026-07-29");
    assert.equal(fromOnly.overview.currentWeek.end, "2026-07-30");
    assert.equal(fromOnly.overview.currentWeek.reviewCount, 2);
    assert.equal(
      fromOnly.scoreDistribution.reduce(
        (sum, bucket) => sum + bucket.count,
        0,
      ),
      2,
    );
    assert.equal(fromOnly.overview.recentReviews.length, 2);
    assert.equal(fromOnly.overview.dataThrough, "2026-07-30");

    const toOnly = service.build(
      new URLSearchParams("to=2026-07-24"),
    );
    assert.equal(toOnly.overview.currentWeek.start, "2026-07-24");
    assert.equal(toOnly.overview.currentWeek.end, "2026-07-24");
    assert.equal(toOnly.overview.currentWeek.reviewCount, 1);
    assert.equal(
      toOnly.scoreDistribution.reduce(
        (sum, bucket) => sum + bucket.count,
        0,
      ),
      1,
    );
  } finally {
    await source.cleanup();
  }
});

test("review filters combine precisely and never mutate the source facts", async () => {
  const source = await fixture();
  try {
    const service = createDashboardDataService({
      dbPath: source.dbPath,
      propertiesPath: source.propertiesPath,
      now: () => new Date("2026-07-31T04:00:00.000Z"),
    });
    const result = service.build(
      new URLSearchParams(
        "reviewSentiments=negative&reviewTopics=cleanliness&reviewMinScore=5&reviewMaxScore=7&reviewSort=lowest",
      ),
    );
    assert.equal(result.reviews.total, 1);
    assert.equal(result.reviews.items[0].score, 6);
    assert.equal(result.reviews.items[0].negativeText, "The room was dirty");
    assert.deepEqual(
      result.reviews.items[0].topics.map((topic) => topic.topic),
      ["cleanliness"],
    );
  } finally {
    await source.cleanup();
  }
});

test("Central source gap is accepted only with the exact stored attestation", () => {
  const base = {
    published_run_id: "central-run",
    property_key: "central_sydney",
    booking_hotel_id: 9888182,
    config_visible_review_count: 2000,
    displayed_review_count: 2537,
    source_count_final: 2536,
    structured_review_count: 2536,
    oldest_unique_count: 2536,
    newest_unique_count: 2536,
    oldest_identity_sha256: HASH_A,
    newest_identity_sha256: HASH_A,
    oldest_records_sha256: HASH_B,
    newest_records_sha256: HASH_B,
    discrepancy_contract_version: 1,
    discrepancy_contract_kind:
      SOURCE_GAP_CONTRACT.contractKind,
    discrepancy_property_key: "central_sydney",
    discrepancy_booking_hotel_id: 9888182,
    discrepancy_advertised_review_count: 2537,
    discrepancy_retrievable_review_count: 2536,
    discrepancy_gap_count: 1,
    discrepancy_score_bucket: "REVIEW_ADJ_AVERAGE_PASSABLE",
    discrepancy_advertised_bucket_count: 323,
    discrepancy_retrievable_bucket_count: 322,
    discrepancy_advertised_score_buckets_json:
      JSON.stringify(ADVERTISED_BUCKETS),
    discrepancy_retrievable_score_buckets_json:
      JSON.stringify(RETRIEVABLE_BUCKETS),
  };

  const accepted = dashboardDataInternals.validatePropertyEvidence(
    base,
    2536,
  );
  assert.equal(accepted.status, "source-gap");
  assert.deepEqual(accepted.sourceDiscrepancy, {
    sourceDiscrepancyKind:
      SOURCE_GAP_CONTRACT.contractKind,
    advertisedReviews: 2537,
    retrievableReviews: 2536,
    sourceReviewGap: 1,
    sourceDiscrepancyScoreBucket: "REVIEW_ADJ_AVERAGE_PASSABLE",
    advertisedBucketReviews: 323,
    retrievableBucketReviews: 322,
  });

  const advancedAdvertisedBuckets = ADVERTISED_BUCKETS.map(
    (bucket) => ({
      ...bucket,
      count:
        bucket.value === "REVIEW_ADJ_GOOD"
          ? bucket.count + 1
          : bucket.count,
    }),
  );
  const advancedRetrievableBuckets = RETRIEVABLE_BUCKETS.map(
    (bucket) => ({
      ...bucket,
      count:
        bucket.value === "REVIEW_ADJ_GOOD"
          ? bucket.count + 1
          : bucket.count,
    }),
  );
  const advanced = {
    ...base,
    displayed_review_count: 2538,
    source_count_final: 2537,
    structured_review_count: 2537,
    oldest_unique_count: 2537,
    newest_unique_count: 2537,
    discrepancy_advertised_review_count: 2538,
    discrepancy_retrievable_review_count: 2537,
    discrepancy_advertised_score_buckets_json: JSON.stringify(
      advancedAdvertisedBuckets,
    ),
    discrepancy_retrievable_score_buckets_json: JSON.stringify(
      advancedRetrievableBuckets,
    ),
  };
  assert.equal(
    dashboardDataInternals.validatePropertyEvidence(
      advanced,
      2537,
    ).status,
    "source-gap",
  );

  const missing = {
    ...base,
    discrepancy_contract_version: null,
    discrepancy_contract_kind: null,
  };
  assert.equal(
    dashboardDataInternals.validatePropertyEvidence(missing, 2536).status,
    "evidence-error",
  );
  assert.equal(
    dashboardDataInternals.validatePropertyEvidence(base, 2535).status,
    "evidence-error",
  );
  assert.equal(
    dashboardDataInternals.validatePropertyEvidence(
      {
        ...base,
        discrepancy_retrievable_bucket_count: 321,
      },
      2536,
    ).status,
    "evidence-error",
  );
});

test("dashboard evidence follows the accepted live snapshot, not stale config", () => {
  const property = {
    published_run_id: "fresh-run",
    property_key: "potts_point",
    booking_hotel_id: 9491412,
    config_visible_review_count: 2516,
    displayed_review_count: 2517,
    source_count_final: 2517,
    structured_review_count: 2517,
    oldest_unique_count: 2517,
    newest_unique_count: 2517,
    oldest_identity_sha256: HASH_A,
    newest_identity_sha256: HASH_A,
    oldest_records_sha256: HASH_B,
    newest_records_sha256: HASH_B,
    discrepancy_contract_version: null,
    discrepancy_contract_kind: null,
  };
  assert.equal(
    dashboardDataInternals.validatePropertyEvidence(
      property,
      2517,
    ).status,
    "verified",
  );
  assert.equal(
    dashboardDataInternals.validatePropertyEvidence(
      { ...property, displayed_review_count: 2518 },
      2517,
    ).status,
    "evidence-error",
  );
});
