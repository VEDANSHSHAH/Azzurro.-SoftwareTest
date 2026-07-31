import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REVIEW_INSIGHTS_METHODOLOGY,
  REVIEW_INSIGHTS_VERSION,
  REVIEW_INSIGHT_TOPIC_DEFINITIONS,
  REVIEW_INSIGHT_TOPICS,
  ReviewInsightsContractError,
  classifyReviewInsightBatch,
  classifyReviewInsights,
} from "../src/review-insights.mjs";

const fixturePath = new URL(
  "./fixtures/review-insights/labelled-cases.json",
  import.meta.url,
);
const labelledCases = JSON.parse(
  await readFile(fixturePath, "utf8"),
);

function topicMap(result) {
  return Object.fromEntries(
    result.topics.map(({ topic, polarity }) => [topic, polarity]),
  );
}

test("exports one versioned definition for each required topic", () => {
  assert.equal(REVIEW_INSIGHTS_VERSION, "1.0.1");
  assert.deepEqual(REVIEW_INSIGHT_TOPICS, [
    "cleanliness",
    "check_in",
    "staff_reception",
    "noise",
    "facilities",
    "location",
    "room_condition",
    "value_for_money",
  ]);
  assert.deepEqual(
    REVIEW_INSIGHT_TOPIC_DEFINITIONS.map(({ topic }) => topic),
    REVIEW_INSIGHT_TOPICS,
  );
  assert.deepEqual(
    REVIEW_INSIGHT_TOPIC_DEFINITIONS.map(({ label }) => label),
    [
      "Cleanliness",
      "Check-in experience",
      "Staff or receptionist behaviour",
      "Noise",
      "Facilities",
      "Location",
      "Room condition",
      "Value for money",
    ],
  );
  assert.equal(
    REVIEW_INSIGHTS_METHODOLOGY.version,
    REVIEW_INSIGHTS_VERSION,
  );
  assert.equal(
    REVIEW_INSIGHTS_METHODOLOGY.sentiment.positiveScoreMinimum,
    8,
  );
  assert.equal(
    REVIEW_INSIGHTS_METHODOLOGY.sentiment
      .negativeScoreCutoffExclusive,
    7,
  );
});

test("exposes the stable integration result shape", () => {
  const result = classifyReviewInsights({
    score: 9,
    title: "A source title",
    positiveText: "Friendly staff.",
    negativeText: null,
  });
  assert.deepEqual(Object.keys(result), [
    "classifierVersion",
    "sentiment",
    "sentimentReason",
    "sentimentRuleId",
    "sentimentEvidence",
    "topics",
  ]);
  assert.deepEqual(Object.keys(result.topics[0]), [
    "topic",
    "polarity",
    "matchedTerms",
    "evidenceFields",
    "evidence",
  ]);
  assert.equal(result.sentiment, "positive");
  assert.equal(result.topics[0].topic, "staff_reception");
});

test("labelled offline fixtures produce exact sentiments and topics", () => {
  for (const fixture of labelledCases) {
    const result = classifyReviewInsights(fixture.input);
    assert.equal(
      result.classifierVersion,
      REVIEW_INSIGHTS_VERSION,
      fixture.id,
    );
    assert.equal(
      result.sentiment,
      fixture.expectedSentiment,
      fixture.id,
    );
    assert.deepEqual(
      topicMap(result),
      fixture.expectedTopics,
      fixture.id,
    );
    assert.equal(
      new Set(result.topics.map(({ topic }) => topic)).size,
      result.topics.length,
      `${fixture.id}: topic assigned more than once`,
    );
  }
});

test("every configured topic has positive and negative fixture coverage", () => {
  const coverage = new Map(
    REVIEW_INSIGHT_TOPICS.map((topic) => [topic, new Set()]),
  );
  for (const fixture of labelledCases) {
    for (const [topic, polarity] of Object.entries(
      fixture.expectedTopics,
    )) {
      if (polarity === "mixed") {
        coverage.get(topic).add("positive");
        coverage.get(topic).add("negative");
      } else {
        coverage.get(topic).add(polarity);
      }
    }
  }
  for (const [topic, polarities] of coverage) {
    assert.deepEqual(
      [...polarities].sort(),
      ["negative", "positive"],
      topic,
    );
  }
});

