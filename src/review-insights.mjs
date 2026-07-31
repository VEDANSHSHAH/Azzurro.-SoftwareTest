export const REVIEW_INSIGHTS_VERSION = "1.0.1";

export const REVIEW_INSIGHT_TOPIC_DEFINITIONS = Object.freeze([
  Object.freeze({ topic: "cleanliness", label: "Cleanliness" }),
  Object.freeze({ topic: "check_in", label: "Check-in experience" }),
  Object.freeze({
    topic: "staff_reception",
    label: "Staff or receptionist behaviour",
  }),
  Object.freeze({ topic: "noise", label: "Noise" }),
  Object.freeze({ topic: "facilities", label: "Facilities" }),
  Object.freeze({ topic: "location", label: "Location" }),
  Object.freeze({ topic: "room_condition", label: "Room condition" }),
  Object.freeze({
    topic: "value_for_money",
    label: "Value for money",
  }),
]);

export const REVIEW_INSIGHT_TOPICS = Object.freeze(
  REVIEW_INSIGHT_TOPIC_DEFINITIONS.map(({ topic }) => topic),
);

const POSITIVE_SCORE_MINIMUM = 8;
const NEGATIVE_SCORE_CUTOFF = 7;
const SOURCE_FIELDS = Object.freeze([
  ["positiveText", "positive"],
  ["negativeText", "negative"],
]);
const COMMON_PLACEHOLDERS = new Set([
  "",
  "-",
  "--",
  ".",
  "n/a",
  "na",
  "nil",
  "none",
  "no comment",
  "no comments",
  "not applicable",
  "nothing to add",
]);
const NEGATIVE_PLACEHOLDERS = new Set([
  "all good",
  "cannot fault anything",
  "could not fault anything",
  "everything was fine",
  "no complaints",
  "nothing",
  "nothing bad",
  "nothing negative",
  "nothing to dislike",
]);
const NEGATIVE_PLACEHOLDER_PATTERNS = Object.freeze([
  /^(?:i had (?:a )?(?:excellent|good|great|wonderful) stay and )?(?:i )?(?:did not|didn't) experience any (?:issues?|problems?)(?: everything (?:met|exceeded) my expectations)?$/u,
  /^(?:there (?:was|were) )?no (?:issues?|problems?)(?: everything (?:was fine|met (?:my )?expectations))?$/u,
]);
const CLAUSE_BOUNDARY =
  /[.!?;:\n]|\b(?:although|but|however|though|yet)\b/giu;
const WORD = /[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu;
const NEGATION_WORDS = new Set([
  "barely",
  "cannot",
  "couldn't",
  "didn't",
  "hardly",
  "isn't",
  "lacking",
  "never",
  "no",
  "not",
  "wasn't",
  "weren't",
  "without",
  "wouldn't",
]);

export class ReviewInsightsContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReviewInsightsContractError";
    this.code = code;
    this.details = details;
  }
}

function rule(
  id,
  polarity,
  pattern,
  {
    negatable = true,
    negationInsideMatch = false,
  } = {},
) {
  return Object.freeze({
    id,
    polarity,
    pattern,
    negatable,
    negationInsideMatch,
  });
}

