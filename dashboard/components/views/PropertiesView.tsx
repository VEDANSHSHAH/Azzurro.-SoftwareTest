"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Minus,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DashboardPayload, PropertyMetric } from "../../lib/types";
import { SOURCE_GAP_VERIFIED_LABEL } from "../../lib/publication-status";
import {
  formatCount,
  formatPercent,
  formatScore,
} from "../../lib/format";
import { BookingCategoryPortfolioChart } from "../charts/BookingCategoryComparisonCharts";
import { PropertyComparisonChart } from "../charts/PropertyComparisonChart";
import { SectionCard } from "../ui/SectionCard";

function PropertyStatus({ property }: { property: PropertyMetric }) {
  if (property.status === "verified") {
    return (
      <span className="property-status property-status--verified">
        <CheckCircle2 aria-hidden="true" size={14} />
        Verified
      </span>
    );
  }
  if (property.status === "source-gap") {
    return (
      <span className="property-status property-status--attention">
        <CircleAlert aria-hidden="true" size={14} />
        {SOURCE_GAP_VERIFIED_LABEL}
      </span>
    );
  }
  if (property.status === "evidence-error") {
    return (
      <span className="property-status property-status--error">
        <CircleAlert aria-hidden="true" size={14} />
        Evidence error
      </span>
    );
  }
  return (
    <span className="property-status">
      <CircleAlert aria-hidden="true" size={14} />
      {property.status === "collecting"
        ? "Pending verification"
        : "Unavailable"}
    </span>
  );
}

function Delta({
  value,
  goodDirection = "up",
}: {
  value: number | null;
  goodDirection?: "up" | "down";
}) {
  const Icon =
    value == null || Math.abs(value) < 0.01
      ? Minus
      : value > 0
        ? ArrowUpRight
        : ArrowDownRight;
  const good =
    value != null &&
    Math.abs(value) >= 0.01 &&
    ((value > 0 && goodDirection === "up") ||
      (value < 0 && goodDirection === "down"));
  const bad =
    value != null &&
    Math.abs(value) >= 0.01 &&
    !good;
  return (
    <span
      className={`property-delta ${good ? "is-good" : bad ? "is-bad" : ""}`}
    >
      <Icon aria-hidden="true" size={14} />
      {value == null
        ? "No comparison"
        : `${value > 0 ? "+" : ""}${value.toFixed(1)}`}
    </span>
  );
}