test("assigned topics retain explainable match evidence", () => {
  for (const fixture of labelledCases) {
    const result = classifyReviewInsights(fixture.input);
    assert.equal(typeof result.sentimentReason, "string", fixture.id);
    assert.ok(result.sentimentReason.length > 0, fixture.id);
    assert.match(result.sentimentRuleId, /^sentiment\./, fixture.id);
    assert.equal(
      result.sentimentEvidence.score,
      fixture.input.score,
      fixture.id,
    );

    for (const topic of result.topics) {
      assert.ok(REVIEW_INSIGHT_TOPICS.includes(topic.topic), fixture.id);
      assert.ok(
        ["positive", "mixed", "negative"].includes(topic.polarity),
        fixture.id,
      );
      assert.ok(topic.evidence.length > 0, fixture.id);
      assert.deepEqual(
        topic.matchedTerms,
        [...new Set(topic.evidence.map(({ matchedText }) => matchedText))],
        fixture.id,
      );
      assert.deepEqual(
        topic.evidenceFields,
        [...new Set(topic.evidence.map(({ sourceField }) => sourceField))],
        fixture.id,
      );

      for (const evidence of topic.evidence) {
        assert.ok(
          ["positiveText", "negativeText"].includes(
            evidence.sourceField,
          ),
          fixture.id,
        );
        assert.match(evidence.ruleId, /^[a-z_]+\./, fixture.id);
        assert.ok(
          Number.isSafeInteger(evidence.start) &&
            Number.isSafeInteger(evidence.end) &&
            evidence.start >= 0 &&
            evidence.end > evidence.start,
          fixture.id,
        );
        const source = fixture.input[evidence.sourceField];
        assert.equal(
          source.slice(evidence.start, evidence.end),
          evidence.matchedText,
          fixture.id,
        );
        assert.equal(typeof evidence.negated, "boolean", fixture.id);
      }
    }
  }
});

test("score-only sentiment boundaries are explicit and topic-free", () => {
  const cases = [
    [0, "negative"],
    [6.9, "negative"],
    [7, "mixed"],
    [7.9, "mixed"],
    [8, "positive"],
    [10, "positive"],
  ];
  for (const [score, expected] of cases) {
    const result = classifyReviewInsights({
      score,
      positiveText: null,
      negativeText: null,
    });
    assert.equal(result.sentiment, expected, String(score));
    assert.deepEqual(result.topics, [], String(score));
    assert.equal(
      result.sentimentRuleId,
      `sentiment.score_only_${expected}`,
    );
  }
});

test("separated text channels modify sentiment without hiding score", () => {
  const cases = [
    {
      score: 9,
      positiveText: "Good",
      negativeText: "Bad",
      expected: "mixed",
      rule: "sentiment.both_text_channels",
    },
    {
      score: 9,
      positiveText: null,
      negativeText: "A real complaint",
      expected: "mixed",
      rule: "sentiment.negative_text_high_score",
    },
    {
      score: 7.5,
      positiveText: "Good",
      negativeText: null,
      expected: "positive",
      rule: "sentiment.positive_text",
    },
    {
      score: 7.5,
      positiveText: null,
      negativeText: "Bad",
      expected: "negative",
      rule: "sentiment.negative_text",
    },
    {
      score: 6.5,
      positiveText: "Good",
      negativeText: null,
      expected: "mixed",
      rule: "sentiment.positive_text_low_score",
    },
  ];
  for (const item of cases) {
    const result = classifyReviewInsights(item);
    assert.equal(result.sentiment, item.expected);
    assert.equal(result.sentimentRuleId, item.rule);
    assert.equal(result.sentimentEvidence.score, item.score);
  }
});

test("empty and non-complaint phrases do not create negative text", () => {
  for (const negativeText of [
    null,
    "",
    "   ",
    "-",
    "N/A",
    "None",
    "Nothing",
    "Nothing to dislike.",
    "No complaints!",
    "Everything was fine.",
    "All good.",
    "I had a great stay and didn\u2019t experience any issues. Everything met my expectations.",
  ]) {
    const result = classifyReviewInsights({
      score: 10,
      positiveText: null,
      negativeText,
    });
    assert.equal(result.sentiment, "positive", String(negativeText));
    assert.deepEqual(result.topics, [], String(negativeText));
    assert.ok(
      ["empty", "placeholder"].includes(
        result.sentimentEvidence.negativeText.status,
      ),
      String(negativeText),
    );
  }
});

test("negation flips only the matched phrase polarity", () => {
  const cases = [
    {
      text: "The room was not clean.",
      topic: "cleanliness",
      expected: "negative",
      term: "clean",
    },
    {
      text: "The room was not dirty.",
      topic: "cleanliness",
      expected: "positive",
      term: "dirty",
    },
    {
      text: "There was no noise.",
      topic: "noise",
      expected: "positive",
      term: "noise",
    },
    {
      text: "The staff were not rude.",
      topic: "staff_reception",
      expected: "positive",
      term: "staff were not rude",
    },
    {
      text: "The room wasn\u2019t dirty.",
      topic: "cleanliness",
      expected: "positive",
      term: "dirty",
    },
  ];
  for (const item of cases) {
    const result = classifyReviewInsights({
      score: 8,
      positiveText: item.text,
      negativeText: null,
    });
    const topic = result.topics.find(
      ({ topic: key }) => key === item.topic,
    );
    assert.equal(topic.polarity, item.expected, item.text);
    const evidence = topic.evidence.find(({ matchedText }) =>
      matchedText.toLocaleLowerCase("en").includes(item.term),
    );
    assert.equal(evidence.negated, true, item.text);
  }
});

