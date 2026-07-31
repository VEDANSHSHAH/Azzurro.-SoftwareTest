import test from "node:test";
import assert from "node:assert/strict";

import {
  ContractError,
  PARSER_VERSION,
  classifyHttpBody,
  contentHash,
  normalizeReview,
  recordHash,
  stableStringify,
  validateReviewListResponse,
} from "../src/review-contract.mjs";
import {
  CANONICAL_REVIEW_PHOTO_HOSTNAME,
} from "../src/photo-url-parity.mjs";

function card(overrides = {}) {
  const base = {
    __typename: "ReviewCard",
    reviewUrl: "0123456789abcdef",
    reviewedDate: 1_785_458_459,
    reviewScore: 9,
    textDetails: {
      __typename: "TextDetails",
      title: "Good stay",
      positiveText: "Clean room",
      negativeText: null,
      lang: "en",
      textTrivialFlag: 0,
    },
    bookingDetails: null,
    guestDetails: null,
    partnerReply: null,
    photos: [],
    helpfulVotesCount: 0,
    positiveHighlights: null,
    negativeHighlights: null,
    isApproved: true,
    isTranslatable: false,
    editUrl: null,
  };
  const result = { ...base, ...overrides };
  if (
    overrides.textDetails !== null &&
    typeof overrides.textDetails === "object" &&
    !Array.isArray(overrides.textDetails)
  ) {
    result.textDetails = {
      ...base.textDetails,
      ...overrides.textDetails,
    };
  }
  if (
    overrides.bookingDetails !== null &&
    typeof overrides.bookingDetails === "object" &&
    !Array.isArray(overrides.bookingDetails)
  ) {
    const bookingDefaults = {
      __typename: "BookingDetails",
      customerType: null,
      roomId: null,
      roomType: null,
      checkoutDate: null,
      checkinDate: null,
      numNights: null,
      stayStatus: null,
    };
    result.bookingDetails = {
      ...bookingDefaults,
      ...overrides.bookingDetails,
    };
    if (
      overrides.bookingDetails.roomType !== null &&
      typeof overrides.bookingDetails.roomType === "object" &&
      !Array.isArray(overrides.bookingDetails.roomType)
    ) {
      result.bookingDetails.roomType = {
        __typename: "RoomTranslation",
        id: null,
        name: null,
        ...overrides.bookingDetails.roomType,
      };
    }
  }
  if (
    overrides.guestDetails !== null &&
    typeof overrides.guestDetails === "object" &&
    !Array.isArray(overrides.guestDetails)
  ) {
    result.guestDetails = {
      __typename: "GuestDetails",
      username: null,
      avatarUrl: null,
      countryCode: null,
      countryName: null,
      avatarColor: null,
      showCountryFlag: null,
      anonymous: null,
      guestTypeTranslation: null,
      userReviewCount: null,
      joinedDate: null,
      ...overrides.guestDetails,
    };
  }
  if (
    overrides.partnerReply !== null &&
    typeof overrides.partnerReply === "object" &&
    !Array.isArray(overrides.partnerReply)
  ) {
    result.partnerReply = {
      __typename: "PropertyReplyData",
      reply: null,
      ...overrides.partnerReply,
    };
  }
  return result;
}

function reviewPhoto(url, overrides = {}) {
  return {
    __typename: "ReviewPhoto",
    id: 7,
    kind: "PROPERTY",
    mlTagHighestProbability: 0.982,
    urls: [
      {
        __typename: "ReviewPhotoUrl",
        size: "square80",
        url,
      },
    ],
    ...overrides,
  };
}

function response(cards = [card()], reviewsCount = cards.length) {
  return {
    data: {
      reviewListFrontend: {
        __typename: "ReviewListFrontendResult",
        reviewsCount,
        reviewCard: cards,
        ratingScores: [],
        topicFilters: [],
        reviewScoreFilter: [],
        languageFilter: [],
        timeOfYearFilter: [],
        customerTypeFilter: [],
        roomTypeFilter: null,
        sorters: [],
      },
    },
  };
}