export function PropertiesView({ data }: { data: DashboardPayload }) {
  const customPeriod = data.overview.periodKind === "custom";
  const periodLabel = customPeriod ? "Selected period" : "This week";
  const previousLabel = customPeriod ? "Previous period" : "Previous week";
  const available = data.properties.filter(
    (property) => property.publishedReviewCount > 0,
  );
  const [selectedKey, setSelectedKey] = useState(
    available[0]?.propertyKey ?? data.properties[0]?.propertyKey ?? "",
  );
  const selected = useMemo(
    () =>
      data.properties.find(
        (property) => property.propertyKey === selectedKey,
      ) ?? data.properties[0],
    [data.properties, selectedKey],
  );

  return (
    <div className="view-stack">
      <section aria-label="Property summary cards" className="property-card-grid">
        {data.properties.map((property) => (
          <button
            className={`property-summary-card ${
              selected?.propertyKey === property.propertyKey ? "is-selected" : ""
            }`}
            key={property.propertyKey}
            onClick={() => setSelectedKey(property.propertyKey)}
            type="button"
          >
            <div className="property-summary-card__top">
              <span className="property-monogram">
                {property.propertyName
                  .split(" ")
                  .slice(0, 2)
                  .map((word) => word[0])
                  .join("")}
              </span>
              <PropertyStatus property={property} />
            </div>
            <div className="property-summary-card__heading">
              <div>
                <strong>{property.propertyName}</strong>
                <small>
                  {formatCount(property.publishedReviewCount)} published reviews
                </small>
              </div>
              <ChevronRight aria-hidden="true" size={18} />
            </div>
            <dl className="property-summary-card__metrics">
              <div>
                <dt>{periodLabel}</dt>
                <dd>{formatScore(property.currentWeekAverage, 2)}</dd>
              </div>
              <div>
                <dt>Movement</dt>
                <dd>
                  <Delta value={property.weekDelta} />
                </dd>
              </div>
              <div>
                <dt>Negative</dt>
                <dd>{formatPercent(property.negativeShare)}</dd>
              </div>
            </dl>
          </button>
        ))}
      </section>

      <SectionCard
        description={`${periodLabel} compared with the immediately preceding period.`}
        title="Weekly rating comparison"
      >
        <PropertyComparisonChart data={data.properties} />
      </SectionCard>

      <SectionCard
        description="Current accepted Booking property aggregates on one fixed 0-10 scale. They are separate from review-text topic shares and do not change with the date filter."
        title="Booking category comparison"
      >
        <BookingCategoryPortfolioChart data={data.properties} />
      </SectionCard>

      {selected ? (
        <div className="content-grid content-grid--property">
          <SectionCard
            className="property-detail-card"
            description="The metrics below respond to the global property and date filters."
            eyebrow="Selected property"
            title={selected.propertyName}
          >
            <div className="property-detail-score">
              <div>
                <span>{periodLabel}</span>
                <strong>{formatScore(selected.currentWeekAverage, 2)}</strong>
                <Delta value={selected.weekDelta} />
              </div>
              <div className="property-detail-score__facts">
                <dl>
                  <div>
                    <dt>All-time published average</dt>
                    <dd>{formatScore(selected.averageScore, 2)}</dd>
                  </div>
                  <div>
                    <dt>Reviews in period</dt>
                    <dd>{formatCount(selected.currentWeekCount)}</dd>
                  </div>
                  <div>
                    <dt>Negative share</dt>
                    <dd>{formatPercent(selected.negativeShare)}</dd>
                  </div>
                  <div>
                    <dt>Partner response rate</dt>
                    <dd>{formatPercent(selected.responseRate)}</dd>
                  </div>
                  <div>
                    <dt>Top negative topic</dt>
                    <dd>{selected.topNegativeTopic ?? "No matched issue"}</dd>
                  </div>
                  <div>
                    <dt>Last review date</dt>
                    <dd>{selected.lastReviewedLocalDate ?? "—"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            description="Booking's property-level category scores from the accepted publication."
            title="Booking category scores"
          >
            {selected.categoryScores.length > 0 ? (
              <div className="category-score-list">
                {selected.categoryScores.map((category) => (
                    <div className="category-score" key={category.name}>
                      <div>
                        <span>{category.name}</span>
                        <strong>{category.score.toFixed(1)}</strong>
                      </div>
                      <div
                        aria-label={`${category.name}: ${category.score.toFixed(
                          1,
                        )} out of 10`}
                        className="category-score__track"
                        role="img"
                      >
                        <span
                          key={`${selected.propertyKey}:${category.name}`}
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min(100, category.score * 10),
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="muted-copy">
                Category scores are not available for this accepted property
                publication.
              </p>
            )}
          </SectionCard>
        </div>
      ) : null}

      <SectionCard
        description="A sortable operations table with the same definitions used throughout the dashboard."
        title="Property performance matrix"
      >
        <div className="table-scroll">
          <table className="data-table data-table--properties">
            <thead>
              <tr>
                <th>Property</th>
                <th>Published</th>
                <th>{periodLabel}</th>
                <th>{previousLabel}</th>
                <th>Movement</th>
                <th>Negative</th>
                <th>Response</th>
                <th>Primary issue</th>
              </tr>
            </thead>
            <tbody>
              {data.properties.map((property) => (
                <tr key={property.propertyKey}>
                  <td>
                    <strong>{property.propertyName}</strong>
                    <PropertyStatus property={property} />
                  </td>
                  <td>{formatCount(property.publishedReviewCount)}</td>
                  <td>{formatScore(property.currentWeekAverage, 2)}</td>
                  <td>{formatScore(property.previousWeekAverage, 2)}</td>
                  <td>
                    <Delta value={property.weekDelta} />
                  </td>
                  <td>{formatPercent(property.negativeShare)}</td>
                  <td>{formatPercent(property.responseRate)}</td>
                  <td>{property.topNegativeTopic ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
