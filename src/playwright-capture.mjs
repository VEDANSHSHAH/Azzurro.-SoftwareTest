import { createRequire } from "node:module";

import {
  BrowserBootstrapError,
  inspectBootstrapDocument,
  isCanonicalPropertyDocument,
  isChallengeDocument,
} from "./challenge-detector.mjs";
import {
  createLiveTemplate,
  isSemanticallyUnfiltered,
  parseReviewListPostData,
  reviewListOperationFacts,
} from "./live-template.mjs";
import { createPageFetchTransport } from "./page-fetch-transport.mjs";
import {
  ContractError,
  validateReviewListResponse,
} from "./review-contract.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const DEFAULT_CHALLENGE_TIMEOUT_MS = 180_000;
const CHALLENGE_POLL_MS = 500;
const REVIEW_ENTRY_POLL_MS = 200;
const REVIEW_ENTRY_ACTIVATION_WAIT_MS = 3_000;
const MAX_REVIEW_ENTRY_CLICKS = 2;
const SAFE_REVIEW_SORTERS = new Set([
  "MOST_RELEVANT",
  "NEWEST_FIRST",
  "OLDEST_FIRST",
  "SCORE_DESC",
  "SCORE_ASC",
]);
const SAFE_REVIEW_ENTRY_KINDS = new Set([
  "full_testid",
  "read_all_button",
  "read_all_link",
  "guest_reviews_link",
  "tab_reviews_link",
]);

const CAPTURE_TIMEOUT = Symbol("capture-timeout");

function captureTimeout(milliseconds) {
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () => resolve(CAPTURE_TIMEOUT),
      milliseconds,
    );
    timeout.unref?.();
  });
}

function newCaptureDiagnostics() {
  return {
    reviewListObserved: false,
    skip: null,
    limit: null,
    sorter: null,
    filterKeys: [],
    semanticallyUnfiltered: null,
    batched: null,
    batchSize: null,
    entryClicked: false,
    entryKind: null,
    entryClickAttempts: 0,
    modalOpened: false,
  };
}

function recordReviewListObservation(
  diagnostics,
  parsed,
  payload,
) {
  Object.assign(diagnostics, reviewListOperationFacts(payload), {
    reviewListObserved: true,
    batched: parsed.batched,
    batchSize: Number.isSafeInteger(parsed.batchSize)
      ? parsed.batchSize
      : null,
  });
}

function selectCaptureOperation({
  parsed,
  property,
  allowHotelIdDiscovery = false,
}) {
  const propertyOperations = parsed.operations.filter(
    ({ payload }) =>
      Number(payload?.variables?.input?.hotelId) ===
        property.hotelId ||
      (allowHotelIdDiscovery && property.hotelId == null),
  );
  if (propertyOperations.length === 0) {
    throw new BrowserBootstrapError(
      "PROPERTY_IDENTITY_MISMATCH",
      "The page requested reviews for a different hotel ID",
    );
  }
  const eligibleOperations = propertyOperations.filter(
    ({ payload }) => {
      const input = payload?.variables?.input;
      return (
        input?.skip === 0 &&
        isSemanticallyUnfiltered(input?.filters)
      );
    },
  );
  if (eligibleOperations.length > 1) {
    throw new BrowserBootstrapError(
      "AMBIGUOUS_REVIEW_CAPTURE",
      "More than one unfiltered ReviewList first-page operation matched the property",
      { matchingOperationCount: eligibleOperations.length },
    );
  }
  return eligibleOperations[0] ?? null;
}