function responseWithAggregateMetadata({
  reviewsCount = 12,
  aggregateCount = reviewsCount,
} = {}) {
  const result = response([card()], reviewsCount);
  const list = result.data.reviewListFrontend;
  list.ratingScores = [
    {
      __typename: "RatingScore",
      name: "hotel_clean",
      translation: "Cleanliness",
      value: 9.4,
      ufiScoresAverage: {
        __typename: "UfiScoreAverage",
        ufiScoreLowerBound: 7.5,
        ufiScoreHigherBound: 9.6,
      },
    },
  ];
  list.topicFilters = [
    {
      __typename: "TopicFilter",
      id: 276,
      name: "Clean",
      isSelected: false,
      translation: {
        __typename: "ReviewTopicTranslation",
        id: "topic_clean",
        name: "Clean",
      },
    },
  ];
  list.reviewScoreFilter = [
    {
      __typename: "ReviewScoreFilter",
      name: `All (${aggregateCount})`,
      value: "ALL",
      count: aggregateCount,
    },
  ];
  list.languageFilter = [
    {
      __typename: "LanguageFilter",
      name: `All (${aggregateCount})`,
      value: "",
      count: aggregateCount,
      countryFlag: null,
    },
  ];
  list.timeOfYearFilter = [
    {
      __typename: "TimeOfYearFilter",
      name: `All (${aggregateCount})`,
      value: "ALL",
      count: aggregateCount,
    },
    {
      __typename: "TimeOfYearFilter",
      name: "Mar–May",
      value: "_03_05",
      count: 0,
    },
    {
      __typename: "TimeOfYearFilter",
      name: "Jun–Aug",
      value: "_06_08",
      count: 0,
    },
  ];
  list.customerTypeFilter = [
    {
      __typename: "CustomerTypeFilter",
      name: `All (${aggregateCount})`,
      value: "ALL",
      count: aggregateCount,
    },
  ];
  list.roomTypeFilter = [
    {
      __typename: "RoomTypeFilter",
      name: "Double room",
      roomTypeId: "12",
      count: 3,
      roomIds: [12],
    },
  ];
  list.sorters = [
    {
      __typename: "ReviewSorter",
      name: "Newest first",
      value: "NEWEST_FIRST",
    },
    {
      __typename: "ReviewSorter",
      name: "Oldest first",
      value: "OLDEST_FIRST",
    },
  ];
  return result;
}

test("accepts a valid review page", () => {
  const result = validateReviewListResponse(response(), {
    propertyKey: "olympic",
    skip: 0,
    limit: 10,
  });
  assert.equal(result.cardCount, 1);
  assert.equal(result.reviews[0].sourceKey, "olympic:0123456789abcdef");
  assert.match(result.reviews[0].contentHash, /^[a-f0-9]{64}$/);
  assert.match(result.reviews[0].recordHash, /^[a-f0-9]{64}$/);
  assert.equal(result.typename, "ReviewListFrontendResult");
});

test("preserves the complete source card and useful normalized fields", () => {
  const source = card({
    unknownFutureField: { retained: true },
    textDetails: {
      __typename: "TextDetails",
      title: "✨ Great stay",
      positiveText: "Clean\nand quiet",
      negativeText: "No lift",
      textTrivialFlag: 1,
      lang: "en",
    },
    bookingDetails: {
      __typename: "BookingDetails",
      customerType: "COUPLES",
      roomId: 12,
      roomType: {
        __typename: "RoomTranslation",
        id: "12",
        name: "Double room",
      },
      checkoutDate: "2026-07-31",
      checkinDate: "2026-07-30",
      numNights: 1,
      stayStatus: "stayed",
    },
    guestDetails: {
      __typename: "GuestDetails",
      username: "Guest",
      avatarUrl: "https://example.test/avatar.png",
      countryCode: "au",
      countryName: "Australia",
      avatarColor: null,
      showCountryFlag: true,
      anonymous: false,
      guestTypeTranslation: "Couple",
      userReviewCount: 2,
      joinedDate: 1_651_436_761,
    },
    partnerReply: {
      __typename: "PropertyReplyData",
      reply: "Thank you",
    },
    helpfulVotesCount: 3,
    positiveHighlights: [
      { __typename: "Highlight", start: 0, end: 5 },
    ],
    negativeHighlights: [
      { __typename: "Highlight", start: 0, end: 2 },
    ],
    photos: [
      {
        __typename: "ReviewPhoto",
        id: 7,
        kind: "PROPERTY",
        mlTagHighestProbability: 0.982,
        urls: [
          {
            __typename: "ReviewPhotoUrl",
            size: "square80",
            url: "https://cf.bstatic.com/photo.jpg",
          },
        ],
      },
    ],
  });
  const normalized = normalizeReview(source, "olympic");

  assert.deepEqual(normalized.sourceCard, source);
  assert.notEqual(normalized.sourceCard, source);
  assert.equal(
    normalized.combinedText,
    "✨ Great stay\nClean\nand quiet\nNo lift",
  );
  assert.equal(normalized.textTrivialFlag, 1);
  assert.equal(normalized.bookingDetails.roomType.name, "Double room");
  assert.equal(normalized.guestDetails.countryCode, "au");
  assert.equal(
    normalized.sourceCard.photos[0].mlTagHighestProbability,
    0.982,
  );
  assert.equal(normalized.partnerReply, "Thank you");
  assert.equal(normalized.helpfulVotesCount, 3);
});

