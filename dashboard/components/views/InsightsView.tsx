"use client";

import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  BrainCircuit,
  Minus,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DashboardPayload, TopicKey } from "../../lib/types";
import {
  formatCount,
  formatDelta,
  formatPercent,
} from "../../lib/format";
import { TopicRankingChart } from "../charts/TopicRankingChart";
import { EmptyState } from "../ui/States";
import { SectionCard } from "../ui/SectionCard";

const TOPIC_ACCENTS: Record<TopicKey, string> = {
  cleanliness: "#14866d",
  check_in: "#4f6fb5",
  staff_reception: "#7b5caf",
  noise: "#d36b55",
  facilities: "#3f87a6",
  location: "#b98622",
  room_condition: "#d34f78",
  value_for_money: "#526f58",
};

export function InsightsView({
  data,
  onOpenReviews,
}: {
  data: DashboardPayload;
  onOpenReviews: (
    topic?: TopicKey,
    period?: "current-period",
  ) => void;
}) {
  const ranked = useMemo(
    () =>
      [...data.topics].sort(
        (left, right) =>
          (right.negativeMentionShare ?? -1) -
          (left.negativeMentionShare ?? -1),
      ),
    [data.topics],
  );
  const [selectedTopic, setSelectedTopic] = useState<TopicKey | null>(
    ranked[0]?.topic ?? null,
  );
  const selected =
    data.topics.find((topic) => topic.topic === selectedTopic) ?? ranked[0];
  const currentSignal = ranked.find(
    (topic) =>
      topic.negativeMentionCount > 0 &&
      (topic.negativeMentionShare ?? 0) > 0,
  );
  const customPeriod = data.overview.periodKind === "custom";
  const periodLabel = customPeriod ? "selected period" : "week";

  return (
    <div className="view-stack">
      {currentSignal ? (
        <section className="insight-hero">
          <div>
            <p className="eyebrow">
              {customPeriod
                ? "Selected period’s clearest signal"
                : "This week’s clearest signal"}
            </p>
            <h2>
              {formatPercent(currentSignal.negativeMentionShare)} of reviews
              with negative feedback in the {periodLabel} mentioned{" "}
              <span>{currentSignal.label.toLowerCase()}</span>.
            </h2>
            <p>
              Based on {formatCount(currentSignal.negativeMentionCount)} matched
              reviews with negative feedback across{" "}
              {formatCount(currentSignal.affectedPropertyCount)} properties. A
              review may belong to more than one topic.
            </p>
          </div>
          <button
            className="button button--light"
            onClick={() =>
              onOpenReviews(currentSignal.topic, "current-period")
            }
            type="button"
          >
            Read matching reviews
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </section>
      ) : (
        <section className="insight-hero insight-hero--clear">
          <div>
            <p className="eyebrow">
              {customPeriod
                ? "Selected period’s clearest signal"
                : "This week’s clearest signal"}
            </p>
            <h2>
              No recurring negative topic was detected in the {periodLabel}.
            </h2>
            <p>
              {formatCount(
                data.overview.currentWeek.negativeFeedbackCount,
              )}{" "}
              {data.overview.currentWeek.negativeFeedbackCount === 1
                ? "review contained"
                : "reviews contained"}{" "}
              negative feedback, but none had enough configured phrase evidence
              for a topic match. The classifier did not force a label.
            </p>
          </div>
          <button
            className="button button--light"
            onClick={() => onOpenReviews(undefined, "current-period")}
            type="button"
          >
            Browse {customPeriod ? "period" : "this week’s"} feedback
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </section>
      )}

      <div className="content-grid content-grid--insights">
        <SectionCard
          className="span-2"
          description="Share of reviews containing negative feedback that mention each operational topic."
          title="Negative topic concentration"
        >
          {currentSignal ? (
            <TopicRankingChart data={data.topics} />
          ) : (
            <EmptyState
              compact
              detail={
                data.overview.currentWeek.negativeFeedbackCount === 0
                  ? "No reviews contained negative feedback in the active period."
                  : `${formatCount(
                      data.overview.currentWeek.negativeFeedbackCount,
                    )} ${
                      data.overview.currentWeek.negativeFeedbackCount === 1
                        ? "review contained"
                        : "reviews contained"
                    } negative feedback, but none matched the configured operational phrases. Score-only and unsupported-language feedback remains unclassified.`
              }
              title="No negative topic matches in this period"
            />
          )}
        </SectionCard>

        <SectionCard
          description="Select any topic to see its definition, movement, and leading property."
          title="Topic detail"
        >
          {selected ? (
            <div className="topic-detail">
              <div className="topic-detail__heading">
                <span
                  className="topic-detail__swatch"
                  style={{ backgroundColor: TOPIC_ACCENTS[selected.topic] }}
                />
                <div>
                  <strong>{selected.label}</strong>
                  <p>{selected.description}</p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Negative review share</dt>
                  <dd>{formatPercent(selected.negativeMentionShare)}</dd>
                </div>
                <div>
                  <dt>Previous period</dt>
                  <dd>{formatPercent(selected.previousNegativeMentionShare)}</dd>
                </div>
                <div>
                  <dt>Change</dt>
                  <dd>{formatDelta(selected.shareDelta, { suffix: " pts" })}</dd>
                </div>
                <div>
                  <dt>All-time topic matches</dt>
                  <dd>{formatCount(selected.allMentionCount)}</dd>
                </div>
                <div>
                  <dt>Leading property</dt>
                  <dd>{selected.leadingPropertyName ?? "—"}</dd>
                </div>
              </dl>
              <button
                className="button button--secondary button--full"
                onClick={() => onOpenReviews(selected.topic)}
                type="button"
              >
                <Search aria-hidden="true" size={15} />
                View {selected.label.toLowerCase()} reviews
              </button>
            </div>
          ) : (
            <p className="muted-copy">No topic matches in this period.</p>
          )}
        </SectionCard>
      </div>

      <section aria-label="Operational topic cards" className="topic-card-grid">
        {data.topics.map((topic) => {
          const TrendIcon =
            topic.trend === "improving"
              ? ArrowDownRight
              : topic.trend === "worsening"
                ? ArrowUpRight
                : Minus;
          return (
            <button
              className={`topic-card ${
                selectedTopic === topic.topic ? "is-selected" : ""
              }`}
              key={topic.topic}
              onClick={() => setSelectedTopic(topic.topic)}
              type="button"
            >
              <div className="topic-card__top">
                <span
                  className="topic-card__marker"
                  style={{ backgroundColor: TOPIC_ACCENTS[topic.topic] }}
                />
                <span
                  className={`trend-label trend-label--${topic.trend}`}
                >
                  <TrendIcon aria-hidden="true" size={14} />
                  {topic.trend}
                </span>
              </div>
              <strong>{topic.label}</strong>
              <div className="topic-card__metric">
                <span>{formatPercent(topic.negativeMentionShare)}</span>
                <small>of negative feedback</small>
              </div>
              <p>
                {formatCount(topic.negativeMentionCount)} negative mentions ·{" "}
                {formatDelta(topic.shareDelta, { suffix: " pts" })}
              </p>
            </button>
          );
        })}
      </section>

      <SectionCard
        action={
          <span className="version-chip">
            {data.quality.classifierVersion}
          </span>
        }
        className="method-card"
        description="Designed to be auditable, deterministic, and honest about uncertainty."
        title="How these insights are produced"
      >
        <div className="method-grid">
          <article>
            <span>
              <BookOpenCheck aria-hidden="true" size={20} />
            </span>
            <div>
              <strong>Source facts stay unchanged</strong>
              <p>
                Score, date, positive text, negative text, and property remain
                separate from every derived label.
              </p>
            </div>
          </article>
          <article>
            <span>
              <BrainCircuit aria-hidden="true" size={20} />
            </span>
            <div>
              <strong>Explainable multi-label rules</strong>
              <p>
                A review can match several topics. Stored evidence shows which
                text field and phrase caused each match.
              </p>
            </div>
          </article>
          <article>
            <span>
              <Search aria-hidden="true" size={20} />
            </span>
            <div>
              <strong>No forced classification</strong>
              <p>
                Score-only or unmatched comments remain unclassified instead of
                being assigned a topic without evidence.
              </p>
            </div>
          </article>
        </div>
      </SectionCard>
    </div>
  );
}
