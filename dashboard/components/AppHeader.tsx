"use client";

import {
  CalendarDays,
  CircleDotDashed,
  Menu,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { DashboardPayload, DashboardView } from "../lib/types";
import { formatLocalDate } from "../lib/format";
import {
  isAcceptedPublication,
  SOURCE_GAP_VERIFIED_LABEL,
} from "../lib/publication-status";
import type { CollectionStatus } from "../lib/dashboard-client";

const VIEW_COPY: Record<
  DashboardView,
  { eyebrow: string; title: string; description: string }
> = {
  overview: {
    eyebrow: "Operations overview",
    title: "Guest experience, clearly understood",
    description:
      "See what changed this week, where attention is needed, and what guests are telling you.",
  },
  trends: {
    eyebrow: "Performance trends",
    title: "Know the direction, not just the score",
    description:
      "Track rating, review volume, sentiment, and response behaviour over time.",
  },
  properties: {
    eyebrow: "Property performance",
    title: "Compare every location on equal terms",
    description:
      "Review performance, momentum, sentiment, and recurring issues by property.",
  },
  insights: {
    eyebrow: "Review insights",
    title: "Turn guest comments into operational priorities",
    description:
      "Understand which topics are improving, worsening, and driving negative experiences.",
  },
  reviews: {
    eyebrow: "Review explorer",
    title: "Read the feedback behind every metric",
    description:
      "Search, filter, and open individual reviews without losing their property and stay context.",
  },
  quality: {
    eyebrow: "Data quality",
    title: "Know exactly what the dashboard can prove",
    description:
      "Inspect collection health, publication evidence, source discrepancies, and analysis versions.",
  },
};

interface AppHeaderProps {
  view: DashboardView;
  data: DashboardPayload | null;
  collection: CollectionStatus | null;
  collectionStarting: boolean;
  collectionTargetLabel: string;
  refreshing: boolean;
  onMenuOpen: () => void;
  onRefresh: () => void;
  onStartCollection: () => void;
}

export function AppHeader({
  view,
  data,
  collection,
  collectionStarting,
  collectionTargetLabel,
  refreshing,
  onMenuOpen,
  onRefresh,
  onStartCollection,
}: AppHeaderProps) {
  const copy = VIEW_COPY[view];
  const qualityStatus = data?.quality.overallStatus ?? "collecting";
  const verifiedPropertyCount =
    data?.quality.properties.filter(
      (property) => isAcceptedPublication(property.status),
    ).length ?? 0;
  const totalPropertyCount = data?.quality.properties.length ?? 0;
  const QualityIcon =
    qualityStatus === "verified"
      ? ShieldCheck
      : qualityStatus === "attention" || qualityStatus === "error"
        ? ShieldAlert
        : CircleDotDashed;
  const qualityLabel =
    qualityStatus === "verified"
      ? "Verified publications"
      : qualityStatus === "attention"
        ? SOURCE_GAP_VERIFIED_LABEL
        : qualityStatus === "error"
          ? "Evidence error"
          : data
            ? `${verifiedPropertyCount} of ${totalPropertyCount} properties verified`
            : "Loading publication status";
  return (
    <header className="app-header">
      <div className="app-header__topline">
        <button
          aria-label="Open navigation"
          className="icon-button menu-button"
          onClick={onMenuOpen}
          type="button"
        >
          <Menu aria-hidden="true" size={21} />
        </button>
        <div className="app-header__status">
          <span
            className={`status-chip status-chip--${qualityStatus}`}
            title={
              qualityStatus === "collecting"
                ? "Portfolio publication status; this does not mean a scraper is currently running"
                : undefined
            }
          >
            <QualityIcon aria-hidden="true" size={15} />
            {qualityLabel}
          </span>
          <span className="status-chip">
            <CalendarDays aria-hidden="true" size={15} />
            Data through{" "}
            {formatLocalDate(data?.overview.dataThrough ?? null, true)}
          </span>
        </div>
        <button
          className="button button--primary collection-button"
          disabled={collectionStarting || collection?.running}
          onClick={onStartCollection}
          title="Starts a full verified collection in a visible browser. Complete any Booking verification in that browser."
          type="button"
        >
          <Play aria-hidden="true" fill="currentColor" size={14} />
          {collectionStarting || collection?.running
            ? "Collection running"
            : `Start collection${collectionTargetLabel}`}
        </button>
        <button
          className="button button--secondary refresh-button"
          disabled={refreshing}
          onClick={onRefresh}
          title="Reload the latest accepted SQLite data; this does not run the Booking collector"
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={refreshing ? "is-spinning" : ""}
            size={16}
          />
          Reload dashboard
        </button>
      </div>
      {collection && collection.status !== "idle" ? (
        <p
          className={`collection-status collection-status--${collection.status}`}
          role="status"
        >
          {collection.message}
        </p>
      ) : null}
      <div className="app-header__copy">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </div>
    </header>
  );
}