test("requires a property key even for an empty property", () => {
  assert.throws(
    () => validateReviewListResponse(response([], 0)),
    /propertyKey is required/,
  );
  assert.throws(
    () =>
      validateReviewListResponse(response([], 0), {
        propertyKey: "  ",
      }),
    /propertyKey is required/,
  );
});

test("requires both result and review-card typenames", () => {
  const missingResultType = response();
  delete missingResultType.data.reviewListFrontend.__typename;
  assert.throws(
    () =>
      validateReviewListResponse(missingResultType, {
        propertyKey: "olympic",
      }),
    /Unexpected reviewListFrontend type/,
  );

  const missingCardType = card();
  delete missingCardType.__typename;
  assert.throws(
    () =>
      validateReviewListResponse(response([missingCardType]), {
        propertyKey: "olympic",
      }),
    /Unexpected reviewCard type/,
  );
});

test("requires every observed top-level review-card key", () => {
  const requiredKeys = [
    "__typename",
    "reviewUrl",
    "guestDetails",
    "bookingDetails",
    "reviewedDate",
    "isTranslatable",
    "helpfulVotesCount",
    "reviewScore",
    "textDetails",
    "isApproved",
    "partnerReply",
    "positiveHighlights",
    "negativeHighlights",
    "editUrl",
    "photos",
  ];
  for (const key of requiredKeys) {
    const source = card();
    delete source[key];
    assert.throws(
      () => normalizeReview(source, "olympic"),
      ContractError,
      key,
    );
  }
});

test("accepts explicit null for every nullable top-level review field", () => {
  for (const key of [
    "guestDetails",
    "bookingDetails",
    "isTranslatable",
    "helpfulVotesCount",
    "textDetails",
    "isApproved",
    "partnerReply",
    "positiveHighlights",
    "negativeHighlights",
    "editUrl",
    "photos",
  ]) {
    assert.doesNotThrow(
      () => normalizeReview(card({ [key]: null }), "olympic"),
      key,
    );
  }
});