export function sanitizeCaptureDiagnostics(value) {
  return {
    reviewListObserved: value?.reviewListObserved === true,
    skip: Number.isSafeInteger(value?.skip) ? value.skip : null,
    limit: Number.isSafeInteger(value?.limit) ? value.limit : null,
    sorter: SAFE_REVIEW_SORTERS.has(value?.sorter)
      ? value.sorter
      : null,
    filterKeys: Array.isArray(value?.filterKeys)
      ? value.filterKeys
          .filter(
            (key) =>
              typeof key === "string" &&
              /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key),
          )
          .slice(0, 20)
      : [],
    semanticallyUnfiltered:
      typeof value?.semanticallyUnfiltered === "boolean"
        ? value.semanticallyUnfiltered
        : null,
    batched:
      typeof value?.batched === "boolean" ? value.batched : null,
    batchSize: Number.isSafeInteger(value?.batchSize)
      ? value.batchSize
      : null,
    entryClicked: value?.entryClicked === true,
    entryKind: SAFE_REVIEW_ENTRY_KINDS.has(value?.entryKind)
      ? value.entryKind
      : null,
    entryClickAttempts:
      Number.isSafeInteger(value?.entryClickAttempts) &&
      value.entryClickAttempts >= 0 &&
      value.entryClickAttempts <= MAX_REVIEW_ENTRY_CLICKS
        ? value.entryClickAttempts
        : 0,
    modalOpened: value?.modalOpened === true,
  };
}

async function hasOpenReviewModal(page) {
  const dialogs = page.locator('[role="dialog"]');
  let count = 0;
  try {
    count = Math.min(await dialogs.count(), 10);
  } catch {
    return false;
  }
  for (let index = 0; index < count; index += 1) {
    const dialog = dialogs.nth(index);
    try {
      if (!(await dialog.isVisible())) continue;
      const text = await dialog.innerText({ timeout: 1_000 });
      if (/\bguest reviews?\b|\breviews for\b/i.test(text)) {
        return true;
      }
    } catch {
      // A dialog can be replaced while the page finishes rendering.
    }
  }
  return false;
}

async function clickReviewEntry(
  page,
  {
    timeoutMs = 15_000,
    captureObserved = () => false,
    onEntryClick = null,
  } = {},
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("review entry timeout must be a positive integer");
  }
  if (typeof captureObserved !== "function") {
    throw new TypeError("captureObserved must be a function");
  }
  if (onEntryClick != null && typeof onEntryClick !== "function") {
    throw new TypeError("onEntryClick must be a function or null");
  }
  const candidates = [
    {
      locator: page.getByTestId("fr-read-all-reviews"),
      preferLast: false,
      kind: "full_testid",
    },
    {
      locator: page.getByRole("button", { name: /read all reviews/i }),
      // When Booking renders both its score-summary and full-list buttons
      // without stable test IDs, the full-list action is the later control.
      preferLast: true,
      kind: "read_all_button",
    },
    {
      locator: page.getByRole("link", { name: /read all reviews/i }),
      preferLast: true,
      kind: "read_all_link",
    },
    {
      locator: page.getByRole("link", { name: /guest reviews/i }),
      preferLast: false,
      kind: "guest_reviews_link",
    },
    {
      locator: page.locator('a[href*="#tab-reviews"]'),
      preferLast: false,
      kind: "tab_reviews_link",
    },
  ];

  const deadline = Date.now() + timeoutMs;
  let successfulClicks = 0;
  while (Date.now() <= deadline) {
    if (captureObserved() || (await hasOpenReviewModal(page))) {
      return false;
    }
    for (const { locator, preferLast, kind } of candidates) {
      let count = 0;
      try {
        count = Math.min(await locator.count(), 10);
      } catch {
        continue;
      }
      const indexes = Array.from({ length: count }, (_, index) => index);
      if (preferLast) indexes.reverse();
      for (const index of indexes) {
        if (captureObserved() || (await hasOpenReviewModal(page))) {
          return false;
        }
        const candidate = locator.nth(index);
        try {
          if (!(await candidate.isVisible())) continue;
          // Booking currently exposes two controls with the same accessible
          // name. This score-summary control only scrolls to the review
          // section; it does not open the full review dialog or issue
          // ReviewList. Skip it so capture reaches the actionable control.
          if (
            (await candidate.getAttribute("data-testid")) ===
            "review-score-read-all-actionable"
          ) {
            continue;
          }
          await candidate.click({ timeout: 5_000 });
          successfulClicks += 1;
          onEntryClick?.(kind);
          const activationDeadline = Math.min(
            deadline,
            Date.now() + REVIEW_ENTRY_ACTIVATION_WAIT_MS,
          );
          while (Date.now() <= activationDeadline) {
            if (captureObserved() || (await hasOpenReviewModal(page))) {
              return true;
            }
            const remaining = activationDeadline - Date.now();
            if (remaining <= 0) break;
            await page.waitForTimeout(
              Math.min(REVIEW_ENTRY_POLL_MS, remaining),
            );
          }
          // Booking can render the button before its client handler hydrates.
          // Retry at most once, and only after neither a modal nor a review
          // request appeared during the bounded activation window.
          if (successfulClicks >= MAX_REVIEW_ENTRY_CLICKS) return true;
        } catch {
          // If the click opened the modal before the element detached, do
          // not toggle it closed by trying another matching entry point.
          if (await hasOpenReviewModal(page)) return false;
        }
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(
      Math.min(REVIEW_ENTRY_POLL_MS, remaining),
    );
  }
  return successfulClicks > 0;
}

async function hasVisibleReviewMarker(page) {
  const candidates = [
    page.locator('[data-testid="review-score-right-component"]'),
    page.locator('[data-testid="review-score-component"]'),
    page.getByRole("button", { name: /read all reviews/i }),
    page.getByRole("link", { name: /read all reviews/i }),
    page.getByRole("link", { name: /guest reviews/i }),
    page.locator('a[href*="#tab-reviews"]'),
  ];
  for (const locator of candidates) {
    try {
      if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
        return true;
      }
    } catch {
      // A page can navigate while the human is completing the challenge.
    }
  }
  return false;
}

