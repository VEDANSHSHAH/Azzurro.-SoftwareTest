import test from "node:test";
import assert from "node:assert/strict";

import {
  identifyVisibleCountGap,
  maxAllowedVisibleCountGap,
  safeVisibleCountGap,
  VISIBLE_COUNT_GAP_CONTRACT,
} from "../src/visible-count-discrepancy.mjs";

const central = Object.freeze({
  propertyKey: "central_sydney",
  bookingHotelId: 9888182,
});

test("Central visible count gaps from one through five are disclosed", () => {
  for (const gapCount of [1, 2, 3, 4, 5]) {
    const evidence = identifyVisibleCountGap({
      ...central,
      visibleReviewCount: 2_534 + gapCount,
      structuredReviewCount: 2_534,
    });
    assert.equal(evidence.gapCount, gapCount);
    assert.equal(
      evidence.contractKind,
      VISIBLE_COUNT_GAP_CONTRACT.contractKind,
    );
    assert.deepEqual(safeVisibleCountGap(evidence), evidence);
  }
  assert.equal(
    maxAllowedVisibleCountGap(
      central.propertyKey,
      central.bookingHotelId,
    ),
    5,
  );
});

test("visible count tolerance is exact-identity, positive-only and bounded", () => {
  const candidate = {
    ...central,
    visibleReviewCount: 2_536,
    structuredReviewCount: 2_534,
  };
  assert.equal(
    identifyVisibleCountGap({
      ...candidate,
      visibleReviewCount: 2_534,
    }),
    null,
  );
  assert.equal(
    identifyVisibleCountGap({
      ...candidate,
      visibleReviewCount: 2_533,
    }),
    null,
  );
  assert.equal(
    identifyVisibleCountGap({
      ...candidate,
      visibleReviewCount: 2_540,
    }),
    null,
  );
  assert.equal(
    identifyVisibleCountGap({
      ...candidate,
      propertyKey: "potts_point",
    }),
    null,
  );
  assert.equal(
    identifyVisibleCountGap({
      ...candidate,
      bookingHotelId: 9888183,
    }),
    null,
  );
});
