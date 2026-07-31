import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  MessageSquareMore,
  Minus,
} from "lucide-react";
import type { DashboardPayload } from "../../lib/types";
import {
  formatCount,
  formatPercent,
  formatScore,
} from "../../lib/format";
import { RatingTrendChart } from "../charts/RatingTrendChart";
import { ScoreDistributionChart } from "../charts/ScoreDistributionChart";
import { SentimentTrendChart } from "../charts/SentimentTrendChart";
import { SectionCard } from "../ui/SectionCard";

export function TrendsView({ data }: { data: DashboardPayload }) {
  const scoredWeeks = data.trends.filter((point) => point.average != null);
  const strongest = [...scoredWeeks].sort(
    (left, right) => (right.average ?? 0) - (left.average ?? 0),
  )[0];
  const weakest = [...scoredWeeks].sort(
    (left, right) => (left.average ?? 10) - (right.average ?? 10),
  )[0];
  const busiest = [...data.trends].sort(
    (left, right) => right.reviewCount - left.reviewCount,
  )[0];

  return (
    <div className="view-stack">
      <section className="insight-strip" aria-label="Trend highlights">
        <article>
          <span className="insight-strip__icon insight-strip__icon--good">
            <ArrowUpRight aria-hidden="true" size={18} />
          </span>
          <div>
            <small>Highest weekly rating</small>
            <strong>{formatScore(strongest?.average ?? null, 2)}</strong>
            <p>{strongest ? `Week of ${strongest.label}` : "No rated week"}</p>
          </div>
        </article>
        <article>
          <span className="insight-strip__icon insight-strip__icon--bad">
            <ArrowDownRight aria-hidden="true" size={18} />
          </span>
          <div>
            <small>Lowest weekly rating</small>
            <strong>{formatScore(weakest?.average ?? null, 2)}</strong>
            <p>{weakest ? `Week of ${weakest.label}` : "No rated week"}</p>
          </div>
        </article>
        <article>
          <span className="insight-strip__icon">
            <MessageSquareMore aria-hidden="true" size={18} />
          </span>
          <div>
            <small>Busiest review week</small>
            <strong>{formatCount(busiest?.reviewCount ?? 0)}</strong>
            <p>{busiest ? `Week of ${busiest.label}` : "No review volume"}</p>
          </div>
        </article>
        <article>
          <span className="insight-strip__icon">
            <CalendarClock aria-hidden="true" size={18} />
          </span>
          <div>
            <small>Reporting window</small>
            <strong>{data.trends.length} weeks</strong>
            <p>Australia/Sydney calendar</p>
          </div>
        </article>
      </section>

      <SectionCard
        description="A weekly average based only on reviews published in each Sydney Monday–Sunday period."
        eyebrow="Rating"
        title="Average guest rating over time"
      >
        <RatingTrendChart data={data.trends} />
      </SectionCard>

      <SectionCard
        description="Each weekly bar shows the share of classified positive, mixed, and negative reviews."
        eyebrow="Sentiment"
        title="How the guest experience mix is changing"
      >
        <SentimentTrendChart data={data.trends} />
      </SectionCard>

      <div className="content-grid content-grid--equal">
        <SectionCard
          description="Source scores grouped into Booking-style operational ranges."
          title="Score distribution"
        >
          <ScoreDistributionChart data={data.scoreDistribution} />
          <div className="distribution-legend">
            {data.scoreDistribution.map((bucket) => (
              <div key={bucket.label}>
                <span>{bucket.label}</span>
                <strong>{formatPercent(bucket.share)}</strong>
                <small>{formatCount(bucket.count)} reviews</small>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          description="Volume, rating, negative share, and partner response rate in one compact weekly table."
          title="Weekly detail"
        >
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Reviews</th>
                  <th>Rating</th>
                  <th>Negative</th>
                  <th>Response</th>
                </tr>
              </thead>
              <tbody>
                {[...data.trends]
                  .reverse()
                  .slice(0, 8)
                  .map((point, index, rows) => {
                    const previous = rows[index + 1];
                    const delta =
                      !point.isPartial &&
                      point.average != null &&
                      previous?.average != null
                        ? point.average - previous.average
                        : null;
                    const DirectionIcon =
                      delta == null || Math.abs(delta) < 0.01
                        ? Minus
                        : delta > 0
                          ? ArrowUpRight
                          : ArrowDownRight;
                    return (
                      <tr key={point.periodStart}>
                        <td>
                          {point.label}
                          {point.isPartial ? " (to date)" : ""}
                        </td>
                        <td>{formatCount(point.reviewCount)}</td>
                        <td>
                          <span
                            className={`table-trend ${
                              delta == null
                                ? ""
                                : delta > 0
                                  ? "is-good"
                                  : delta < 0
                                    ? "is-bad"
                                    : ""
                            }`}
                          >
                            <DirectionIcon aria-hidden="true" size={14} />
                            {formatScore(point.average, 2)}
                          </span>
                        </td>
                        <td>{formatPercent(point.negativeShare)}</td>
                        <td>{formatPercent(point.responseRate)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