test("requires every observed nested review key when its object exists", () => {
  const profiles = [
    {
      name: "textDetails",
      keys: [
        "__typename",
        "title",
        "positiveText",
        "negativeText",
        "textTrivialFlag",
        "lang",
      ],
      make: () => {
        const source = card();
        return { source, object: source.textDetails };
      },
    },
    {
      name: "bookingDetails",
      keys: [
        "__typename",
        "customerType",
        "roomId",
        "roomType",
        "checkoutDate",
        "checkinDate",
        "numNights",
        "stayStatus",
      ],
      make: () => {
        const source = card({ bookingDetails: {} });
        return { source, object: source.bookingDetails };
      },
    },
    {
      name: "bookingDetails.roomType",
      keys: ["__typename", "id", "name"],
      make: () => {
        const source = card({
          bookingDetails: { roomType: {} },
        });
        return {
          source,
          object: source.bookingDetails.roomType,
        };
      },
    },
    {
      name: "guestDetails",
      keys: [
        "__typename",
        "username",
        "avatarUrl",
        "countryCode",
        "countryName",
        "avatarColor",
        "showCountryFlag",
        "anonymous",
        "guestTypeTranslation",
      ],
      make: () => {
        const source = card({ guestDetails: {} });
        return { source, object: source.guestDetails };
      },
    },
    {
      name: "partnerReply",
      keys: ["__typename", "reply"],
      make: () => {
        const source = card({ partnerReply: {} });
        return { source, object: source.partnerReply };
      },
    },
    {
      name: "photos[]",
      keys: [
        "__typename",
        "id",
        "urls",
        "kind",
      ],
      make: () => {
        const source = card({
          photos: [
            {
              __typename: "ReviewPhoto",
              id: null,
              urls: [],
              kind: null,
              mlTagHighestProbability: null,
            },
          ],
        });
        return { source, object: source.photos[0] };
      },
    },
    {
      name: "photos[].urls[]",
      keys: ["__typename", "size", "url"],
      make: () => {
        const source = card({
          photos: [
            {
              __typename: "ReviewPhoto",
              id: null,
              kind: null,
              mlTagHighestProbability: null,
              urls: [
                {
                  __typename: "ReviewPhotoUrl",
                  size: null,
                  url: "https://cf.bstatic.com/photo.jpg",
                },
              ],
            },
          ],
        });
        return { source, object: source.photos[0].urls[0] };
      },
    },
    {
      name: "positiveHighlights[]",
      keys: ["start", "end"],
      make: () => {
        const source = card({
          positiveHighlights: [{ start: 0, end: 1 }],
        });
        return {
          source,
          object: source.positiveHighlights[0],
        };
      },
    },
  ];

  for (const profile of profiles) {
    for (const key of profile.keys) {
      const { source, object } = profile.make();
      delete object[key];
      assert.throws(
        () => normalizeReview(source, "olympic"),
        ContractError,
        `${profile.name}.${key}`,
      );
    }
  }
});

test("accepts only the three query-conditional nested omissions", () => {
  for (const field of ["userReviewCount", "joinedDate"]) {
    const source = card({ guestDetails: {} });
    delete source.guestDetails[field];
    const normalized = normalizeReview(source, "olympic");
    assert.equal(normalized.guestDetails[field], null, field);
    assert.equal(Object.hasOwn(normalized.sourceCard.guestDetails, field), false);
  }

  const source = card({
    photos: [
      {
        __typename: "ReviewPhoto",
        id: null,
        urls: [],
        kind: null,
        mlTagHighestProbability: 0.9,
      },
    ],
  });
  delete source.photos[0].mlTagHighestProbability;
  const normalized = normalizeReview(source, "olympic");
  assert.equal(normalized.photos[0].mlTagHighestProbability, null);
  assert.equal(
    Object.hasOwn(
      normalized.sourceCard.photos[0],
      "mlTagHighestProbability",
    ),
    false,
  );

  const missingUnconditional = card({ guestDetails: {} });
  delete missingUnconditional.guestDetails.countryCode;
  assert.throws(
    () => normalizeReview(missingUnconditional, "olympic"),
    /guestDetails\.countryCode is required/,
  );
});

test("accepts observed non-negative integer trivial flags and rejects other types", () => {
  for (const flag of [0, 1, 7, Number.MAX_SAFE_INTEGER, null]) {
    const normalized = normalizeReview(
      card({
        textDetails: {
          title: null,
          positiveText: null,
          negativeText: null,
          lang: "xu",
          textTrivialFlag: flag,
        },
      }),
      "olympic",
    );
    assert.equal(normalized.textTrivialFlag, flag);
  }
  for (const flag of [
    true,
    false,
    -1,
    1.5,
    "0",
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () =>
        normalizeReview(
          card({
            textDetails: {
              title: null,
              positiveText: null,
              negativeText: null,
              lang: "xu",
              textTrivialFlag: flag,
            },
          }),
          "olympic",
        ),
      /textTrivialFlag/,
    );
  }
});

test("accepts score-only reviews and preserves null text", () => {
  const result = validateReviewListResponse(
    response([
      card({
        textDetails: {
          title: null,
          positiveText: null,
          negativeText: null,
          lang: "xu",
        },
      }),
    ]),
    { propertyKey: "olympic" },
  );
  assert.equal(result.reviews[0].title, null);
  assert.equal(result.reviews[0].positiveText, null);
  assert.equal(result.reviews[0].negativeText, null);
});

