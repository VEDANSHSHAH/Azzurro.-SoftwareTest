export const VISIBLE_COUNT_GAP_CONTRACT = Object.freeze({
  contractKind: "booking_visible_count_gap_v1",
  contractVersion: 1,
  propertyKey: "central_sydney",
  bookingHotelId: 9888182,
  maxPositiveGap: 5,
});

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function maxAllowedVisibleCountGap(propertyKey, bookingHotelId) {
  return propertyKey === VISIBLE_COUNT_GAP_CONTRACT.propertyKey &&
    Number(bookingHotelId) ===
      VISIBLE_COUNT_GAP_CONTRACT.bookingHotelId
    ? VISIBLE_COUNT_GAP_CONTRACT.maxPositiveGap
    : 0;
}

export function identifyVisibleCountGap({
  propertyKey,
  bookingHotelId,
  visibleReviewCount,
  structuredReviewCount,
}) {
  if (!isCount(visibleReviewCount) || !isCount(structuredReviewCount)) {
    return null;
  }
  if (visibleReviewCount === structuredReviewCount) return null;

  const gapCount = visibleReviewCount - structuredReviewCount;
  if (
    maxAllowedVisibleCountGap(propertyKey, bookingHotelId) === 0 ||
    gapCount < 1 ||
    gapCount > VISIBLE_COUNT_GAP_CONTRACT.maxPositiveGap
  ) {
    return null;
  }

  return Object.freeze({
    contractKind: VISIBLE_COUNT_GAP_CONTRACT.contractKind,
    contractVersion: VISIBLE_COUNT_GAP_CONTRACT.contractVersion,
    propertyKey,
    bookingHotelId: Number(bookingHotelId),
    visibleReviewCount,
    structuredReviewCount,
    gapCount,
  });
}

export function safeVisibleCountGap(evidence) {
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    evidence.contractKind !==
      VISIBLE_COUNT_GAP_CONTRACT.contractKind ||
    evidence.contractVersion !==
      VISIBLE_COUNT_GAP_CONTRACT.contractVersion
  ) {
    return null;
  }
  const normalized = identifyVisibleCountGap(evidence);
  if (
    normalized === null ||
    normalized.gapCount !== evidence.gapCount
  ) {
    return null;
  }
  return normalized;
}