async function readDocumentState(page, status) {
  const [title, bodyText, visibleReviewMarker] = await Promise.all([
    page.title().catch(() => ""),
    page.locator("body").innerText({ timeout: 2_000 }).catch(() => ""),
    hasVisibleReviewMarker(page),
  ]);
  return {
    status,
    finalUrl: page.url(),
    title,
    bodyText,
    visibleReviewMarker,
  };
}

async function waitForHumanChallengeResolution({
  page,
  property,
  getDocumentStatus,
  timeoutMs = DEFAULT_CHALLENGE_TIMEOUT_MS,
  allowLocalTestOrigin = false,
  onChallenge = null,
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("challenge timeout must be a positive integer");
  }
  if (onChallenge != null && typeof onChallenge !== "function") {
    throw new TypeError("onChallenge must be a function or null");
  }
  await onChallenge?.({
    propertyKey: property.key,
    timeoutMs,
  });

  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() <= deadline) {
    lastState = await readDocumentState(page, getDocumentStatus());
    const successfulDocument =
      Number.isInteger(lastState.status) &&
      lastState.status >= 200 &&
      lastState.status < 300 &&
      lastState.status !== 202;
    if (
      successfulDocument &&
      isCanonicalPropertyDocument({
        finalUrl: lastState.finalUrl,
        canonicalUrl: property.canonicalUrl,
        allowLocalTestOrigin,
      }) &&
      lastState.visibleReviewMarker &&
      !isChallengeDocument(lastState)
    ) {
      inspectBootstrapDocument({
        ...lastState,
        canonicalUrl: property.canonicalUrl,
        allowLocalTestOrigin,
      });
      return lastState;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(CHALLENGE_POLL_MS, remaining));
  }
  throw new BrowserBootstrapError(
    "CHALLENGE_TIMEOUT",
    "Timed out waiting for manual challenge resolution",
    {
      timeoutMs,
      finalPath: (() => {
        try {
          return new URL(lastState?.finalUrl ?? page.url()).pathname;
        } catch {
          return null;
        }
      })(),
    },
  );
}

function parseCount(text) {
  const matches = [
    ...String(text).matchAll(/(?:^|\s)([\d,]+)\s+reviews?\b/gi),
  ];
  if (matches.length === 0) return null;
  const values = matches
    .map((match) => Number(match[1].replaceAll(",", "")))
    .filter(Number.isSafeInteger);
  return values.length > 0 ? Math.max(...values) : null;
}