test("rejects duplicate source keys within a page", () => {
  assert.throws(
    () =>
      validateReviewListResponse(response([card(), card()]), {
        propertyKey: "olympic",
      }),
    ContractError,
  );
});

test("rejects GraphQL errors even when HTTP could be 200", () => {
  assert.throws(
    () =>
      validateReviewListResponse(
        { errors: [{ message: "contract changed" }] },
        { propertyKey: "olympic" },
      ),
    /GraphQL returned errors/,
  );
});

test("rejects non-zero count with empty first page", () => {
  assert.throws(
    () =>
      validateReviewListResponse(response([], 12), {
        propertyKey: "olympic",
        skip: 0,
      }),
    /empty first page/,
  );
});

test("allows an empty terminal page after the first offset", () => {
  const result = validateReviewListResponse(response([], 12), {
    propertyKey: "olympic",
    skip: 20,
  });
  assert.equal(result.cardCount, 0);
});

test("uses the hostname-only photo parity contract in parser 2.4", () => {
  assert.equal(PARSER_VERSION, "2.4.0");
});

test("canonicalizes only rotating Booking CDN photo hostnames", () => {
  const stableSuffix =
    ":443/xdata/images/hotel/square80/42.jpg?k=asset-key&hp=1#crop";
  const firstRawUrl = `https://cf.bstatic.com${stableSuffix}`;
  const secondRawUrl = `https://q-xx.bstatic.com${stableSuffix}`;
  const firstSource = card({
    photos: [reviewPhoto(firstRawUrl)],
  });
  const secondSource = card({
    photos: [reviewPhoto(secondRawUrl)],
  });

  const first = normalizeReview(firstSource, "olympic");
  const second = normalizeReview(secondSource, "olympic");
  const expectedCanonicalUrl =
    `https://${CANONICAL_REVIEW_PHOTO_HOSTNAME}${stableSuffix}`;

  assert.deepEqual(first.sourceCard, firstSource);
  assert.deepEqual(second.sourceCard, secondSource);
  assert.equal(first.sourceCard.photos[0].urls[0].url, firstRawUrl);
  assert.equal(second.sourceCard.photos[0].urls[0].url, secondRawUrl);
  assert.equal(first.photos[0].urls[0].url, expectedCanonicalUrl);
  assert.equal(second.photos[0].urls[0].url, expectedCanonicalUrl);
  assert.equal(contentHash(first), contentHash(second));
  assert.equal(recordHash(first), recordHash(second));
});

test("photo parity preserves every non-host URL component", () => {
  const baseUrl =
    "https://cf.bstatic.com:8443/xdata/images/hotel/square80/42.jpg" +
    "?k=asset-key&hp=1#crop";
  const baseline = normalizeReview(
    card({ photos: [reviewPhoto(baseUrl)] }),
    "olympic",
  );
  const changedUrls = [
    baseUrl.replace(":8443", ":8444"),
    baseUrl.replace("/42.jpg", "/43.jpg"),
    baseUrl.replace("k=asset-key", "k=other-key"),
    baseUrl.replace(
      "?k=asset-key&hp=1",
      "?hp=1&k=asset-key",
    ),
    baseUrl.replace("#crop", "#full"),
  ];

  for (const changedUrl of changedUrls) {
    const changed = normalizeReview(
      card({ photos: [reviewPhoto(changedUrl)] }),
      "olympic",
    );
    assert.notEqual(
      contentHash(baseline),
      contentHash(changed),
      changedUrl,
    );
    assert.notEqual(
      recordHash(baseline),
      recordHash(changed),
      changedUrl,
    );
  }
});

test("photo metadata and structure remain parity-covered", () => {
  const url =
    "https://r-xx.bstatic.com/xdata/images/hotel/square80/42.jpg?k=stable";
  const baseline = normalizeReview(
    card({ photos: [reviewPhoto(url)] }),
    "olympic",
  );
  const variants = [
    reviewPhoto(url, { id: 8 }),
    reviewPhoto(url, { kind: "GUEST" }),
    reviewPhoto(url, { mlTagHighestProbability: 0.5 }),
    reviewPhoto(url, {
      urls: [
        {
          __typename: "ReviewPhotoUrl",
          size: "square60",
          url,
        },
      ],
    }),
    reviewPhoto(url, {
      urls: [
        {
          __typename: "ReviewPhotoUrl",
          size: "square80",
          url,
        },
        {
          __typename: "ReviewPhotoUrl",
          size: "square60",
          url: url.replace("square80", "square60"),
        },
      ],
    }),
  ];

  for (const photo of variants) {
    const changed = normalizeReview(
      card({ photos: [photo] }),
      "olympic",
    );
    assert.notEqual(contentHash(baseline), contentHash(changed));
    assert.notEqual(recordHash(baseline), recordHash(changed));
  }
});

