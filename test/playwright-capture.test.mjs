import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import http from "node:http";

import {
  BrowserBootstrapError,
  inspectBootstrapDocument,
} from "../src/challenge-detector.mjs";
import {
  buildLivePayload,
  createLiveTemplate,
  isSemanticallyUnfiltered,
  liveTemplateInternals,
  parseReviewListPostData,
  PROVEN_REVIEW_LIST_QUERY_SHA256,
  REVIEW_SCORE_RANGE_VALUES,
  reviewScoreMatchesRange,
} from "../src/live-template.mjs";
import { fetchValidatedPage } from "../src/collector.mjs";
import {
  captureInternals,
  launchScraperBrowser,
  sanitizeCaptureDiagnostics,
} from "../src/playwright-capture.mjs";

const chromePath =
  process.env.AZZURRO_CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function createLocalTestTemplate(options) {
  return createLiveTemplate({
    ...options,
    requestUrl: "http://127.0.0.1/dml/graphql?lang=en-us",
    allowLocalTestOrigin: true,
    testOnlyAllowUnpinnedQuery: true,
  });
}

test("displayed score proof requires the expected score in its semantic component", () => {
  assert.equal(
    captureInternals.parseDisplayedScore(
      "Excellent\n8.8\n12 reviews",
      8.8,
    ),
    8.8,
  );
  assert.equal(
    captureInternals.parseDisplayedScore(
      "Excellent\n8.7\n8.8 km away",
      8.8,
    ),
    8.8,
  );
  assert.equal(
    captureInternals.parseDisplayedScore("Excellent\n8.7", 8.8),
    null,
  );
  assert.equal(
    captureInternals.parseDisplayedScore("12 reviews", 8.8),
    null,
  );
});

function card(index) {
  return {
    __typename: "ReviewCard",
    reviewUrl: `browser-${String(index).padStart(4, "0")}`,
    reviewedDate: 1_700_000_000 + index,
    reviewScore: (index % 10) + 1,
    textDetails: {
      __typename: "TextDetails",
      title: `Title ${index}`,
      positiveText: `Positive ${index}`,
      negativeText: null,
      lang: "en",
      textTrivialFlag: 0,
    },
    bookingDetails: null,
    guestDetails: null,
    partnerReply: null,
    photos: null,
    positiveHighlights: null,
    negativeHighlights: null,
    helpfulVotesCount: null,
    isApproved: true,
    isTranslatable: false,
    editUrl: null,
  };
}

function reviewBody(input) {
  const all = Array.from({ length: 12 }, (_, index) => card(index));
  const ordered =
    input.sorter === "OLDEST_FIRST" ? all : [...all].reverse();
  return {
    data: {
      reviewListFrontend: {
        __typename: "ReviewListFrontendResult",
        reviewsCount: 12,
        reviewCard: ordered.slice(input.skip, input.skip + input.limit),
        ratingScores: [
          {
            __typename: "RatingScore",
            name: "hotel_clean",
            translation: "Cleanliness",
            value: 8.8,
            ufiScoresAverage: null,
          },
        ],
        topicFilters: [],
        reviewScoreFilter: [],
        languageFilter: [],
        timeOfYearFilter: [],
        customerTypeFilter: [],
        roomTypeFilter: [],
        sorters: [
          {
            __typename: "ReviewSorter",
            value: "NEWEST_FIRST",
            name: "Newest first",
          },
          {
            __typename: "ReviewSorter",
            value: "OLDEST_FIRST",
            name: "Oldest first",
          },
        ],
      },
    },
  };
}