function parseDisplayedScore(text, expectedScore) {
  if (
    typeof expectedScore !== "number" ||
    !Number.isFinite(expectedScore) ||
    expectedScore < 0 ||
    expectedScore > 10
  ) {
    return null;
  }
  const expectedTenths = Math.round(expectedScore * 10);
  const scores = [
    ...String(text).matchAll(
      /(?:^|[^\d])((?:10(?:\.0)?|[0-9](?:\.[0-9])?))(?![\d.])/g,
    ),
  ]
    .map((match) => Number(match[1]))
    .filter(
      (value) =>
        Number.isFinite(value) &&
        Math.round(value * 10) === expectedTenths,
    );
  return scores.length > 0 ? expectedTenths / 10 : null;
}

async function visibleMetadata(page, template) {
  let text = "";
  let visibleReviewCount = null;
  for (const locator of [
    page.locator('[role="dialog"]'),
    page.locator('[data-testid="review-score-right-component"]'),
    page.locator("body"),
  ]) {
    try {
      if ((await locator.count()) > 0) {
        const part = await locator.first().innerText({ timeout: 3_000 });
        text += `\n${part}`;
        if (visibleReviewCount === null) {
          visibleReviewCount = parseCount(part);
        }
      }
    } catch {
      // Metadata parity remains optional if the page has changed.
    }
  }
  let scoreComponentText = "";
  for (const locator of [
    page.locator('[data-testid="review-score-right-component"]'),
    page.locator('[data-testid="review-score-component"]'),
  ]) {
    try {
      const count = Math.min(await locator.count(), 10);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible()) {
          scoreComponentText += `\n${await candidate.innerText({
            timeout: 3_000,
          })}`;
        }
      }
    } catch {
      // Authoritative orchestration will reject a missing score proof.
    }
  }
  const displayedScore = parseDisplayedScore(
    scoreComponentText,
    template.capturedHotelScore,
  );
  return { visibleReviewCount, displayedScore };
}

async function createAnonymousContext(browser) {
  return browser.newContext({
    locale: "en-US",
    timezoneId: "Australia/Sydney",
    viewport: { width: 1440, height: 1200 },
    serviceWorkers: "block",
    acceptDownloads: false,
  });
}

