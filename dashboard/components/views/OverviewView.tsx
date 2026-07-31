import {
  ArrowRight,
  Building2,
  CircleAlert,
  MessageCircleReply,
  MessageSquareText,
  Star,
  ThumbsDown,
  TrendingUp,
} from "lucide-react";
import type { DashboardPayload, DashboardView } from "../../lib/types";
import {
  formatCount,
  formatDelta,
  formatPercent,
  formatScore,
} from "../../lib/format";
import { PropertyComparisonChart } from "../charts/PropertyComparisonChart";
import { RatingTrendChart } from "../charts/RatingTrendChart";
import { KpiCard } from "../ui/KpiCard";
import { ScoreBadge } from "../ui/ScoreBadge";
import { SectionCard } from "../ui/SectionCard";

export function OverviewView({
  data,
  onNavigate,
}: {
  data: DashboardPayload;
  onNavigate: (view: DashboardView) => void;
}) {
  const { overview } = data;
  const customPeriod = overview.periodKind === "custom";
  const periodLabel = customPeriod ? "selected period" : "week";
  const highestRiskTopic = [...data.topics]
    .filter((topic) => topic.negativeMentionCount > 0)
    .sort(
      (left, right) =>
        (right.negativeMentionShare ?? -1) -
        (left.negativeMentionShare ?? -1),
    )[0];
  return (
    <div className="view-stack">
      <section aria-label="Weekly key metrics" className="kpi-grid">
        <KpiCard
          deltaDirection={overview.averageRating.direction}
          deltaText={formatDelta(overview.averageRating.delta)}
          icon={<Star aria-hidden="true" size={20} />}
          label={customPeriod ? "Selected period rating" : "Current week rating"}
          supportingText={`${formatCount(
            overview.currentWeek.reviewCount,
          )} reviews · previous ${customPeriod ? "period" : "week"} ${formatScore(
            overview.averageRating.previous,
          )}`}
          tone="navy"
          value={formatScore(overview.averageRating.current, 2)}
        />
        <KpiCard
          deltaDirection={overview.reviewVolume.direction}
          deltaText={formatDelta(overview.reviewVolume.delta, {
            suffix: " reviews",
            digits: 0,
          })}
          icon={<MessageSquareText aria-hidden="true" size={20} />}
          label="Review volume"
          supportingText={`Previous ${customPeriod ? "period" : "week"} ${formatCount(
            overview.previousWeek.reviewCount,
          )}`}
          tone="pink"
          value={formatCount(overview.currentWeek.reviewCount)}
        />
        <KpiCard
          deltaDirection={overview.negativeShare.direction}
          deltaText={formatDelta(overview.negativeShare.delta, {
            suffix: " pts",
          })}
          goodDirection="down"
          icon={<ThumbsDown aria-hidden="true" size={20} />}
          label="Negative review share"
          supportingText={`${formatCount(
            overview.currentWeek.negativeCount,
          )} negative ${
            overview.currentWeek.negativeCount === 1 ? "review" : "reviews"
          } in the ${periodLabel}`}
          tone="amber"
          value={formatPercent(overview.negativeShare.current)}
        />
        <KpiCard
          deltaDirection={overview.responseRate.direction}
          deltaText={formatDelta(overview.responseRate.delta, {
            suffix: " pts",
          })}
          icon={<MessageCircleReply aria-hidden="true" size={20} />}
          label="Partner response rate"
          supportingText={`${formatCount(
            overview.currentWeek.responseCount,
          )} reviews received a reply in the ${periodLabel}`}
          tone="green"
          value={formatPercent(overview.responseRate.current)}
        />
      </section>

      <div className="content-grid content-grid--wide">
        <SectionCard
          action={
            <button
              className="text-button"
              onClick={() => onNavigate("trends")}
              type="button"
            >
              Explore trends
              <ArrowRight aria-hidden="true" size={15} />
            </button>
          }
          className="span-2"
          description="Average Booking.com score by Sydney week. Gaps mean no reviews were published."
          title="Rating movement"
        >
          <RatingTrendChart data={data.trends} />
        </SectionCard>

        <SectionCard
          action={
            <button
              className="text-button"
              onClick={() => onNavigate("insights")}
              type="button"
            >
              All insights
              <ArrowRight aria-hidden="true" size={15} />
            </button>
          }
          description={`Highest topic share among reviews containing negative feedback in the ${periodLabel}.`}
          title="Operational focus"
        >
          {highestRiskTopic ? (
            <div className="focus-topic">
              <div className="focus-topic__score">
                <span>{formatPercent(highestRiskTopic.negativeMentionShare)}</span>
                <small>of negative feedback</small>
              </div>
              <div>
                <span className="topic-pill topic-pill--negative">
                  <CircleAlert aria-hidden="true" size={14} />
                  {highestRiskTopic.label}
                </span>
                <h3>
                  {highestRiskTopic.trend === "worsening"
                    ? `Needs attention in the ${periodLabel}`
                    : highestRiskTopic.trend === "improving"
                      ? "Issue is easing"
                      : "Monitor this topic"}
                </h3>
                <p>{highestRiskTopic.description}</p>
                <dl className="focus-topic__facts">
                  <div>
                    <dt>Mentions</dt>
                    <dd>{highestRiskTopic.negativeMentionCount}</dd>
                  </div>
                  <div>
                    <dt>Change</dt>
                    <dd>
                      {formatDelta(highestRiskTopic.shareDelta, {
                        suffix: " pts",
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt>Leading property</dt>
                    <dd>{highestRiskTopic.leadingPropertyName ?? "—"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : (
            <div className="no-signal">
              <span>
                <CircleAlert aria-hidden="true" size={19} />
              </span>
              <div>
                <h3>No recurring issue was detected</h3>
                <p>
                  {formatCount(
                    overview.currentWeek.negativeFeedbackCount,
                  )}{" "}
                  {overview.currentWeek.negativeFeedbackCount === 1
                    ? "review contained"
                    : "reviews contained"}{" "}
                  negative feedback, but no configured phrase rule supplied
                  enough evidence for an operational topic. No label was forced.
                </p>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="content-grid content-grid--equal">
        <SectionCard
          action={
            <button
              className="text-button"
              onClick={() => onNavigate("properties")}
              type="button"
            >
              Compare properties
              <ArrowRight aria-hidden="true" size={15} />
            </button>
          }
          description={`The ${periodLabel} compared with the immediately preceding period.`}
          title="Property momentum"
        >
          <PropertyComparisonChart data={data.properties} />
        </SectionCard>

        <SectionCard
          action={
            <button
              className="text-button"
              onClick={() => onNavigate("reviews")}
              type="button"
            >
              Open review feed
              <ArrowRight aria-hidden="true" size={15} />
            </button>
          }
          description="Latest reviews from the published portfolio. Use the review explorer for detailed filtering."
          title="Recent guest feedback"
        >
          <div className="mini-review-list">
            {overview.recentReviews.map((review) => (
              <article className="mini-review" key={review.reviewId}>
                <ScoreBadge score={review.score} size="small" />
                <div className="mini-review__body">
                  <div>
                    <strong>
                      {review.title ||
                        review.positiveText ||
                        review.negativeText ||
                        "Score-only review"}
                    </strong>
                    <span>{review.propertyName}</span>
                  </div>
                  <p>
                    {review.negativeText ||
                      review.positiveText ||
                      "No written comment was supplied."}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </SectionCard>
      </div>

      {overview.attentionItems.length > 0 ? (
        <SectionCard
          description="Automatically prioritised from score movement, negative-feedback topics, and data quality."
          eyebrow="Action queue"
          title="What operations should look at next"
        >
          <div className="attention-list">
            {overview.attentionItems.map((item) => (
              <article
                className={`attention-item attention-item--${item.severity}`}
                key={item.id}
              >
                <span className="attention-item__icon">
                  {item.propertyKey ? (
                    <Building2 aria-hidden="true" size={18} />
                  ) : (
                    <TrendingUp aria-hidden="true" size={18} />
                  )}
                </span>
                <div>
                  <div className="attention-item__heading">
                    <strong>{item.title}</strong>
                    <span>{item.severity} priority</span>
                  </div>
                  <p>{item.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