const TOPIC_RULES = Object.freeze({
  cleanliness: Object.freeze([
    rule(
      "cleanliness.positive_condition",
      "positive",
      String.raw`\b(?:clean|freshly cleaned|hygienic|immaculate|spotless|tidy)\b`,
    ),
    rule(
      "cleanliness.negative_condition",
      "negative",
      String.raw`\b(?:bad smell|bed ?bugs?|cockroaches?|dirty|dusty|filthy|grimy|mould|mouldy|mold|moldy|smelly|stained|stains?|unclean)\b`,
    ),
    rule(
      "cleanliness.source_anchor",
      "source",
      String.raw`\b(?:cleanliness|housekeeping|hygiene)\b`,
      { negatable: false },
    ),
  ]),
  check_in: Object.freeze([
    rule(
      "check_in.positive_experience",
      "positive",
      String.raw`\b(?:(?:easy|efficient|quick|seamless|simple|smooth)\s+check(?:-|\s)?in|check(?:-|\s)?in\s+(?:was\s+)?(?:easy|efficient|quick|seamless|simple|smooth))\b`,
    ),
    rule(
      "check_in.no_problem",
      "positive",
      String.raw`\bno problems?\s+check(?:ing)?(?:-|\s)?in\b`,
      { negatable: false },
    ),
    rule(
      "check_in.negative_experience",
      "negative",
      String.raw`\b(?:(?:chaotic|confusing|delayed|difficult|late|problematic|slow)\s+check(?:-|\s)?in|check(?:-|\s)?in\s+(?:delay|issue|problem)|locked out)\b`,
    ),
    rule(
      "check_in.failed_access",
      "negative",
      String.raw`\b(?:could not|couldn't)\s+check(?:-|\s)?in\b|\b(?:key(?:pad| code)?\s+(?:did not|didn't|would not|wouldn't)\s+work|no\s+check(?:-|\s)?in\s+instructions?)\b`,
      { negatable: false },
    ),
    rule(
      "check_in.source_anchor",
      "source",
      String.raw`\b(?:check(?:-|\s)?in|key code|keypad|self check(?:-|\s)?in)\b`,
      { negatable: false },
    ),
  ]),
  staff_reception: Object.freeze([
    rule(
      "staff_reception.negated_positive_behaviour",
      "positive",
      String.raw`\b(?:host|manager|reception|receptionist|staff)\s+(?:were?\s+|was\s+)?not\s+(?:attentive|friendly|helpful|kind|lovely|polite|professional|responsive|welcoming)\b`,
      { negationInsideMatch: true },
    ),
    rule(
      "staff_reception.negated_negative_behaviour",
      "negative",
      String.raw`\b(?:host|manager|reception|receptionist|staff)\s+(?:were?\s+|was\s+)?not\s+(?:aggressive|dismissive|impolite|rude|unfriendly|unhelpful|unprofessional|unresponsive)\b`,
      { negationInsideMatch: true },
    ),
    rule(
      "staff_reception.positive_behaviour",
      "positive",
      String.raw`\b(?:(?:attentive|friendly|helpful|kind|lovely|polite|professional|responsive|welcoming)\s+(?:host|manager|reception|receptionist|staff)|(?:host|manager|reception|receptionist|staff)\s+(?:were?\s+|was\s+)?(?:attentive|friendly|helpful|kind|lovely|polite|professional|responsive|welcoming))\b`,
    ),
    rule(
      "staff_reception.negative_behaviour",
      "negative",
      String.raw`\b(?:(?:aggressive|dismissive|impolite|rude|unfriendly|unhelpful|unprofessional|unresponsive)\s+(?:host|manager|reception|receptionist|staff)|(?:host|manager|reception|receptionist|staff)\s+(?:were?\s+|was\s+)?(?:aggressive|dismissive|impolite|rude|unfriendly|unhelpful|unprofessional|unresponsive))\b`,
    ),
    rule(
      "staff_reception.absent",
      "negative",
      String.raw`\b(?:absent|no|unavailable)\s+(?:reception|receptionist|staff)\b`,
      { negatable: false },
    ),
    rule(
      "staff_reception.source_anchor",
      "source",
      String.raw`\b(?:host|manager|reception|receptionist|staff)\b`,
      { negatable: false },
    ),
  ]),
  noise: Object.freeze([
    rule(
      "noise.positive_condition",
      "positive",
      String.raw`\b(?:peaceful|quiet|silent|soundproof|soundproofed)\b`,
    ),
    rule(
      "noise.negative_condition",
      "negative",
      String.raw`\b(?:construction noise|could not sleep|couldn't sleep|loud|music all night|noise|noisy|party noise|street noise|thin walls?|traffic noise)\b`,
    ),
  ]),
  facilities: Object.freeze([
    rule(
      "facilities.positive_quality",
      "positive",
      String.raw`\b(?:(?:excellent|good|great|modern|well[- ]maintained)\s+(?:amenities|facilities)|(?:fast|reliable)\s+(?:wi-?fi|wifi)|(?:wi-?fi|wifi)\s+(?:was\s+)?(?:fast|reliable|working|worked)|hot water|well[- ]equipped kitchen|working\s+(?:air conditioning|air[- ]?con|elevator|lift))\b`,
    ),
    rule(
      "facilities.negative_quality",
      "negative",
      String.raw`\b(?:(?:broken|outdated|poor)\s+(?:amenities|facilities)|(?:poor|slow|unreliable)\s+(?:wi-?fi|wifi)|(?:wi-?fi|wifi)\s+(?:did not|didn't|was not|wasn't)\s+work|broken\s+(?:elevator|lift)|cold shower)\b`,
      { negatable: false },
    ),
    rule(
      "facilities.missing",
      "negative",
      String.raw`\bno\s+(?:air conditioning|air[- ]?con|elevator|hot water|lift|wi-?fi|wifi)\b`,
      { negatable: false },
    ),
    rule(
      "facilities.source_anchor",
      "source",
      String.raw`\b(?:air conditioning|air[- ]?con|amenities|elevator|facilities|kitchen|laundry|lift|wi-?fi|wifi)\b`,
      { negatable: false },
    ),
  ]),
  location: Object.freeze([
    rule(
      "location.positive_access",
      "positive",
      String.raw`\b(?:central location|centrally located|close to|convenient location|easy access|excellent location|great location|near (?:a |the )?(?:bus|station|train)|perfect location|walking distance|well located)\b`,
    ),
    rule(
      "location.negative_access",
      "negative",
      String.raw`\b(?:bad location|difficult to find|dodgy neighbou?rhood|far from|hard to find|inconvenient location|isolated location|poor location|sketchy neighbou?rhood|unsafe area|unsafe location)\b`,
    ),
    rule(
      "location.source_anchor",
      "source",
      String.raw`\blocation\b`,
      { negatable: false },
    ),
  ]),
  room_condition: Object.freeze([
    rule(
      "room_condition.positive_condition",
      "positive",
      String.raw`\b(?:(?:comfortable|large|modern|spacious|well[- ]maintained)\s+(?:bed|room)|good mattress|room\s+(?:in|was in)\s+(?:excellent|good)\s+condition)\b`,
    ),
    rule(
      "room_condition.negative_condition",
      "negative",
      String.raw`\b(?:(?:cramped|damp|dated|damaged|run[- ]down|small|tiny|worn)\s+room|broken\s+(?:bed|window)|leaking?|no window|peeling paint|poor ventilation|sagging mattress|uncomfortable\s+(?:bed|mattress))\b`,
      { negatable: false },
    ),
    rule(
      "room_condition.source_anchor",
      "source",
      String.raw`\b(?:bathroom|bed|mattress|room condition|ventilation|window)\b`,
      { negatable: false },
    ),
  ]),
  value_for_money: Object.freeze([
    rule(
      "value_for_money.positive_value",
      "positive",
      String.raw`\b(?:affordable|budget[- ]friendly|excellent value|good value|great value|reasonably priced|value for money|worth (?:it|the money|the price))\b`,
    ),
    rule(
      "value_for_money.negative_value",
      "negative",
      String.raw`\b(?:bad value|expensive|hidden fees?|not worth (?:it|the money|the price)|overpriced|poor value|rip[- ]?off)\b`,
      { negatable: false },
    ),
    rule(
      "value_for_money.extra_charge",
      "negative",
      String.raw`\b(?:extra charges?|unexpected charges?)\b`,
      { negatable: false },
    ),
    rule(
      "value_for_money.source_anchor",
      "source",
      String.raw`\b(?:charges?|cheap|cost|fees?|price|value for money)\b`,
      { negatable: false },
    ),
  ]),
});