async function capturePropertySession({
  browser,
  context: suppliedContext = null,
  property,
  navigationTimeoutMs = 45_000,
  captureTimeoutMs = 30_000,
  requestTimeoutMs = 20_000,
  interactiveChallenge = false,
  challengeTimeoutMs = DEFAULT_CHALLENGE_TIMEOUT_MS,
  onChallenge = null,
  allowLocalTestOrigin = false,
  allowHotelIdDiscovery = false,
}) {
  const ownsContext = suppliedContext === null;
  const context =
    suppliedContext ?? (await createAnonymousContext(browser));
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(navigationTimeoutMs);
  if (!interactiveChallenge) {
    await page.route("**/*", async (route) => {
      if (
        ["image", "media", "font"].includes(
          route.request().resourceType(),
        )
      ) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
  }

  let settled = false;
  let captureObserved = false;
  let latestDocumentStatus = null;
  const captureDiagnostics = newCaptureDiagnostics();
  let resolveCapture;
  let rejectCapture;
  const capturedPromise = new Promise((resolve, reject) => {
    resolveCapture = resolve;
    rejectCapture = reject;
  });
  // A response can reject the capture while the page-interaction helper is
  // still waiting for activation. Mark it handled immediately; the later
  // Promise.race still observes and propagates the original rejection.
  void capturedPromise.catch(() => {});

  const responseListener = async (response) => {
    const request = response.request();
    if (
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame()
    ) {
      latestDocumentStatus = response.status();
    }
    if (settled) return;
    const parsed = parseReviewListPostData(request);
    if (!parsed) return;
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname !== "/dml/graphql") return;

    for (const candidate of parsed.operations) {
      recordReviewListObservation(
        captureDiagnostics,
        parsed,
        candidate.payload,
      );
    }
    let operation;
    try {
      operation = selectCaptureOperation({
        parsed,
        property,
        allowHotelIdDiscovery,
      });
    } catch (error) {
      settled = true;
      rejectCapture(error);
      return;
    }
    if (!operation) return;
    const payload = operation.payload;
    const hotelId = Number(payload.variables.input.hotelId);
    captureObserved = true;

    try {
      const requestHeaders = await request.allHeaders();
      const text = await response.text();
      if (response.status() !== 200) {
        throw new BrowserBootstrapError(
          response.status() === 429 ? "RATE_LIMITED" : "REVIEW_HTTP_ERROR",
          `Initial ReviewList returned HTTP ${response.status()}`,
        );
      }
      const responseHeaders = await response.allHeaders();
      if (
        !String(responseHeaders["content-type"] ?? "")
          .toLowerCase()
          .includes("json")
      ) {
        throw new BrowserBootstrapError(
          "REVIEW_NOT_JSON",
          "Initial ReviewList response was not JSON",
        );
      }
      const responseBody = JSON.parse(text);
      let body = responseBody;
      if (parsed.batched) {
        if (
          !Array.isArray(responseBody) ||
          operation.responseIndex >= responseBody.length
        ) {
          throw new BrowserBootstrapError(
            "REVIEW_BATCH_RESPONSE_MISMATCH",
            "The ReviewList batch response did not match its request",
          );
        }
        body = responseBody[operation.responseIndex];
      }
      try {
        validateReviewListResponse(body, {
          propertyKey: property.key,
          skip: 0,
          limit: payload.variables.input.limit,
          // Capture proves the document and full card schema only.
          // The authoritative canary re-validates this unfiltered
          // response with strict aggregate-count evidence before any run.
          unfiltered: false,
        });
      } catch (error) {
        if (!(error instanceof ContractError)) throw error;
        const contractMessage = String(error.message)
          .replace(/[^A-Za-z0-9_.:[\](), -]/g, "?")
          .slice(0, 240);
        throw new BrowserBootstrapError(
          "REVIEW_CONTRACT_ERROR",
          "Initial ReviewList response did not match the required schema",
          {
            contractMessage,
            cardIndex: Number.isSafeInteger(
              error.details?.cardIndex,
            )
              ? error.details.cardIndex
              : null,
          },
        );
      }
      const capturedProperty = {
        ...property,
        hotelId,
      };
      const template = createLiveTemplate({
        requestUrl: request.url(),
        requestHeaders,
        payload,
        property: capturedProperty,
        requestWasBatch: parsed.batched,
        capturedBatchSize: parsed.batchSize,
        allowLocalTestOrigin,
        testOnlyAllowUnpinnedQuery: allowLocalTestOrigin,
      });
      settled = true;
      resolveCapture({ template });
    } catch (error) {
      settled = true;
      rejectCapture(error);
    }
  };
  page.on("response", responseListener);

  try {
    const navigation = await page.goto(property.canonicalUrl, {
      waitUntil: "domcontentloaded",
    });
    latestDocumentStatus = navigation?.status() ?? latestDocumentStatus ?? 0;
    let documentState = await readDocumentState(
      page,
      latestDocumentStatus,
    );
    try {
      inspectBootstrapDocument({
        ...documentState,
        canonicalUrl: property.canonicalUrl,
        allowLocalTestOrigin,
      });
    } catch (error) {
      if (
        !interactiveChallenge ||
        !(error instanceof BrowserBootstrapError) ||
        error.code !== "CHALLENGE"
      ) {
        throw error;
      }
      documentState = await waitForHumanChallengeResolution({
        page,
        property,
        getDocumentStatus: () => latestDocumentStatus,
        timeoutMs: challengeTimeoutMs,
        allowLocalTestOrigin,
        onChallenge,
      });
    }

    const captureDeadline = Date.now() + captureTimeoutMs;
    captureDiagnostics.modalOpened = await hasOpenReviewModal(page);
    if (!settled) {
      captureDiagnostics.entryClicked = await clickReviewEntry(page, {
        timeoutMs: captureTimeoutMs,
        captureObserved: () => captureObserved || settled,
        onEntryClick: (kind) => {
          captureDiagnostics.entryKind = kind;
          captureDiagnostics.entryClickAttempts += 1;
        },
      });
      captureDiagnostics.modalOpened =
        captureDiagnostics.modalOpened ||
        (await hasOpenReviewModal(page));
    }
    const remainingCaptureMs = Math.max(
      1,
      captureDeadline - Date.now(),
    );
    const captured = await Promise.race([
      capturedPromise,
      captureTimeout(remainingCaptureMs),
    ]);
    if (captured === CAPTURE_TIMEOUT) {
      captureDiagnostics.modalOpened =
        captureDiagnostics.modalOpened ||
        (await hasOpenReviewModal(page));
      throw new BrowserBootstrapError(
        "REVIEW_CAPTURE_TIMEOUT",
        "Timed out waiting for an unfiltered ReviewList first page",
        sanitizeCaptureDiagnostics(captureDiagnostics),
      );
    }
    const metadata = await visibleMetadata(page, captured.template);
    const fetchRaw = createPageFetchTransport({
      page,
      template: captured.template,
      timeoutMs: requestTimeoutMs,
    });

    return {
      capturedHotelId: captured.template.capturedHotelId,
      capturedHotelScore: captured.template.capturedHotelScore,
      querySha256: captured.template.querySha256,
      pageTitle: documentState.title,
      visibleReviewCount: metadata.visibleReviewCount,
      displayedScore: metadata.displayedScore,
      fetchRaw,
      async close() {
        if (!page.isClosed()) await page.close();
        if (ownsContext) await context.close();
      },
    };
  } catch (error) {
    if (!page.isClosed()) await page.close().catch(() => {});
    if (ownsContext) await context.close().catch(() => {});
    throw error;
  } finally {
    page.off("response", responseListener);
  }
}

export async function launchScraperBrowser({
  executablePath,
  headed = false,
  interactiveChallenge = false,
  challengeTimeoutMs = DEFAULT_CHALLENGE_TIMEOUT_MS,
  onChallenge = null,
  launchOptions = {},
} = {}) {
  if (
    !Number.isInteger(challengeTimeoutMs) ||
    challengeTimeoutMs < 1
  ) {
    throw new TypeError(
      "challengeTimeoutMs must be a positive integer",
    );
  }
  const effectiveHeaded = headed || interactiveChallenge;
  const browser = await chromium.launch({
    ...launchOptions,
    ...(executablePath ? { executablePath } : {}),
    headless: !effectiveHeaded,
  });
  let sharedContextPromise = null;
  async function sharedContext() {
    if (!sharedContextPromise) {
      sharedContextPromise = createAnonymousContext(browser);
    }
    return sharedContextPromise;
  }
  return {
    headed: effectiveHeaded,
    contextPolicy: interactiveChallenge
      ? "shared_ephemeral_anonymous_for_process"
      : "fresh_anonymous_per_property",
    openPropertySession: async (property, options = {}) =>
      capturePropertySession({
        browser,
        property,
        ...options,
        ...(interactiveChallenge
          ? { context: await sharedContext() }
          : {}),
        interactiveChallenge,
        challengeTimeoutMs,
        onChallenge,
      }),
    async close() {
      if (sharedContextPromise) {
        const context = await sharedContextPromise.catch(() => null);
        await context?.close().catch(() => {});
      }
      await browser.close();
    },
  };
}

export const captureInternals = Object.freeze({
  parseCount,
  parseDisplayedScore,
  visibleMetadata,
  clickReviewEntry,
  hasOpenReviewModal,
  hasVisibleReviewMarker,
  waitForHumanChallengeResolution,
  createAnonymousContext,
  capturePropertySession,
  newCaptureDiagnostics,
  recordReviewListObservation,
  selectCaptureOperation,
});
