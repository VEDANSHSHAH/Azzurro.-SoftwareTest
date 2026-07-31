"use client";

import {
  BedDouble,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  CirclePlus,
  Filter,
  Flag,
  Globe2,
  MessageCircleReply,
  Search,
  SlidersHorizontal,
  ThumbsUp,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardPayload,
  ReviewItem,
  ReviewQuery,
  Sentiment,
  TopicKey,
} from "../../lib/types";
import {
  formatCount,
  formatLocalDate,
  sentenceCase,
} from "../../lib/format";
import { ScoreBadge } from "../ui/ScoreBadge";
import { EmptyState } from "../ui/States";

const SENTIMENT_OPTIONS: Array<{ value: Sentiment; label: string }> = [
  { value: "positive", label: "Positive" },
  { value: "mixed", label: "Mixed" },
  { value: "negative", label: "Negative" },
  { value: "unclassified", label: "Unclassified" },
];

function toggle<T>(items: T[], item: T) {
  return items.includes(item)
    ? items.filter((value) => value !== item)
    : [...items, item];
}

function ReviewCard({
  review,
  onOpen,
}: {
  review: ReviewItem;
  onOpen: () => void;
}) {
  const excerpt =
    review.negativeText ||
    review.positiveText ||
    "This guest left a score without a written comment.";
  return (
    <article className="review-card">
      <div className="review-card__score">
        <ScoreBadge score={review.score} />
        <span className={`sentiment-label sentiment-label--${review.sentiment}`}>
          {sentenceCase(review.sentiment)}
        </span>
      </div>
      <div className="review-card__body">
        <div className="review-card__meta">
          <span>{review.propertyName}</span>
          <span>{formatLocalDate(review.reviewedLocalDate, true)}</span>
          {review.guest?.countryName ? (
            <span>
              <Globe2 aria-hidden="true" size={13} />
              {review.guest.countryName}
            </span>
          ) : null}
        </div>
        <h3>
          {review.title ||
            (review.positiveText || review.negativeText
              ? "Guest review"
              : "Score-only review")}
        </h3>
        <p>{excerpt}</p>
        <div className="review-card__topics">
          {review.topics.slice(0, 4).map((topic) => (
            <span
              className={`topic-pill topic-pill--${topic.polarity}`}
              key={`${review.reviewId}:${topic.topic}`}
            >
              {topic.label}
            </span>
          ))}
          {review.topics.length > 4 ? (
            <span className="topic-pill">+{review.topics.length - 4}</span>
          ) : null}
        </div>
        <div className="review-card__footer">
          <div>
            {review.stay?.roomName ? (
              <span>
                <BedDouble aria-hidden="true" size={14} />
                {review.stay.roomName}
              </span>
            ) : null}
            {review.helpfulVotesCount ? (
              <span>
                <ThumbsUp aria-hidden="true" size={14} />
                {review.helpfulVotesCount} helpful
              </span>
            ) : null}
            {review.partnerReply ? (
              <span>
                <MessageCircleReply aria-hidden="true" size={14} />
                Replied
              </span>
            ) : null}
          </div>
          <button className="text-button" onClick={onOpen} type="button">
            Read full review
            <ChevronRight aria-hidden="true" size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function ReviewDrawer({
  review,
  onClose,
}: {
  review: ReviewItem | null;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!review) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    closeButton.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [review, onClose]);

  if (!review) return null;
  return (
    <>
      <button
        aria-label="Close review"
        className="drawer-backdrop"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-labelledby="review-detail-title"
        aria-modal="true"
        className="review-drawer"
        role="dialog"
      >
        <div className="review-drawer__header">
          <div>
            <span>{review.propertyName}</span>
            <strong id="review-detail-title">Review detail</strong>
          </div>
          <button
            aria-label="Close review"
            className="icon-button"
            onClick={onClose}
            ref={closeButton}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <div className="review-drawer__content">
          <div className="review-drawer__scoreline">
            <ScoreBadge score={review.score} size="large" />
            <div>
              <span
                className={`sentiment-label sentiment-label--${review.sentiment}`}
              >
                {sentenceCase(review.sentiment)}
              </span>
              <p>{review.sentimentReason}</p>
            </div>
          </div>

          <div className="review-drawer__guest">
            <span className="guest-monogram">
              {(review.guest?.username || "G").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{review.guest?.username || "Booking guest"}</strong>
              <p>
                {[
                  review.guest?.guestType,
                  review.guest?.countryName,
                  formatLocalDate(review.reviewedLocalDate),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>

          <section className="review-text-block">
            <h2>{review.title || "Guest review"}</h2>
            {review.positiveText ? (
              <div className="review-polarity review-polarity--positive">
                <CirclePlus aria-hidden="true" size={18} />
                <div>
                  <strong>What went well</strong>
                  <p>{review.positiveText}</p>
                </div>
              </div>
            ) : null}
            {review.negativeText ? (
              <div className="review-polarity review-polarity--negative">
                <CircleMinus aria-hidden="true" size={18} />
                <div>
                  <strong>What could improve</strong>
                  <p>{review.negativeText}</p>
                </div>
              </div>
            ) : null}
            {!review.positiveText && !review.negativeText ? (
              <p className="muted-copy">
                This guest left a score without a written comment.
              </p>
            ) : null}
          </section>

          {review.topics.length > 0 ? (
            <section className="review-drawer__section">
              <h3>Matched operational topics</h3>
              <div className="topic-evidence-list">
                {review.topics.map((topic) => (
                  <article key={topic.topic}>
                    <span className={`topic-pill topic-pill--${topic.polarity}`}>
                      {topic.label}
                    </span>
                    <p>
                      Evidence:{" "}
                      {topic.evidence.length > 0
                        ? topic.evidence.join(", ")
                        : "classifier rule match"}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="review-drawer__section">
            <h3>Stay context</h3>
            <dl className="detail-list">
              <div>
                <dt>
                  <BedDouble aria-hidden="true" size={15} />
                  Room
                </dt>
                <dd>{review.stay?.roomName ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>
                  <CalendarDays aria-hidden="true" size={15} />
                  Stay
                </dt>
                <dd>
                  {review.stay?.numNights
                    ? `${review.stay.numNights} night${
                        review.stay.numNights === 1 ? "" : "s"
                      }`
                    : "Not provided"}
                </dd>
              </div>
              <div>
                <dt>
                  <UsersRound aria-hidden="true" size={15} />
                  Traveller
                </dt>
                <dd>{review.stay?.customerType ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>
                  <Flag aria-hidden="true" size={15} />
                  Language
                </dt>
                <dd>{review.sourceLanguage ?? "Not provided"}</dd>
              </div>
            </dl>
          </section>

          {review.partnerReply ? (
            <section className="partner-reply">
              <MessageCircleReply aria-hidden="true" size={19} />
              <div>
                <strong>Property reply</strong>
                <p>{review.partnerReply}</p>
              </div>
            </section>
          ) : null}
        </div>
      </aside>
    </>
  );
}

export function ReviewsView({
  data,
  query,
  onQueryChange,
}: {
  data: DashboardPayload;
  query: ReviewQuery;
  onQueryChange: (query: ReviewQuery) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedReview, setSelectedReview] = useState<ReviewItem | null>(null);
  const activeFilterCount = useMemo(
    () =>
      query.propertyKeys.length +
      query.sentiments.length +
      query.topics.length +
      Number(Boolean(query.from)) +
      Number(Boolean(query.to)) +
      Number(query.minScore > 0 || query.maxScore < 10) +
      Number(Boolean(query.language)) +
      Number(Boolean(query.guestType)) +
      Number(Boolean(query.roomType)),
    [query],
  );

  const update = (patch: Partial<ReviewQuery>, resetPage = true) =>
    onQueryChange({
      ...query,
      ...patch,
      page: resetPage ? 1 : (patch.page ?? query.page),
    });

  return (
    <div className="review-workspace">
      <button
        className="button button--secondary review-filter-toggle"
        onClick={() => setFiltersOpen((value) => !value)}
        type="button"
      >
        <Filter aria-hidden="true" size={16} />
        Filters
        {activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}
      </button>

      <aside
        aria-label="Review filters"
        className={`review-filters ${filtersOpen ? "is-open" : ""}`}
      >
        <div className="review-filters__heading">
          <div>
            <SlidersHorizontal aria-hidden="true" size={17} />
            <strong>Refine reviews</strong>
          </div>
          <button
            className="text-button"
            onClick={() =>
              onQueryChange({
                ...query,
                page: 1,
                query: "",
                propertyKeys: [],
                from: "",
                to: "",
                minScore: 0,
                maxScore: 10,
                sentiments: [],
                topics: [],
                language: "",
                guestType: "",
                roomType: "",
                sort: "newest",
              })
            }
            type="button"
          >
            Clear all
          </button>
        </div>

        <div className="filter-section">
          <label htmlFor="review-property">Property</label>
          <select
            id="review-property"
            onChange={(event) =>
              update({
                propertyKeys: event.target.value ? [event.target.value] : [],
              })
            }
            value={query.propertyKeys[0] ?? ""}
          >
            <option value="">All properties</option>
            {data.filterOptions.properties.map((property) => (
              <option key={property.propertyKey} value={property.propertyKey}>
                {property.propertyName}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="filter-section">
          <legend>Sentiment</legend>
          <div className="check-list">
            {SENTIMENT_OPTIONS.map((option) => (
              <label key={option.value}>
                <input
                  checked={query.sentiments.includes(option.value)}
                  onChange={() =>
                    update({
                      sentiments: toggle(query.sentiments, option.value),
                    })
                  }
                  type="checkbox"
                />
                <span className="fake-check">
                  <Check aria-hidden="true" size={12} />
                </span>
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="filter-section">
          <label htmlFor="review-topic">Operational topic</label>
          <select
            id="review-topic"
            onChange={(event) =>
              update({
                topics: event.target.value
                  ? [event.target.value as TopicKey]
                  : [],
              })
            }
            value={query.topics[0] ?? ""}
          >
            <option value="">All topics</option>
            {data.filterOptions.topics.map((topic) => (
              <option key={topic.topic} value={topic.topic}>
                {topic.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-section">
          <label>Score range</label>
          <div className="score-range">
            <select
              aria-label="Minimum score"
              onChange={(event) => {
                const minScore = Number(event.target.value);
                update({
                  minScore,
                  maxScore: Math.max(query.maxScore, minScore),
                });
              }}
              value={query.minScore}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((score) => (
                <option key={score} value={score}>
                  {score} min
                </option>
              ))}
            </select>
            <span>to</span>
            <select
              aria-label="Maximum score"
              onChange={(event) => {
                const maxScore = Number(event.target.value);
                update({
                  maxScore,
                  minScore: Math.min(query.minScore, maxScore),
                });
              }}
              value={query.maxScore}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
                <option key={score} value={score}>
                  {score} max
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="filter-section filter-section--dates">
          <label htmlFor="review-from">Review date</label>
          <input
            id="review-from"
            max={query.to || data.filterOptions.dateBounds.max || undefined}
            min={data.filterOptions.dateBounds.min || undefined}
            onChange={(event) => update({ from: event.target.value })}
            type="date"
            value={query.from}
          />
          <input
            aria-label="Review date to"
            max={data.filterOptions.dateBounds.max || undefined}
            min={query.from || data.filterOptions.dateBounds.min || undefined}
            onChange={(event) => update({ to: event.target.value })}
            type="date"
            value={query.to}
          />
        </div>

        <div className="filter-section">
          <label htmlFor="review-language">Language</label>
          <select
            id="review-language"
            onChange={(event) => update({ language: event.target.value })}
            value={query.language}
          >
            <option value="">All languages</option>
            {data.filterOptions.languages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-section">
          <label htmlFor="review-guest">Guest type</label>
          <select
            id="review-guest"
            onChange={(event) => update({ guestType: event.target.value })}
            value={query.guestType}
          >
            <option value="">All guest types</option>
            {data.filterOptions.guestTypes.map((guestType) => (
              <option key={guestType} value={guestType}>
                {guestType}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-section">
          <label htmlFor="review-room">Room type</label>
          <select
            id="review-room"
            onChange={(event) => update({ roomType: event.target.value })}
            value={query.roomType}
          >
            <option value="">All room types</option>
            {data.filterOptions.roomTypes.map((roomType) => (
              <option key={roomType} value={roomType}>
                {roomType}
              </option>
            ))}
          </select>
        </div>
      </aside>

      <main className="review-feed">
        <div className="review-feed__toolbar">
          <div className="review-search">
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Search review text"
              onChange={(event) => update({ query: event.target.value })}
              placeholder="Search review text, property, room…"
              type="search"
              value={query.query}
            />
          </div>
          <div className="review-sort">
            <label htmlFor="review-sort">Sort by</label>
            <select
              id="review-sort"
              onChange={(event) =>
                update({
                  sort: event.target.value as ReviewQuery["sort"],
                })
              }
              value={query.sort}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="highest">Highest score</option>
              <option value="lowest">Lowest score</option>
              <option value="most_helpful">Most helpful</option>
            </select>
          </div>
        </div>

        <div
          aria-label="Quick operational topic filters"
          className="review-quick-topics"
          role="group"
        >
          <span>Topic</span>
          <button
            aria-pressed={query.topics.length === 0}
            className={query.topics.length === 0 ? "is-selected" : ""}
            onClick={() => update({ topics: [] })}
            type="button"
          >
            All
          </button>
          {data.filterOptions.topics.map((topic) => {
            const selected = query.topics.includes(topic.topic);
            return (
              <button
                aria-pressed={selected}
                className={selected ? "is-selected" : ""}
                key={topic.topic}
                onClick={() =>
                  update({ topics: selected ? [] : [topic.topic] })
                }
                type="button"
              >
                {topic.label}
              </button>
            );
          })}
        </div>

        <div className="review-feed__summary">
          <div>
            <strong>{formatCount(data.reviews.total)} reviews</strong>
            <span>
              Page {data.reviews.page} of {Math.max(1, data.reviews.pageCount)}
            </span>
          </div>
          {activeFilterCount > 0 ? (
            <span className="active-filter-chip">
              <Filter aria-hidden="true" size={13} />
              {activeFilterCount} active filter
              {activeFilterCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {data.reviews.items.length > 0 ? (
          <div className="review-list">
            {data.reviews.items.map((review) => (
              <ReviewCard
                key={review.reviewId}
                onOpen={() => setSelectedReview(review)}
                review={review}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            detail="Try widening the score or date range, removing a topic, or clearing the text search."
            title="No reviews match these filters"
          />
        )}

        {data.reviews.total > 0 ? (
        <div className="pagination">
          <button
            className="button button--secondary"
            disabled={data.reviews.page <= 1}
            onClick={() => update({ page: data.reviews.page - 1 }, false)}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={16} />
            Previous
          </button>
          <span>
            {formatCount(
              (data.reviews.page - 1) * data.reviews.pageSize + 1,
            )}
            –
            {formatCount(
              Math.min(
                data.reviews.total,
                data.reviews.page * data.reviews.pageSize,
              ),
            )}{" "}
            of {formatCount(data.reviews.total)}
          </span>
          <button
            className="button button--secondary"
            disabled={data.reviews.page >= data.reviews.pageCount}
            onClick={() => update({ page: data.reviews.page + 1 }, false)}
            type="button"
          >
            Next
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        </div>
        ) : null}
      </main>

      <ReviewDrawer
        onClose={() => setSelectedReview(null)}
        review={selectedReview}
      />
    </div>
  );
}