test("rejects unsafe or non-Booking review photo URLs", () => {
  const invalidUrls = [
    "http://cf.bstatic.com/xdata/photo.jpg",
    "/xdata/photo.jpg",
    "not a URL",
    "https://example.test/xdata/photo.jpg",
    "https://bstatic.com.evil.test/xdata/photo.jpg",
    "https://guest@cf.bstatic.com/xdata/photo.jpg",
    "https://cf.bstatic.com/xdata/photo.jpg raw-space",
  ];

  for (const url of invalidUrls) {
    assert.throws(
      () =>
        normalizeReview(
          card({ photos: [reviewPhoto(url)] }),
          "olympic",
        ),
      (error) =>
        error instanceof ContractError &&
        /photos\[0\]\.urls\[0\]\.url is invalid/.test(error.message),
      url,
    );
  }
});

test("content hash changes when a partner reply changes", () => {
  const first = normalizeReview(card(), "olympic");
  const second = normalizeReview(
    card({ partnerReply: { reply: "Thank you" } }),
    "olympic",
  );
  assert.notEqual(contentHash(first), contentHash(second));
});

test("record hash covers every retained source field", () => {
  const first = normalizeReview(card(), "olympic");
  const changes = [
    { reviewScore: 8 },
    { helpfulVotesCount: 2 },
    { isApproved: false },
    { isTranslatable: true },
    { guestDetails: { anonymous: true } },
    { bookingDetails: { numNights: 2 } },
    { unknownFutureField: "new source value" },
  ];
  for (const change of changes) {
    const changed = normalizeReview(card(change), "olympic");
    assert.notEqual(recordHash(first), recordHash(changed));
  }
});

test("canonical hashing ignores object key insertion order", () => {
  const first = normalizeReview(
    card({
      guestDetails: {
        username: "Guest",
        countryCode: "au",
        anonymous: false,
      },
    }),
    "olympic",
  );
  const second = normalizeReview(
    card({
      guestDetails: {
        anonymous: false,
        countryCode: "au",
        username: "Guest",
      },
    }),
    "olympic",
  );
  assert.equal(recordHash(first), recordHash(second));
  assert.equal(
    stableStringify(first.sourceCard),
    stableStringify(second.sourceCard),
  );
});

test("record hash catches metadata changes that content hash excludes", () => {
  const first = normalizeReview(card(), "olympic");
  const second = normalizeReview(
    card({ helpfulVotesCount: 4 }),
    "olympic",
  );
  assert.equal(contentHash(first), contentHash(second));
  assert.notEqual(recordHash(first), recordHash(second));
});

test("rejects malformed optional review structures instead of erasing them", () => {
  const malformedCards = [
    card({ photos: "not-an-array" }),
    card({ photos: ["not-an-object"] }),
    card({ photos: [{ id: 1, urls: "not-an-array" }] }),
    card({
      photos: [
        {
          id: 1,
          mlTagHighestProbability: true,
          urls: [],
        },
      ],
    }),
    card({
      photos: [
        {
          id: 1,
          mlTagHighestProbability: Number.POSITIVE_INFINITY,
          urls: [],
        },
      ],
    }),
    card({ positiveHighlights: "not-an-array" }),
    card({ positiveHighlights: [{ start: 5, end: 2 }] }),
    card({ bookingDetails: "not-an-object" }),
    card({ bookingDetails: { numNights: -1 } }),
    card({ guestDetails: "not-an-object" }),
    card({ guestDetails: { anonymous: "false" } }),
    card({ partnerReply: "not-an-object" }),
    card({ helpfulVotesCount: -1 }),
    card({ isApproved: 1 }),
    card({ isTranslatable: "true" }),
  ];
  for (const malformed of malformedCards) {
    assert.throws(
      () => normalizeReview(malformed, "olympic"),
      ContractError,
    );
  }
});