test("curly apostrophes preserve exact evidence offsets", () => {
  const text = "We couldn\u2019t sleep because of the street noise.";
  const result = classifyReviewInsights({
    score: 4,
    positiveText: null,
    negativeText: text,
  });
  const noise = result.topics.find(({ topic }) => topic === "noise");
  assert.equal(noise.polarity, "negative");
  const evidence = noise.evidence.find(
    ({ ruleId }) => ruleId === "noise.negative_condition",
  );
  assert.equal(evidence.matchedText, "couldn\u2019t sleep");
  assert.equal(
    text.slice(evidence.start, evidence.end),
    evidence.matchedText,
  );
});

test("contrast boundaries and not-only wording keep local negation scope", () => {
  const contrast = classifyReviewInsights({
    score: 7,
    positiveText: "The room was not clean, but clean after housekeeping.",
    negativeText: null,
  });
  const cleanliness = contrast.topics.find(
    ({ topic }) => topic === "cleanliness",
  );
  assert.equal(cleanliness.polarity, "mixed");
  assert.deepEqual(
    cleanliness.evidence.map(({ polarity, negated }) => ({
      polarity,
      negated,
    })),
    [
      { polarity: "negative", negated: true },
      { polarity: "positive", negated: false },
      { polarity: "positive", negated: false },
    ],
  );

  const notOnly = classifyReviewInsights({
    score: 9,
    positiveText: "It was not only clean but also quiet.",
    negativeText: null,
  });
  assert.equal(topicMap(notOnly).cleanliness, "positive");
  assert.equal(topicMap(notOnly).noise, "positive");
});

test("multi-label reviews assign each topic once", () => {
  const result = classifyReviewInsights({
    score: 7.5,
    positiveText:
      "Spotless, quiet room with friendly staff in a great location.",
    negativeText:
      "Slow Wi-Fi, difficult check-in and an overpriced small room.",
  });
  assert.deepEqual(
    result.topics.map(({ topic }) => topic),
    [
      "cleanliness",
      "check_in",
      "staff_reception",
      "noise",
      "facilities",
      "location",
      "room_condition",
      "value_for_money",
    ],
  );
  assert.equal(new Set(result.topics.map(({ topic }) => topic)).size, 8);
});

test("score, title and unrelated words never invent a topic", () => {
  const cases = [
    {
      score: 9,
      title: "Dirty room",
      positiveText: null,
      negativeText: null,
    },
    {
      score: 8,
      positiveText: "Exactly as described.",
      negativeText: null,
    },
    {
      score: 8,
      positiveText:
        "A priceless Staffordshire memory in a locationless story.",
      negativeText: null,
    },
    {
      score: 9,
      positiveText: "Muy bueno.",
      negativeText: null,
    },
  ];
  for (const input of cases) {
    assert.deepEqual(classifyReviewInsights(input).topics, []);
  }
});

test("No elevator is facilities evidence and never a noise match", () => {
  const result = classifyReviewInsights({
    score: 5,
    positiveText: null,
    negativeText: "No elevator.",
  });
  assert.deepEqual(topicMap(result), {
    facilities: "negative",
  });
});

test("repeated terms retain evidence but not duplicate topic labels", () => {
  const input = {
    score: 9,
    positiveText: "Clean, clean and spotless.",
    negativeText: null,
  };
  const result = classifyReviewInsights(input);
  assert.equal(result.topics.length, 1);
  assert.equal(result.topics[0].topic, "cleanliness");
  assert.equal(result.topics[0].evidence.length, 3);
});

test("classification is deterministic and never mutates input", () => {
  const input = {
    score: 7.5,
    title: "A title",
    positiveText: "Friendly staff and a quiet room.",
    negativeText: "Slow Wi-Fi.",
    extraSourceFact: { retained: true },
  };
  const before = structuredClone(input);
  const first = classifyReviewInsights(input);
  const second = classifyReviewInsights(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});

test("reviewScore alias and batch classification are stable", () => {
  const reviews = [
    {
      reviewScore: 9,
      positiveText: "Great location.",
      negativeText: null,
    },
    {
      score: 5,
      reviewScore: 5,
      positiveText: null,
      negativeText: "Dirty.",
    },
  ];
  assert.deepEqual(
    classifyReviewInsightBatch(reviews),
    reviews.map((review) => classifyReviewInsights(review)),
  );
});

test("invalid insight inputs fail with typed contract errors", () => {
  const invalid = [
    null,
    [],
    {},
    { score: -1 },
    { score: 11 },
    { score: Number.NaN },
    { score: "9" },
    { score: 9, reviewScore: 8 },
    { score: 9, positiveText: 4 },
    { score: 9, negativeText: false },
    { score: 9, title: 4 },
  ];
  for (const input of invalid) {
    assert.throws(
      () => classifyReviewInsights(input),
      ReviewInsightsContractError,
    );
  }
  assert.throws(
    () => classifyReviewInsightBatch({}),
    (error) =>
      error instanceof ReviewInsightsContractError &&
      error.code === "INVALID_REVIEW_BATCH",
  );
});