async function mockBookingServer({
  renderDelayMs = 0,
  reviewEntryCount = 1,
  requestFilters = { text: "" },
  requestAsBatch = false,
  openReviewModalOnClick = false,
  bookingDuplicateReviewControls = false,
  bookingReviewTestIds = true,
  listenerDelayMs = 0,
} = {}) {
  const graphRequests = [];
  const documentCookies = [];
  let bootstrap = 0;
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/hotel/au/mock.html") {
      bootstrap += 1;
      documentCookies.push(request.headers.cookie ?? null);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": `mock_session=${bootstrap}; Path=/; HttpOnly`,
      });
      response.end(`<!doctype html>
        <html><head><title>Mock Booking Property</title></head>
        <body>
          <div id="review-root"></div>
          <script>
            const payload = {
              operationName: "ReviewList",
              variables: {
                input: {
                  hotelId: 777,
                  ufi: -1,
                  hotelCountryCode: "au",
                  sorter: "MOST_RELEVANT",
                  filters: ${JSON.stringify(requestFilters)},
                  skip: 0,
                  limit: 10,
                  hotelScore: 8.8,
                  upsortReviewUrl: "",
                  searchFeatures: { destId: -1, destType: "CITY" }
                }
              },
              extensions: { clientLibrary: "mock" },
              query: "query ReviewList { reviewListFrontend { __typename } }"
            };
            function renderReviewEntries() {
              const root = document.querySelector("#review-root");
              const marker = document.createElement("div");
              marker.dataset.testid = "review-score-right-component";
              marker.textContent = "8.8 Excellent 12 reviews";
              root.append(marker);
              ${
                bookingDuplicateReviewControls && bookingReviewTestIds
                  ? `const scoreSummary = document.createElement("button");
                     scoreSummary.dataset.testid =
                       "review-score-read-all-actionable";
                     scoreSummary.textContent = "Read all reviews";
                     root.append(scoreSummary);`
                  : bookingDuplicateReviewControls
                    ? `const scoreSummary = document.createElement("button");
                       scoreSummary.textContent = "Read all reviews";
                       root.append(scoreSummary);`
                    : ""
              }
              for (
                let index = 0;
                index < ${reviewEntryCount};
                index += 1
              ) {
                const button = document.createElement("button");
                button.textContent = "Read all reviews";
                ${
                  bookingDuplicateReviewControls && bookingReviewTestIds
                    ? `if (index === 0) {
                         button.dataset.testid = "fr-read-all-reviews";
                       }`
                    : ""
                }
                const handleReviewClick = () => {
                  ${
                    openReviewModalOnClick
                      ? `const dialog = document.createElement("div");
                         dialog.setAttribute("role", "dialog");
                         dialog.textContent = "Guest reviews for Mock Booking Property";
                         document.body.append(dialog);`
                      : ""
                  }
                  const requestBody = ${
                    requestAsBatch
                      ? `[
                          {
                            operationName: "UnrelatedQuery",
                            variables: {},
                            query: "query UnrelatedQuery { __typename }"
                          },
                          payload
                        ]`
                      : "payload"
                  };
                  fetch("/dml/graphql?lang=en-us", {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      "x-booking-csrf-token": "TRANSIENT_SENTINEL",
                      "x-ignored-header": "do-not-forward"
                    },
                    credentials: "include",
                    body: JSON.stringify(requestBody)
                  });
                };
                ${
                  listenerDelayMs > 0
                    ? `setTimeout(
                         () => button.addEventListener(
                           "click",
                           handleReviewClick
                         ),
                         ${listenerDelayMs}
                       );`
                    : `button.addEventListener(
                         "click",
                         handleReviewClick
                       );`
                }
                root.append(button);
              }
            }
            ${
              renderDelayMs > 0
                ? `setTimeout(renderReviewEntries, ${renderDelayMs});`
                : "renderReviewEntries();"
            }
          </script>
        </body></html>`);
      return;
    }
    if (request.method === "POST" && request.url.startsWith("/dml/graphql")) {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const requestBody = JSON.parse(body);
        const operations = Array.isArray(requestBody)
          ? requestBody
          : [requestBody];
        const payload = operations.find(
          (operation) => operation?.operationName === "ReviewList",
        );
        graphRequests.push({
          payload,
          wasBatch: Array.isArray(requestBody),
          batchSize: operations.length,
          csrf: request.headers["x-booking-csrf-token"],
          ignored: request.headers["x-ignored-header"],
          cookiePresent: Boolean(request.headers.cookie),
        });
        if (
          graphRequests.length === 1 &&
          request.headers["x-booking-csrf-token"] !==
            "TRANSIENT_SENTINEL"
        ) {
          response.writeHead(403, { "content-type": "application/json" });
          response.end("{}");
          return;
        }
        const reviewResponse = reviewBody(payload.variables.input);
        const responseBody = Array.isArray(requestBody)
          ? operations.map((operation) =>
              operation?.operationName === "ReviewList"
                ? reviewResponse
                : { data: { __typename: "Query" } },
            )
          : reviewResponse;
        const json = JSON.stringify(responseBody);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(json);
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    graphRequests,
    documentCookies,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function mockChallengeServer({ autoResolveMs = null } = {}) {
  const graphRequests = [];
  let challengeClicks = 0;
  let challengeImageRequests = 0;
  const payloadScript = `
    const payload = {
      operationName: "ReviewList",
      variables: {
        input: {
          hotelId: 778,
          ufi: -1,
          hotelCountryCode: "au",
          sorter: "MOST_RELEVANT",
          filters: { text: "" },
          skip: 0,
          limit: 10,
          hotelScore: 8.8,
          upsortReviewUrl: "",
          searchFeatures: { destId: -1, destType: "CITY" }
        }
      },
      extensions: {},
      query: "query ReviewList { reviewListFrontend { __typename } }"
    };
    document.querySelector("#reviews").addEventListener("click", () => {
      fetch("/dml/graphql?lang=en-us", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-booking-csrf-token": "CHALLENGE_TEST_SENTINEL"
        },
        credentials: "include",
        body: JSON.stringify(payload)
      });
    });`;
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(
      request.url,
      `http://${request.headers.host}`,
    );
    if (
      request.method === "GET" &&
      requestUrl.pathname === "/hotel/au/challenge.html"
    ) {
      if (requestUrl.searchParams.get("resolved") === "1") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "challenge_clearance=approved; Path=/; HttpOnly",
        });
        response.end(`<!doctype html>
          <html><head><title>Resolved Property</title></head>
          <body>
            <div data-testid="review-score-right-component">
              8.8 Excellent 12 reviews
            </div>
            <button id="reviews">Read all reviews</button>
            <script>${payloadScript}</script>
          </body></html>`);
        return;
      }
      response.writeHead(202, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(`<!doctype html>
        <html><head><title>Security challenge</title></head>
        <body>
          <p>Please verify that you are human</p>
          <img src="/challenge-art.png" alt="Challenge artwork">
          <button id="reviews">Read all reviews</button>
          <script>
            document.querySelector("#reviews").addEventListener(
              "click",
              () => fetch("/challenge-click", { method: "POST" }),
            );
            ${
              autoResolveMs === null
                ? ""
                : `setTimeout(
                    () => location.replace(
                      "/hotel/au/challenge.html?resolved=1"
                    ),
                    ${autoResolveMs},
                  );`
            }
          </script>
        </body></html>`);
      return;
    }
    if (
      request.method === "GET" &&
      requestUrl.pathname === "/challenge-art.png"
    ) {
      challengeImageRequests += 1;
      response.writeHead(200, { "content-type": "image/png" });
      response.end(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      return;
    }
    if (
      request.method === "POST" &&
      requestUrl.pathname === "/challenge-click"
    ) {
      challengeClicks += 1;
      response.writeHead(204);
      response.end();
      return;
    }
    if (
      request.method === "POST" &&
      requestUrl.pathname === "/dml/graphql"
    ) {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const payload = JSON.parse(body);
        graphRequests.push(payload);
        const json = JSON.stringify(reviewBody(payload.variables.input));
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(json);
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    graphRequests,
    get challengeClicks() {
      return challengeClicks;
    },
    get challengeImageRequests() {
      return challengeImageRequests;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("live template changes only approved paging inputs and filters headers", () => {
  const property = { hotelId: 777 };
  const template = createLocalTestTemplate({
    requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
    requestHeaders: {
      accept: "*/*",
      "content-type": "application/json",
      cookie: "secret",
      origin: "https://www.booking.com",
      referer: "https://www.booking.com/hotel/au/mock.html",
      "x-booking-csrf-token": "csrf",
      "x-booking-auth": "must-not-be-replayed",
      "x-booking-timeout-ms": "4000",
      "x-apollo-operation-name": "ReviewList",
      "apollographql-client-name": "b-property-web-property-page",
      "x-ignored-header": "ignored",
    },
    payload: {
      operationName: "ReviewList",
      variables: {
        untouched: true,
        input: {
          hotelId: 777,
          skip: 0,
          limit: 10,
          sorter: "MOST_RELEVANT",
          filters: { text: "" },
          hotelScore: 8.8,
        },
      },
      extensions: { stable: true },
      query: "query ReviewList { x }",
    },
    property,
  });
  assert.equal(template.headers.cookie, undefined);
  assert.equal(template.headers.origin, undefined);
  assert.equal(template.headers.referer, undefined);
  assert.equal(template.headers["x-ignored-header"], undefined);
  assert.equal(template.headers["x-booking-csrf-token"], undefined);
  assert.equal(template.headers["x-booking-auth"], undefined);
  assert.equal(template.headers["x-booking-timeout-ms"], "4000");
  assert.equal(
    template.headers["x-apollo-operation-name"],
    "ReviewList",
  );
  assert.equal(
    template.headers["apollographql-client-name"],
    "b-property-web-property-page",
  );

  const page = buildLivePayload(template, {
    skip: 20,
    sorter: "OLDEST_FIRST",
  });
  assert.equal(page.variables.input.skip, 20);
  assert.equal(page.variables.input.sorter, "OLDEST_FIRST");
  assert.equal(page.variables.input.hotelId, 777);
  assert.equal(page.variables.untouched, true);
  assert.deepEqual(page.extensions, { stable: true });
  assert.equal(template.payloadTemplate.variables.input.skip, 0);
});

test("semantic unfiltered detection accepts neutral encodings only", () => {
  for (const filters of [
    {},
    { text: "" },
    { scoreRange: "ALL" },
    {
      text: "",
      scoreRange: "ALL",
      timeOfYear: "ALL",
      languages: [],
    },
    { languages: ["ALL"] },
    { languages: ["0"] },
    {
      scoreRange: "ALL",
      languages: ["0"],
      timeOfYear: "ALL",
    },
  ]) {
    assert.equal(
      isSemanticallyUnfiltered(filters),
      true,
      JSON.stringify(filters),
    );
  }
  for (const filters of [
    { text: "clean" },
    { scoreRange: "REVIEW_ADJ_SUPERB" },
    { languages: ["en"] },
    { timeOfYear: "_03_05" },
    { selected: false },
    { nested: {} },
    { unexpected: null },
    { unexpected: "ALL" },
    { unexpected: [] },
  ]) {
    assert.equal(
      isSemanticallyUnfiltered(filters),
      false,
      JSON.stringify(filters),
    );
  }
});

test("live templates accept every neutral observed shape and reject non-score filters", () => {
  const basePayload = {
    operationName: "ReviewList",
    variables: {
      input: {
        hotelId: 777,
        skip: 0,
        limit: 10,
        sorter: "NEWEST_FIRST",
        filters: {},
      },
    },
    query: "query ReviewList { x }",
  };
  for (const filters of [
    {},
    { text: "" },
    { scoreRange: "ALL" },
    {
      scoreRange: "ALL",
      timeOfYear: "ALL",
      languages: [],
    },
    {
      scoreRange: "ALL",
      timeOfYear: "ALL",
      languages: ["0"],
    },
  ]) {
    const template = createLocalTestTemplate({
      requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
      requestHeaders: { "content-type": "application/json" },
      payload: structuredClone({
        ...basePayload,
        variables: {
          input: { ...basePayload.variables.input, filters },
        },
      }),
      property: { hotelId: 777 },
    });
    const built = buildLivePayload(template, { filters });
    assert.deepEqual(built.variables.input.filters, filters);
  }

  assert.throws(
    () =>
      createLocalTestTemplate({
        requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
        requestHeaders: { "content-type": "application/json" },
        payload: {
          ...basePayload,
          variables: {
            input: {
              ...basePayload.variables.input,
              filters: { languages: ["en"] },
            },
          },
        },
        property: { hotelId: 777 },
      }),
    /must be unfiltered/,
  );
  const neutralTemplate = createLocalTestTemplate({
    requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
    requestHeaders: { "content-type": "application/json" },
    payload: basePayload,
    property: { hotelId: 777 },
  });
  assert.deepEqual(
    buildLivePayload(neutralTemplate, {
      filters: { scoreRange: "REVIEW_ADJ_SUPERB" },
    }).variables.input.filters,
    { scoreRange: "REVIEW_ADJ_SUPERB" },
  );
  assert.throws(
    () =>
      buildLivePayload(neutralTemplate, {
        filters: { languages: ["en"] },
      }),
    /unfiltered or one supported scoreRange/,
  );
});

test("score partition payloads accept exactly the five allowlisted ranges and preserve the template", () => {
  const template = createLocalTestTemplate({
    requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
    requestHeaders: { "content-type": "application/json" },
    payload: {
      operationName: "ReviewList",
      variables: {
        untouched: { stable: true },
        input: {
          hotelId: 777,
          skip: 0,
          limit: 10,
          sorter: "MOST_RELEVANT",
          filters: { text: "" },
          hotelScore: 8.8,
        },
      },
      extensions: { stable: "extension" },
      query: "query ReviewList { x }",
    },
    property: { hotelId: 777 },
  });
  const originalTemplate = structuredClone(template.payloadTemplate);

  assert.deepEqual(REVIEW_SCORE_RANGE_VALUES, [
    "REVIEW_ADJ_SUPERB",
    "REVIEW_ADJ_GOOD",
    "REVIEW_ADJ_AVERAGE_PASSABLE",
    "REVIEW_ADJ_POOR",
    "REVIEW_ADJ_VERY_POOR",
  ]);
  for (const scoreRange of REVIEW_SCORE_RANGE_VALUES) {
    const built = buildLivePayload(template, {
      skip: 20,
      limit: 7,
      sorter: "OLDEST_FIRST",
      filters: { scoreRange },
    });
    assert.deepEqual(built.variables.input.filters, { scoreRange });
    assert.equal(built.variables.input.skip, 20);
    assert.equal(built.variables.input.limit, 7);
    assert.equal(built.variables.input.sorter, "OLDEST_FIRST");
    assert.equal(built.variables.input.hotelId, 777);
    assert.equal(built.variables.input.hotelScore, 8.8);
    assert.deepEqual(built.variables.untouched, { stable: true });
    assert.deepEqual(built.extensions, { stable: "extension" });
    assert.equal(built.query, "query ReviewList { x }");
  }
  assert.deepEqual(template.payloadTemplate, originalTemplate);
});

test("score partition payloads reject unknown and mixed filter shapes", () => {
  const template = createLocalTestTemplate({
    requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
    requestHeaders: { "content-type": "application/json" },
    payload: {
      operationName: "ReviewList",
      variables: {
        input: {
          hotelId: 777,
          skip: 0,
          limit: 10,
          sorter: "NEWEST_FIRST",
          filters: { text: "" },
        },
      },
      query: "query ReviewList { x }",
    },
    property: { hotelId: 777 },
  });

  assert.throws(
    () =>
      buildLivePayload(template, {
        filters: { scoreRange: "REVIEW_ADJ_UNKNOWN" },
      }),
    /Unsupported ReviewList scoreRange/,
  );
  for (const filters of [
    {
      scoreRange: "REVIEW_ADJ_SUPERB",
      text: "",
    },
    {
      scoreRange: "REVIEW_ADJ_GOOD",
      languages: ["en"],
    },
    {
      scoreRange: "REVIEW_ADJ_POOR",
      unexpected: null,
    },
  ]) {
    assert.throws(
      () => buildLivePayload(template, { filters }),
      /must contain only one supported scoreRange/,
    );
  }
  assert.throws(
    () =>
      buildLivePayload(template, {
        filters: { topic: "cleanliness" },
      }),
    /unfiltered or one supported scoreRange/,
  );
});

test("score partition validation uses disjoint Booking score boundaries", () => {
  const cases = [
    ["REVIEW_ADJ_SUPERB", [9, 9.1, 10], [8.9, 10.1]],
    ["REVIEW_ADJ_GOOD", [7, 8, 8.9], [6.9, 9]],
    ["REVIEW_ADJ_AVERAGE_PASSABLE", [5, 6, 6.9], [4.9, 7]],
    ["REVIEW_ADJ_POOR", [3, 4, 4.9], [2.9, 5]],
    ["REVIEW_ADJ_VERY_POOR", [1, 2, 2.9], [0.9, 3]],
  ];
  for (const [scoreRange, accepted, rejected] of cases) {
    for (const score of accepted) {
      assert.equal(reviewScoreMatchesRange(score, scoreRange), true);
    }
    for (const score of rejected) {
      assert.equal(reviewScoreMatchesRange(score, scoreRange), false);
    }
    assert.equal(reviewScoreMatchesRange(Number.NaN, scoreRange), false);
    assert.equal(reviewScoreMatchesRange("9", scoreRange), false);
  }
  assert.throws(
    () => reviewScoreMatchesRange(9, "REVIEW_ADJ_UNKNOWN"),
    /Unsupported ReviewList scoreRange/,
  );
});

test("batched parser isolates ReviewList and build never replays siblings", () => {
  const sibling = {
    operationName: "UnrelatedQuery",
    variables: { sensitiveSibling: true },
    query: "query UnrelatedQuery { x }",
  };
  const review = {
    operationName: "ReviewList",
    variables: {
      input: {
        hotelId: 777,
        skip: 0,
        limit: 10,
        sorter: "MOST_RELEVANT",
        filters: { scoreRange: "ALL" },
      },
    },
    query: "query ReviewList { x }",
  };
  const parsed = parseReviewListPostData({
    method: () => "POST",
    postDataJSON: () => [sibling, review],
  });
  assert.equal(parsed.batched, true);
  assert.equal(parsed.batchSize, 2);
  assert.equal(parsed.operations.length, 1);
  assert.equal(parsed.operations[0].responseIndex, 1);
  assert.equal(parsed.operations[0].payload, review);

  const template = createLocalTestTemplate({
    requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
    requestHeaders: { "content-type": "application/json" },
    payload: parsed.operations[0].payload,
    property: { hotelId: 777 },
    requestWasBatch: parsed.batched,
    capturedBatchSize: parsed.batchSize,
  });
  const built = buildLivePayload(template, {
    sorter: "OLDEST_FIRST",
  });
  assert.equal(Array.isArray(built), true);
  assert.equal(built.length, 1);
  assert.equal(built[0].operationName, "ReviewList");
  assert.equal(built[0].variables.input.sorter, "OLDEST_FIRST");
  assert.equal(JSON.stringify(built).includes("sensitiveSibling"), false);
});

test("capture rejects ambiguous same-property operations and selects one unfiltered sibling", () => {
  const operation = (filters, responseIndex) => ({
    responseIndex,
    payload: {
      operationName: "ReviewList",
      variables: {
        input: {
          hotelId: 777,
          skip: 0,
          limit: 10,
          sorter: "MOST_RELEVANT",
          filters,
        },
      },
      query: "query ReviewList { x }",
    },
  });
  const unfiltered = operation({ text: "" }, 0);
  const duplicate = operation({ scoreRange: "ALL" }, 1);
  assert.throws(
    () =>
      captureInternals.selectCaptureOperation({
        parsed: { operations: [unfiltered, duplicate] },
        property: { hotelId: 777 },
      }),
    (error) =>
      error instanceof BrowserBootstrapError &&
      error.code === "AMBIGUOUS_REVIEW_CAPTURE",
  );

  const filtered = operation(
    { scoreRange: "REVIEW_ADJ_SUPERB" },
    1,
  );
  assert.equal(
    captureInternals.selectCaptureOperation({
      parsed: { operations: [filtered, unfiltered] },
      property: { hotelId: 777 },
    }),
    unfiltered,
  );
});

test("production accepts only the proven persisted ReviewList document", () => {
  const persistedHash = PROVEN_REVIEW_LIST_QUERY_SHA256;
  const payload = {
    operationName: "ReviewList",
    variables: {
      input: {
        hotelId: 777,
        skip: 0,
        limit: 10,
        sorter: "MOST_RELEVANT",
        filters: { text: "" },
      },
    },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: persistedHash,
      },
    },
  };
  const template = createLiveTemplate({
    requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
    requestHeaders: { "content-type": "application/json" },
    payload,
    property: { hotelId: 777 },
  });
  assert.equal(template.querySha256, persistedHash);
  const built = buildLivePayload(template, {
    skip: 10,
    sorter: "OLDEST_FIRST",
  });
  assert.equal(built.query, undefined);
  assert.deepEqual(built.extensions, payload.extensions);
  assert.equal(built.variables.input.skip, 10);

  assert.throws(
    () =>
      createLiveTemplate({
        requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
        requestHeaders: { "content-type": "application/json" },
        payload: {
          ...payload,
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: "a".repeat(64),
            },
          },
        },
        property: { hotelId: 777 },
      }),
    (error) =>
      error.code === "UNPROVEN_REVIEW_QUERY_DOCUMENT" &&
      error.details.expectedSha256 ===
        PROVEN_REVIEW_LIST_QUERY_SHA256 &&
      error.details.observedSha256 === "a".repeat(64),
  );
  assert.throws(
    () =>
      createLiveTemplate({
        requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
        requestHeaders: { "content-type": "application/json" },
        payload: {
          ...payload,
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: "a".repeat(64),
            },
          },
        },
        property: { hotelId: 777 },
        testOnlyAllowUnpinnedQuery: true,
      }),
    /only for an explicit local test endpoint/,
  );
  assert.throws(
    () =>
      createLiveTemplate({
        requestUrl: "https://www.booking.com/dml/graphql?lang=en-us",
        requestHeaders: { "content-type": "application/json" },
        payload: {
          ...payload,
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: "not-a-sha256",
            },
          },
        },
        property: { hotelId: 777 },
      }),
    /query text or persisted-query hash is missing/,
  );

  const local = createLocalTestTemplate({
    requestHeaders: { "content-type": "application/json" },
    payload: {
      ...payload,
      extensions: undefined,
      query: "query ReviewList { localFixture }",
    },
    property: { hotelId: 777 },
  });
  assert.match(local.querySha256, /^[a-f0-9]{64}$/);
});

