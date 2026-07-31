import test from "node:test";
import assert from "node:assert/strict";

import {
  compareSnapshots,
  reconcileCompleteRun,
} from "../src/reconcile.mjs";

function review(id, hash = `hash-${id}`) {
  return {
    sourceKey: `hotel:${id}`,
    contentHash: `content-${id}`,
    recordHash: hash,
  };
}

for (const count of [0, 1, 9, 10, 11, 20, 21]) {
  test(`reconciles an exact ${count}-review fixture`, () => {
    const all = Array.from({ length: count }, (_, index) =>
      review(index),
    );
    const pages = [];
    for (let offset = 0; offset < count; offset += 10) {
      pages.push(all.slice(offset, offset + 10));
    }
    const result = reconcileCompleteRun({
      pages,
      reportedCount: count,
    });
    assert.equal(result.uniqueCount, count);
    assert.equal(result.duplicateOccurrences, 0);
  });
}

test("overlap is harmless only when the final unique count reconciles", () => {
  const page1 = Array.from({ length: 10 }, (_, index) =>
    review(index),
  );
  const page2 = [review(9), review(10)];
  const result = reconcileCompleteRun({
    pages: [page1, page2],
    reportedCount: 11,
  });
  assert.equal(result.uniqueCount, 11);
  assert.equal(result.duplicateOccurrences, 1);
});

test("count mismatch fails instead of publishing partial data", () => {
  assert.throws(
    () =>
      reconcileCompleteRun({
        pages: [[review(1)]],
        reportedCount: 2,
      }),
    /does not match reported count/,
  );
});

test("same source key changing during a run fails reconciliation", () => {
  assert.throws(
    () =>
      reconcileCompleteRun({
        pages: [[review(1, "old")], [review(1, "new")]],
        reportedCount: 1,
      }),
    /changed during the same run/,
  );
});

test("same content with changed retained metadata fails reconciliation", () => {
  const first = review(1, "record-old");
  const changed = {
    ...review(1, "record-new"),
    contentHash: first.contentHash,
  };
  assert.throws(
    () =>
      reconcileCompleteRun({
        pages: [[first], [changed]],
        reportedCount: 1,
      }),
    /record changed during the same run/,
  );
});

test("rejects duplicate identities inside one source page", () => {
  assert.throws(
    () =>
      reconcileCompleteRun({
        pages: [[review(1), review(1)]],
        reportedCount: 1,
      }),
    /page contains a duplicate sourceKey/,
  );
});

test("requires record hashes rather than weaker content-only hashes", () => {
  assert.throws(
    () =>
      reconcileCompleteRun({
        pages: [[{ sourceKey: "hotel:1", contentHash: "content" }]],
        reportedCount: 1,
      }),
    /recordHash/,
  );
});

test("snapshot comparison separates inserts, edits, unchanged and missing", () => {
  const before = [
    review(1, "same"),
    review(2, "old"),
    review(3, "gone"),
  ];
  const after = [
    review(1, "same"),
    review(2, "new"),
    review(4, "insert"),
  ];
  const result = compareSnapshots(before, after);
  assert.deepEqual(
    {
      inserted: result.inserted.length,
      updated: result.updated.length,
      unchanged: result.unchanged.length,
      missing: result.missing.length,
    },
    { inserted: 1, updated: 1, unchanged: 1, missing: 1 },
  );
});

test("snapshot comparison uses record hash for metadata-only edits", () => {
  const before = review(1, "old-record");
  const after = {
    ...review(1, "new-record"),
    contentHash: before.contentHash,
  };
  const result = compareSnapshots([before], [after]);
  assert.equal(result.updated.length, 1);
  assert.equal(result.unchanged.length, 0);
});

test("snapshot comparison rejects duplicates before indexing", () => {
  assert.throws(
    () => compareSnapshots([review(1), review(1)], []),
    /previousReviews contains a duplicate sourceKey/,
  );
  assert.throws(
    () => compareSnapshots([], [review(1), review(1)]),
    /currentReviews contains a duplicate sourceKey/,
  );
});

test("snapshot comparison validates input arrays and rows", () => {
  assert.throws(
    () => compareSnapshots(null, []),
    /previousReviews must be an array/,
  );
  assert.throws(
    () =>
      compareSnapshots(
        [{ sourceKey: "hotel:1", contentHash: "content" }],
        [],
      ),
    /recordHash/,
  );
});
