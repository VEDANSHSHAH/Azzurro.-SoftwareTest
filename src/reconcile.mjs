import { ContractError } from "./review-contract.mjs";

function validateReview(review, path) {
  if (
    typeof review?.sourceKey !== "string" ||
    review.sourceKey.length === 0 ||
    typeof review?.recordHash !== "string" ||
    review.recordHash.length === 0
  ) {
    throw new ContractError(
      `${path} requires non-empty sourceKey and recordHash`,
    );
  }
  return review;
}

function uniqueSnapshot(reviews, label) {
  if (!Array.isArray(reviews)) {
    throw new ContractError(`${label} must be an array`);
  }
  const indexed = new Map();
  for (const [index, review] of reviews.entries()) {
    validateReview(review, `${label}[${index}]`);
    if (indexed.has(review.sourceKey)) {
      throw new ContractError(`${label} contains a duplicate sourceKey`, {
        sourceKey: review.sourceKey,
        index,
      });
    }
    indexed.set(review.sourceKey, review);
  }
  return indexed;
}

export function reconcileCompleteRun({ pages, reportedCount }) {
  if (!Array.isArray(pages)) {
    throw new ContractError("pages must be an array");
  }
  if (!Number.isSafeInteger(reportedCount) || reportedCount < 0) {
    throw new ContractError(
      "reportedCount must be a non-negative safe integer",
    );
  }

  const byKey = new Map();
  let duplicateOccurrences = 0;

  for (const [pageIndex, page] of pages.entries()) {
    if (!Array.isArray(page)) {
      throw new ContractError("each page must be an array", {
        pageIndex,
      });
    }
    const pageKeys = new Set();
    for (const [reviewIndex, review] of page.entries()) {
      validateReview(
        review,
        `pages[${pageIndex}][${reviewIndex}]`,
      );
      if (pageKeys.has(review.sourceKey)) {
        throw new ContractError(
          "A page contains a duplicate sourceKey",
          { sourceKey: review.sourceKey, pageIndex, reviewIndex },
        );
      }
      pageKeys.add(review.sourceKey);
      const previous = byKey.get(review.sourceKey);
      if (!previous) {
        byKey.set(review.sourceKey, review);
        continue;
      }
      duplicateOccurrences += 1;
      if (previous.recordHash !== review.recordHash) {
        throw new ContractError(
          "Review record changed during the same run",
          { sourceKey: review.sourceKey, pageIndex },
        );
      }
    }
  }

  if (byKey.size !== reportedCount) {
    throw new ContractError(
      `Unique review count ${byKey.size} does not match reported count ${reportedCount}`,
      {
        uniqueCount: byKey.size,
        reportedCount,
        duplicateOccurrences,
      },
    );
  }

  return {
    reviews: [...byKey.values()],
    uniqueCount: byKey.size,
    duplicateOccurrences,
  };
}

export function compareSnapshots(previousReviews, currentReviews) {
  const previous = uniqueSnapshot(previousReviews, "previousReviews");
  const current = uniqueSnapshot(currentReviews, "currentReviews");

  const inserted = [];
  const updated = [];
  const unchanged = [];
  const missing = [];

  for (const [key, review] of current) {
    const old = previous.get(key);
    if (!old) inserted.push(review);
    else if (old.recordHash !== review.recordHash) updated.push(review);
    else unchanged.push(review);
  }
  for (const [key, review] of previous) {
    if (!current.has(key)) missing.push(review);
  }

  return { inserted, updated, unchanged, missing };
}