export const REVIEW_INSIGHTS_METHODOLOGY = Object.freeze({
  version: REVIEW_INSIGHTS_VERSION,
  topics: REVIEW_INSIGHT_TOPIC_DEFINITIONS,
  sentiment: Object.freeze({
    positiveScoreMinimum: POSITIVE_SCORE_MINIMUM,
    negativeScoreCutoffExclusive: NEGATIVE_SCORE_CUTOFF,
    sourceFields: Object.freeze(["positiveText", "negativeText"]),
  }),
  limitations: Object.freeze([
    "Rules classify only explicit configured phrases.",
    "Score alone never assigns an operational topic.",
    "Sarcasm, uncommon wording, and unsupported languages may be missed.",
    "A matched rule is evidence of a mention, not proof of root cause.",
  ]),
});

function assertReviewObject(review) {
  if (
    review === null ||
    typeof review !== "object" ||
    Array.isArray(review)
  ) {
    throw new ReviewInsightsContractError(
      "INVALID_REVIEW",
      "review must be an object",
    );
  }
}

function reviewScore(review) {
  const hasScore = Object.hasOwn(review, "score");
  const hasReviewScore = Object.hasOwn(review, "reviewScore");
  if (
    hasScore &&
    hasReviewScore &&
    review.score !== review.reviewScore
  ) {
    throw new ReviewInsightsContractError(
      "AMBIGUOUS_SCORE",
      "score and reviewScore must agree when both are supplied",
    );
  }
  const value = hasScore ? review.score : review.reviewScore;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 10
  ) {
    throw new ReviewInsightsContractError(
      "INVALID_SCORE",
      "score must be a finite number from 0 to 10",
    );
  }
  return value;
}

function validateIgnoredTitle(review) {
  if (
    Object.hasOwn(review, "title") &&
    review.title != null &&
    typeof review.title !== "string"
  ) {
    throw new ReviewInsightsContractError(
      "INVALID_TEXT",
      "title must be a string or null",
      { sourceField: "title" },
    );
  }
}