test("challenge detector rejects challenge, access and property redirects", () => {
  const base = {
    status: 200,
    finalUrl: "https://www.booking.com/hotel/au/mock.html",
    canonicalUrl: "https://www.booking.com/hotel/au/mock.html",
    title: "Mock",
    bodyText: "Normal property",
  };
  assert.equal(inspectBootstrapDocument(base), true);
  assert.throws(
    () => inspectBootstrapDocument({ ...base, status: 202 }),
    (error) =>
      error instanceof BrowserBootstrapError &&
      error.code === "CHALLENGE",
  );
  assert.throws(
    () =>
      inspectBootstrapDocument({
        ...base,
        bodyText: "Please verify you are human",
      }),
    /challenge/i,
  );
  assert.throws(
    () =>
      inspectBootstrapDocument({
        ...base,
        finalUrl: "https://www.booking.com/index.html",
      }),
    /unexpected URL/,
  );
});

test(
  "fresh Playwright context captures and replays structured reviews locally",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockBookingServer();
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      headed: false,
    });
    const property = {
      key: "mock_property",
      hotelId: 777,
      canonicalUrl: `${mock.origin}/hotel/au/mock.html`,
    };
    try {
      for (let pass = 0; pass < 2; pass += 1) {
        const session = await browser.openPropertySession(property, {
          allowLocalTestOrigin: true,
          captureTimeoutMs: 10_000,
        });
        assert.equal(session.capturedHotelId, 777);
        assert.equal(session.visibleReviewCount, 12);
        assert.equal(session.displayedScore, 8.8);
        const page = await fetchValidatedPage({
          property,
          fetchRaw: session.fetchRaw,
          sorter: "OLDEST_FIRST",
          skip: 10,
        });
        assert.equal(page.reviewsCount, 12);
        assert.equal(page.cardCount, 2);
        await session.close();
      }
      assert.deepEqual(mock.documentCookies, [null, null]);
      assert.equal(browser.contextPolicy, "fresh_anonymous_per_property");
      assert.equal(mock.graphRequests.length, 4);
      assert.ok(mock.graphRequests.every((item) => item.cookiePresent));
      assert.deepEqual(
        mock.graphRequests.map((item) => item.csrf),
        [
          "TRANSIENT_SENTINEL",
          undefined,
          "TRANSIENT_SENTINEL",
          undefined,
        ],
      );
      assert.ok(
        [mock.graphRequests[1], mock.graphRequests[3]].every(
          (item) => item.ignored === undefined,
        ),
      );
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "capture waits for late-rendered review entries and clicks only one",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockBookingServer({
      renderDelayMs: 700,
      reviewEntryCount: 2,
    });
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      headed: false,
    });
    const property = {
      key: "delayed_review_entries",
      hotelId: 777,
      canonicalUrl: `${mock.origin}/hotel/au/mock.html`,
    };
    try {
      const session = await browser.openPropertySession(property, {
        allowLocalTestOrigin: true,
        captureTimeoutMs: 10_000,
      });
      assert.equal(session.capturedHotelId, 777);
      assert.equal(session.visibleReviewCount, 12);
      assert.equal(mock.graphRequests.length, 1);
      await session.close();
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "capture prioritizes Booking's full-review control over its score-summary decoy",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockBookingServer({
      bookingDuplicateReviewControls: true,
    });
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      headed: false,
    });
    const property = {
      key: "booking_duplicate_review_controls",
      hotelId: 777,
      canonicalUrl: `${mock.origin}/hotel/au/mock.html`,
    };
    try {
      const session = await browser.openPropertySession(property, {
        allowLocalTestOrigin: true,
        captureTimeoutMs: 3_000,
      });
      assert.equal(session.capturedHotelId, 777);
      assert.equal(mock.graphRequests.length, 1);
      await session.close();
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "capture prefers the later full-review control when duplicate labels have no test IDs",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockBookingServer({
      bookingDuplicateReviewControls: true,
      bookingReviewTestIds: false,
    });
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      headed: false,
    });
    const property = {
      key: "unmarked_duplicate_review_controls",
      hotelId: 777,
      canonicalUrl: `${mock.origin}/hotel/au/mock.html`,
    };
    try {
      const session = await browser.openPropertySession(property, {
        allowLocalTestOrigin: true,
        captureTimeoutMs: 3_000,
      });
      assert.equal(session.capturedHotelId, 777);
      assert.equal(mock.graphRequests.length, 1);
      await session.close();
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "capture retries once when Booking renders the control before hydration",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockBookingServer({
      bookingDuplicateReviewControls: true,
      listenerDelayMs: 700,
    });
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      headed: false,
    });
    const property = {
      key: "review_control_hydration",
      hotelId: 777,
      canonicalUrl: `${mock.origin}/hotel/au/mock.html`,
    };
    try {
      const session = await browser.openPropertySession(property, {
        allowLocalTestOrigin: true,
        captureTimeoutMs: 8_000,
      });
      assert.equal(session.capturedHotelId, 777);
      assert.equal(mock.graphRequests.length, 1);
      await session.close();
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "capture and replay support a batched ReviewList without sibling replay",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockBookingServer({
      requestAsBatch: true,
      requestFilters: { scoreRange: "ALL" },
    });
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      headed: false,
    });
    const property = {
      key: "batched_review_list",
      hotelId: 777,
      canonicalUrl: `${mock.origin}/hotel/au/mock.html`,
    };
    try {
      const session = await browser.openPropertySession(property, {
        allowLocalTestOrigin: true,
        captureTimeoutMs: 5_000,
      });
      const page = await fetchValidatedPage({
        property,
        fetchRaw: session.fetchRaw,
        sorter: "OLDEST_FIRST",
      });
      assert.equal(page.reviewsCount, 12);
      assert.deepEqual(
        mock.graphRequests.map((request) => [
          request.wasBatch,
          request.batchSize,
        ]),
        [
          [true, 2],
          [true, 1],
        ],
      );
      await session.close();
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "capture timeout exposes only typed sanitized diagnostics",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockBookingServer({
      requestFilters: { text: "private-filter-value" },
      openReviewModalOnClick: true,
    });
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      headed: false,
    });
    const property = {
      key: "filtered_capture_timeout",
      hotelId: 777,
      canonicalUrl: `${mock.origin}/hotel/au/mock.html`,
    };
    try {
      await assert.rejects(
        () =>
          browser.openPropertySession(property, {
            allowLocalTestOrigin: true,
            captureTimeoutMs: 1_500,
          }),
        (error) => {
          assert.equal(error.code, "REVIEW_CAPTURE_TIMEOUT");
          assert.deepEqual(error.details, {
            reviewListObserved: true,
            skip: 0,
            limit: 10,
            sorter: "MOST_RELEVANT",
            filterKeys: ["text"],
            semanticallyUnfiltered: false,
            batched: false,
            batchSize: 1,
            entryClicked: true,
            entryKind: "read_all_button",
            entryClickAttempts: 1,
            modalOpened: true,
          });
          const serialized = JSON.stringify(error);
          assert.equal(serialized.includes("private-filter-value"), false);
          assert.equal(serialized.includes("TRANSIENT_SENTINEL"), false);
          assert.equal(serialized.includes("cookie"), false);
          assert.deepEqual(
            sanitizeCaptureDiagnostics({
              ...error.details,
              headers: { cookie: "secret" },
              body: "secret",
            }),
            error.details,
          );
          return true;
        },
      );
      assert.equal(mock.graphRequests.length, 1);
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "interactive mode is headed and reuses one ephemeral anonymous context",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockBookingServer();
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      headed: false,
      interactiveChallenge: true,
    });
    const property = {
      key: "shared_context_property",
      hotelId: 777,
      canonicalUrl: `${mock.origin}/hotel/au/mock.html`,
    };
    try {
      assert.equal(browser.headed, true);
      assert.equal(
        browser.contextPolicy,
        "shared_ephemeral_anonymous_for_process",
      );
      for (let pass = 0; pass < 2; pass += 1) {
        const session = await browser.openPropertySession(property, {
          allowLocalTestOrigin: true,
          captureTimeoutMs: 10_000,
        });
        await session.close();
      }
      assert.equal(mock.documentCookies[0], null);
      assert.match(mock.documentCookies[1], /mock_session=1/);
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "interactive challenge waits for a human-equivalent resolution without clicking it",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockChallengeServer({ autoResolveMs: 150 });
    const notices = [];
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      interactiveChallenge: true,
      challengeTimeoutMs: 5_000,
      onChallenge: (notice) => notices.push(notice),
    });
    const property = {
      key: "challenge_property",
      hotelId: 778,
      canonicalUrl: `${mock.origin}/hotel/au/challenge.html`,
    };
    try {
      const session = await browser.openPropertySession(property, {
        allowLocalTestOrigin: true,
        captureTimeoutMs: 10_000,
      });
      assert.equal(session.capturedHotelId, 778);
      assert.equal(session.visibleReviewCount, 12);
      assert.equal(mock.challengeClicks, 0);
      assert.ok(mock.challengeImageRequests > 0);
      assert.equal(mock.graphRequests.length, 1);
      assert.deepEqual(notices, [
        { propertyKey: "challenge_property", timeoutMs: 5_000 },
      ]);
      await session.close();
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "challenge mode times out fail-closed and never attempts a bypass",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockChallengeServer();
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      interactiveChallenge: true,
      challengeTimeoutMs: 250,
    });
    const property = {
      key: "challenge_timeout_property",
      hotelId: 778,
      canonicalUrl: `${mock.origin}/hotel/au/challenge.html`,
    };
    try {
      await assert.rejects(
        () =>
          browser.openPropertySession(property, {
            allowLocalTestOrigin: true,
            captureTimeoutMs: 2_000,
          }),
        (error) =>
          error instanceof BrowserBootstrapError &&
          error.code === "CHALLENGE_TIMEOUT",
      );
      assert.equal(mock.challengeClicks, 0);
      assert.equal(mock.graphRequests.length, 0);
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test(
  "default mode rejects a challenge immediately without clicking it",
  { skip: !existsSync(chromePath) },
  async () => {
    const mock = await mockChallengeServer({ autoResolveMs: 1_000 });
    const browser = await launchScraperBrowser({
      executablePath: chromePath,
      headed: false,
    });
    const property = {
      key: "default_challenge_property",
      hotelId: 778,
      canonicalUrl: `${mock.origin}/hotel/au/challenge.html`,
    };
    try {
      await assert.rejects(
        () =>
          browser.openPropertySession(property, {
            allowLocalTestOrigin: true,
          }),
        (error) =>
          error instanceof BrowserBootstrapError &&
          error.code === "CHALLENGE",
      );
      assert.equal(mock.challengeClicks, 0);
      assert.equal(mock.graphRequests.length, 0);
    } finally {
      await browser.close();
      await mock.close();
    }
  },
);

test("safe header selector does not allow browser/session headers", () => {
  const selected = liveTemplateInternals.safeHeaders({
    accept: "*/*",
    "content-type": "application/json",
    cookie: "secret",
    origin: "https://www.booking.com",
    referer: "https://www.booking.com/hotel/au/mock.html",
    "sec-ch-ua": "secret",
    "user-agent": "secret",
    "x-booking-auth": "secret",
    "x-booking-csrf-token": "secret",
    "x-booking-et-serialized-state": "secret",
    "x-booking-pageview-id": "secret",
    "x-booking-timeout-ms": "4000",
    "x-apollo-operation-name": "ReviewList",
    "apollographql-client-name": "property-page",
    "apollographql-client-version": "dynamic",
    "x-envoy-upstream-rq-timeout-ms": "4000",
  });
  assert.deepEqual(selected, {
    accept: "*/*",
    "content-type": "application/json",
    "x-booking-timeout-ms": "4000",
    "x-apollo-operation-name": "ReviewList",
    "apollographql-client-name": "property-page",
    "apollographql-client-version": "dynamic",
    "x-envoy-upstream-rq-timeout-ms": "4000",
  });
});