test("rejects malformed response metadata arrays", () => {
  for (const field of [
    "ratingScores",
    "topicFilters",
    "reviewScoreFilter",
    "languageFilter",
    "timeOfYearFilter",
    "customerTypeFilter",
    "sorters",
    "roomTypeFilter",
  ]) {
    const malformed = response();
    malformed.data.reviewListFrontend[field] = "not-an-array";
    assert.throws(
      () =>
        validateReviewListResponse(malformed, {
          propertyKey: "olympic",
        }),
      ContractError,
    );
  }
});

test("validates aggregate metadata and ignores seasonal bucket sums", () => {
  const result = validateReviewListResponse(
    responseWithAggregateMetadata(),
    {
      propertyKey: "olympic",
      unfiltered: true,
    },
  );
  assert.equal(result.totalConsistency.status, "consistent");
  assert.equal(result.totalConsistency.totals.length, 4);
  assert.equal(result.filters.timeOfYear[1].count, 0);
  assert.equal(result.filters.timeOfYear[2].count, 0);
});

test("gates inconsistent trusted totals only for unfiltered responses", () => {
  const inconsistent = responseWithAggregateMetadata({
    reviewsCount: 12,
    aggregateCount: 13,
  });
  assert.throws(
    () =>
      validateReviewListResponse(inconsistent, {
        propertyKey: "olympic",
        unfiltered: true,
      }),
    (error) =>
      error instanceof ContractError &&
      error.details.totalConsistency.status === "inconsistent" &&
      error.details.totalConsistency.disagreements.length === 4,
  );

  const filtered = validateReviewListResponse(inconsistent, {
    propertyKey: "olympic",
    unfiltered: false,
  });
  assert.equal(
    filtered.totalConsistency.status,
    "not_evaluated_filtered",
  );
  assert.throws(
    () =>
      validateReviewListResponse(inconsistent, {
        propertyKey: "olympic",
        unfiltered: "yes",
      }),
    /unfiltered must be a boolean/,
  );
});

test("allows a bounded structured-list discrepancy for any property", () => {
  const exact = responseWithAggregateMetadata({
    reviewsCount: 2536,
    aggregateCount: 2537,
  });
  exact.data.reviewListFrontend.reviewScoreFilter.push(
    ...[
      ["REVIEW_ADJ_SUPERB", 1327],
      ["REVIEW_ADJ_GOOD", 573],
      ["REVIEW_ADJ_AVERAGE_PASSABLE", 323],
      ["REVIEW_ADJ_POOR", 162],
      ["REVIEW_ADJ_VERY_POOR", 152],
    ].map(([value, count]) => ({
      __typename: "ReviewScoreFilter",
      name: value,
      value,
      count,
    })),
  );
  const accepted = validateReviewListResponse(exact, {
    propertyKey: "central_sydney",
    unfiltered: true,
  });
  assert.equal(accepted.reviewsCount, 2536);
  assert.equal(accepted.totalConsistency.status, "inconsistent");

  const advanced = responseWithAggregateMetadata({
    reviewsCount: 2537,
    aggregateCount: 2538,
  });
  advanced.data.reviewListFrontend.reviewScoreFilter.push(
    ...[
      ["REVIEW_ADJ_SUPERB", 1327],
      ["REVIEW_ADJ_GOOD", 574],
      ["REVIEW_ADJ_AVERAGE_PASSABLE", 323],
      ["REVIEW_ADJ_POOR", 162],
      ["REVIEW_ADJ_VERY_POOR", 152],
    ].map(([value, count]) => ({
      __typename: "ReviewScoreFilter",
      name: value,
      value,
      count,
    })),
  );
  assert.equal(
    validateReviewListResponse(advanced, {
      propertyKey: "central_sydney",
      unfiltered: true,
    }).reviewsCount,
    2537,
  );

  // The gap is a Booking aggregation artefact, not a property-specific
  // exception, so any property may disclose one within the same bound.
  assert.equal(
    validateReviewListResponse(exact, {
      propertyKey: "another_property",
      unfiltered: true,
    }).reviewsCount,
    2536,
  );

  const wide = responseWithAggregateMetadata({
    reviewsCount: 2530,
    aggregateCount: 2537,
  });
  assert.throws(
    () =>
      validateReviewListResponse(wide, {
        propertyKey: "central_sydney",
        unfiltered: true,
      }),
    /aggregate totals disagree/,
  );

  const negative = responseWithAggregateMetadata({
    reviewsCount: 2538,
    aggregateCount: 2537,
  });
  assert.throws(
    () =>
      validateReviewListResponse(negative, {
        propertyKey: "central_sydney",
        unfiltered: true,
      }),
    /aggregate totals disagree/,
  );
});