function textState(value, sourceField) {
  if (value == null) {
    return {
      sourceField,
      status: "empty",
      substantive: false,
      characterCount: 0,
      text: "",
    };
  }
  if (typeof value !== "string") {
    throw new ReviewInsightsContractError(
      "INVALID_TEXT",
      `${sourceField} must be a string or null`,
      { sourceField },
    );
  }
  const trimmed = value.trim();
  const normalized = trimmed
    .toLocaleLowerCase("en")
    .replace(/\s+/gu, " ")
    .replace(/^[.,!?;:]+|[.,!?;:]+$/gu, "")
    .trim();
  const placeholderSentence = normalized
    .replaceAll("\u2019", "'")
    .replace(/[.!?;:]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const placeholder =
    COMMON_PLACEHOLDERS.has(normalized) ||
    (sourceField === "negativeText" &&
      (NEGATIVE_PLACEHOLDERS.has(normalized) ||
        NEGATIVE_PLACEHOLDER_PATTERNS.some((pattern) =>
          pattern.test(placeholderSentence),
        )));
  return {
    sourceField,
    status:
      trimmed.length === 0
        ? "empty"
        : placeholder
          ? "placeholder"
          : "substantive",
    substantive: trimmed.length > 0 && !placeholder,
    characterCount: value.length,
    text: value,
  };
}

function scoreBand(score) {
  if (score >= POSITIVE_SCORE_MINIMUM) return "positive";
  if (score < NEGATIVE_SCORE_CUTOFF) return "negative";
  return "mixed";
}

function classifySentiment(score, positiveState, negativeState) {
  const band = scoreBand(score);
  let label;
  let ruleId;
  if (positiveState.substantive && negativeState.substantive) {
    label = "mixed";
    ruleId = "sentiment.both_text_channels";
  } else if (positiveState.substantive) {
    if (band === "negative") {
      label = "mixed";
      ruleId = "sentiment.positive_text_low_score";
    } else {
      label = "positive";
      ruleId = "sentiment.positive_text";
    }
  } else if (negativeState.substantive) {
    if (band === "positive") {
      label = "mixed";
      ruleId = "sentiment.negative_text_high_score";
    } else {
      label = "negative";
      ruleId = "sentiment.negative_text";
    }
  } else {
    label = band;
    ruleId = `sentiment.score_only_${band}`;
  }
  return {
    label,
    ruleId,
    evidence: {
      score,
      scoreBand: band,
      positiveText: {
        status: positiveState.status,
        substantive: positiveState.substantive,
        characterCount: positiveState.characterCount,
      },
      negativeText: {
        status: negativeState.status,
        substantive: negativeState.substantive,
        characterCount: negativeState.characterCount,
      },
    },
  };
}

const SENTIMENT_REASONS = Object.freeze({
  "sentiment.both_text_channels":
    "Both positive and negative text contain substantive comments.",
  "sentiment.positive_text_low_score":
    "Positive text is present, but the score is below 7.",
  "sentiment.positive_text":
    "Substantive positive text is present without substantive negative text.",
  "sentiment.negative_text_high_score":
    "Negative text is present, but the score is 8 or higher.",
  "sentiment.negative_text":
    "Substantive negative text is present without substantive positive text.",
  "sentiment.score_only_positive":
    "No substantive text is present and the score is 8 or higher.",
  "sentiment.score_only_mixed":
    "No substantive text is present and the score is from 7 to 7.9.",
  "sentiment.score_only_negative":
    "No substantive text is present and the score is below 7.",
});

function lastClause(text, end) {
  const prefix = text.slice(Math.max(0, end - 96), end);
  let boundaryEnd = 0;
  for (const match of prefix.matchAll(CLAUSE_BOUNDARY)) {
    boundaryEnd = match.index + match[0].length;
  }
  return prefix.slice(boundaryEnd);
}

function isNegated(text, matchStart) {
  const tokens = [...lastClause(text, matchStart).matchAll(WORD)]
    .map((match) =>
      match[0]
        .toLocaleLowerCase("en")
        .replaceAll("\u2019", "'"),
    )
    .slice(-4);
  if (
    tokens.length >= 2 &&
    tokens.at(-2) === "not" &&
    tokens.at(-1) === "only"
  ) {
    return false;
  }
  const negationCount = tokens.filter((token) =>
    NEGATION_WORDS.has(token),
  ).length;
  return negationCount % 2 === 1;
}

function matchContainsNegation(text) {
  const tokens = [...text.matchAll(WORD)].map((match) =>
    match[0]
      .toLocaleLowerCase("en")
      .replaceAll("\u2019", "'"),
  );
  return tokens.some((token) => NEGATION_WORDS.has(token));
}

function oppositePolarity(polarity) {
  return polarity === "positive" ? "negative" : "positive";
}

function matchRule(text, sourceField, sourcePolarity, configuredRule) {
  const expression = new RegExp(configuredRule.pattern, "giu");
  const searchableText = text.replaceAll("\u2019", "'");
  const matches = [];
  for (const match of searchableText.matchAll(expression)) {
    const start = match.index;
    const end = start + match[0].length;
    const matchedText = text.slice(start, end);
    const negated =
      configuredRule.negatable &&
      (isNegated(text, start) ||
        (configuredRule.negationInsideMatch &&
          matchContainsNegation(matchedText)));
    const basePolarity =
      configuredRule.polarity === "source"
        ? sourcePolarity
        : configuredRule.polarity;
    matches.push({
      ruleId: configuredRule.id,
      sourceField,
      sourcePolarity,
      polarity: negated
        ? oppositePolarity(basePolarity)
        : basePolarity,
      matchedText,
      start,
      end,
      negated,
    });
  }
  return matches;
}

function rangesOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function removeOverlappingFallbacks(matches) {
  const ordered = [...matches].sort(
    (left, right) =>
      left.sourceField.localeCompare(right.sourceField) ||
      left.start - right.start ||
      (right.end - right.start) - (left.end - left.start) ||
      left.ruleId.localeCompare(right.ruleId),
  );
  const accepted = [];
  for (const candidate of ordered) {
    const isFallback = candidate.ruleId.endsWith(".source_anchor");
    if (
      isFallback &&
      accepted.some(
        (existing) =>
          existing.sourceField === candidate.sourceField &&
          !existing.ruleId.endsWith(".source_anchor") &&
          rangesOverlap(existing, candidate),
      )
    ) {
      continue;
    }
    accepted.push(candidate);
  }
  return accepted.sort(
    (left, right) =>
      SOURCE_FIELDS.findIndex(([field]) => field === left.sourceField) -
        SOURCE_FIELDS.findIndex(([field]) => field === right.sourceField) ||
      left.start - right.start ||
      left.ruleId.localeCompare(right.ruleId),
  );
}

function topicSentiment(evidence) {
  const polarities = new Set(evidence.map((item) => item.polarity));
  if (polarities.size > 1) return "mixed";
  return evidence[0].polarity;
}

function classifyTopics(positiveState, negativeState) {
  const states = new Map([
    ["positiveText", positiveState],
    ["negativeText", negativeState],
  ]);
  const topics = [];
  for (const topic of REVIEW_INSIGHT_TOPICS) {
    const matches = [];
    for (const [sourceField, sourcePolarity] of SOURCE_FIELDS) {
      const state = states.get(sourceField);
      if (!state.substantive) continue;
      for (const configuredRule of TOPIC_RULES[topic]) {
        matches.push(
          ...matchRule(
            state.text,
            sourceField,
            sourcePolarity,
            configuredRule,
          ),
        );
      }
    }
    const evidence = removeOverlappingFallbacks(matches);
    if (evidence.length === 0) continue;
    topics.push({
      topic,
      sentiment: topicSentiment(evidence),
      evidence,
    });
  }
  return topics;
}

export function classifyReviewInsights(review) {
  assertReviewObject(review);
  validateIgnoredTitle(review);
  const score = reviewScore(review);
  const positiveState = textState(
    review.positiveText ?? null,
    "positiveText",
  );
  const negativeState = textState(
    review.negativeText ?? null,
    "negativeText",
  );
  const sentiment = classifySentiment(
    score,
    positiveState,
    negativeState,
  );
  return {
    classifierVersion: REVIEW_INSIGHTS_VERSION,
    sentiment: sentiment.label,
    sentimentReason: SENTIMENT_REASONS[sentiment.ruleId],
    sentimentRuleId: sentiment.ruleId,
    sentimentEvidence: sentiment.evidence,
    topics: classifyTopics(positiveState, negativeState).map(
      ({ topic, sentiment: polarity, evidence }) => ({
        topic,
        polarity,
        matchedTerms: [
          ...new Set(evidence.map(({ matchedText }) => matchedText)),
        ],
        evidenceFields: [
          ...new Set(evidence.map(({ sourceField }) => sourceField)),
        ],
        evidence,
      }),
    ),
  };
}

export function classifyReviewInsightBatch(reviews) {
  if (!Array.isArray(reviews)) {
    throw new ReviewInsightsContractError(
      "INVALID_REVIEW_BATCH",
      "reviews must be an array",
    );
  }
  return reviews.map((review) => classifyReviewInsights(review));
}