test("rejects malformed aggregate metadata fields", () => {
  const mutations = [
    (list) => {
      list.ratingScores[0].value = "9.4";
    },
    (list) => {
      list.ratingScores.push({ ...list.ratingScores[0] });
    },
    (list) => {
      list.topicFilters[0].isSelected = "false";
    },
    (list) => {
      list.reviewScoreFilter[0].count = -1;
    },
    (list) => {
      list.languageFilter[0].value = null;
    },
    (list) => {
      delete list.sorters[0].name;
    },
    (list) => {
      list.roomTypeFilter[0].roomIds = "12";
    },
  ];
  for (const mutate of mutations) {
    const malformed = responseWithAggregateMetadata();
    mutate(malformed.data.reviewListFrontend);
    assert.throws(
      () =>
        validateReviewListResponse(malformed, {
          propertyKey: "olympic",
        }),
      ContractError,
    );
  }
});

test("classifies HTML instead of treating it as an empty result", () => {
  const result = classifyHttpBody({
    status: 200,
    contentType: "text/html",
    text: "<html>challenge</html>",
  });
  assert.equal(result.kind, "unexpected_content");
  assert.doesNotMatch(JSON.stringify(result), /challenge/);
});

test("classifies rate limiting and access denial", () => {
  assert.equal(
    classifyHttpBody({
      status: 202,
      contentType: "text/html",
      text: "",
    }).kind,
    "challenge",
  );
  assert.equal(
    classifyHttpBody({
      status: 429,
      contentType: "text/html",
      text: "",
    }).kind,
    "rate_limited",
  );
  assert.equal(
    classifyHttpBody({
      status: 403,
      contentType: "text/html",
      text: "",
    }).kind,
    "access_denied",
  );
});

test("rejects Booking ReviewsFrontendError despite HTTP 200 JSON", () => {
  assert.throws(
    () =>
      validateReviewListResponse(
        {
          data: {
            reviewListFrontend: {
              __typename: "ReviewsFrontendError",
            },
          },
        },
        { propertyKey: "olympic" },
      ),
    /ReviewsFrontendError/,
  );
});

test("same content with different source tokens remains two reviews", () => {
  const result = validateReviewListResponse(
    response([
      card({ reviewUrl: "aaaaaaaaaaaaaaaa" }),
      card({ reviewUrl: "bbbbbbbbbbbbbbbb" }),
    ]),
    { propertyKey: "olympic" },
  );
  assert.equal(result.cardCount, 2);
  assert.notEqual(
    result.reviews[0].sourceKey,
    result.reviews[1].sourceKey,
  );
});

test("rejects missing required review identity, date and score", () => {
  for (const broken of [
    card({ reviewUrl: null }),
    card({ reviewedDate: null }),
    card({ reviewedDate: Number.MAX_SAFE_INTEGER }),
    card({ reviewScore: 11 }),
  ]) {
    assert.throws(
      () =>
        validateReviewListResponse(response([broken]), {
          propertyKey: "olympic",
        }),
      ContractError,
    );
  }
});

test("classifies server errors and invalid JSON", () => {
  assert.equal(
    classifyHttpBody({
      status: 503,
      contentType: "application/json",
      text: "{}",
    }).kind,
    "temporary_server_error",
  );
  assert.equal(
    classifyHttpBody({
      status: 200,
      contentType: "application/json",
      text: "{not-json",
    }).kind,
    "invalid_json",
  );
  assert.equal(
    classifyHttpBody({
      status: 408,
      contentType: "application/json",
      text: "{}",
    }).kind,
    "temporary_server_error",
  );
  assert.deepEqual(
    classifyHttpBody({
      status: 404,
      contentType: "application/json",
      text: "{}",
    }),
    { kind: "http_error", status: 404 },
  );
});
