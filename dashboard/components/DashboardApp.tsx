"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { GlobalFilters } from "./GlobalFilters";
import { Sidebar } from "./Sidebar";
import { ErrorState, LoadingState, NoPublishedDataState } from "./ui/States";
import {
  CollectButton,
  CollectProgress,
  useCollectJob,
} from "./CollectControl";
import { InsightsView } from "./views/InsightsView";
import { OverviewView } from "./views/OverviewView";
import { PropertiesView } from "./views/PropertiesView";
import { QualityView } from "./views/QualityView";
import { ReviewsView } from "./views/ReviewsView";
import { TrendsView } from "./views/TrendsView";
import { fetchDashboard } from "../lib/dashboard-client";
import {
  DEFAULT_DASHBOARD_FILTERS,
  DEFAULT_REVIEW_QUERY,
} from "../lib/defaults";
import type {
  DashboardFilters,
  DashboardPayload,
  DashboardView,
  ReviewQuery,
  Sentiment,
  TopicKey,
} from "../lib/types";

const VALID_VIEWS = new Set<DashboardView>([
  "overview",
  "trends",
  "properties",
  "insights",
  "reviews",
  "quality",
]);
const VALID_SENTIMENTS = new Set<Sentiment>([
  "positive",
  "mixed",
  "negative",
  "unclassified",
]);
const VALID_TOPICS = new Set<TopicKey>([
  "cleanliness",
  "check_in",
  "staff_reception",
  "noise",
  "facilities",
  "location",
  "room_condition",
  "value_for_money",
]);
const VALID_REVIEW_SORTS = new Set<ReviewQuery["sort"]>([
  "newest",
  "oldest",
  "highest",
  "lowest",
  "most_helpful",
]);

function searchList(search: URLSearchParams, name: string) {
  return [...new Set((search.get(name) ?? "").split(",").filter(Boolean))];
}

function boundedNumber(
  search: URLSearchParams,
  name: string,
  min: number,
  max: number,
  fallback: number,
) {
  const raw = search.get(name);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function parseInitialState() {
  if (typeof window === "undefined") {
    return {
      view: "overview" as DashboardView,
      filters: DEFAULT_DASHBOARD_FILTERS,
      reviewQuery: DEFAULT_REVIEW_QUERY,
    };
  }
  const search = new URLSearchParams(window.location.search);
  const requestedView = search.get("view") as DashboardView | null;
  const requestedSort = search.get("reviewSort") as
    | ReviewQuery["sort"]
    | null;
  let minScore = boundedNumber(search, "reviewMinScore", 0, 10, 0);
  let maxScore = boundedNumber(search, "reviewMaxScore", 0, 10, 10);
  if (minScore > maxScore) {
    minScore = 0;
    maxScore = 10;
  }
  return {
    view:
      requestedView && VALID_VIEWS.has(requestedView)
        ? requestedView
        : ("overview" as DashboardView),
    filters: {
      propertyKeys: (search.get("properties") ?? "")
        .split(",")
        .filter(Boolean),
      from: search.get("from") ?? "",
      to: search.get("to") ?? "",
    },
    reviewQuery: {
      page: Math.trunc(
        boundedNumber(search, "reviewPage", 1, 100_000, 1),
      ),
      pageSize: Math.trunc(
        boundedNumber(search, "reviewPageSize", 5, 100, 20),
      ),
      query: (search.get("reviewQuery") ?? "").slice(0, 200),
      propertyKeys: searchList(search, "reviewProperties"),
      from: search.get("reviewFrom") ?? "",
      to: search.get("reviewTo") ?? "",
      minScore,
      maxScore,
      sentiments: searchList(search, "reviewSentiments").filter(
        (value): value is Sentiment =>
          VALID_SENTIMENTS.has(value as Sentiment),
      ),
      topics: searchList(search, "reviewTopics").filter(
        (value): value is TopicKey => VALID_TOPICS.has(value as TopicKey),
      ),
      language: search.get("reviewLanguage") ?? "",
      guestType: search.get("reviewGuestType") ?? "",
      roomType: search.get("reviewRoomType") ?? "",
      sort:
        requestedSort && VALID_REVIEW_SORTS.has(requestedSort)
          ? requestedSort
          : "newest",
    },
  };
}

export function DashboardApp() {
  const [view, setView] = useState<DashboardView>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filters, setFilters] = useState<DashboardFilters>(
    DEFAULT_DASHBOARD_FILTERS,
  );
  const [reviewQuery, setReviewQuery] = useState<ReviewQuery>(
    DEFAULT_REVIEW_QUERY,
  );
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const firstRequest = useRef(true);
  const collect = useCollectJob(
    useCallback(() => setRefreshToken((value) => value + 1), []),
  );

  /* URL state is intentionally applied after hydration so server and first
     client markup remain identical in the local vinext shell. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const initial = parseInitialState();
    setView(initial.view);
    setFilters(initial.filters);
    setReviewQuery(initial.reviewQuery);
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const requestData = useCallback(
    async (signal: AbortSignal) => {
      void refreshToken;
      setError(null);
      if (!firstRequest.current) setRefreshing(true);
      try {
        const payload = await fetchDashboard(filters, reviewQuery, signal);
        setData(payload);
      } catch (requestError) {
        if (signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "The local dashboard service did not return a valid response.",
        );
      } finally {
        if (!signal.aborted) {
          firstRequest.current = false;
          setRefreshing(false);
        }
      }
    },
    [filters, reviewQuery, refreshToken],
  );

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => void requestData(controller.signal),
      reviewQuery.query ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [hydrated, requestData, reviewQuery.query]);

  useEffect(() => {
    if (!hydrated) return;
    const search = new URLSearchParams();
    if (view !== "overview") search.set("view", view);
    if (filters.propertyKeys.length > 0) {
      search.set("properties", filters.propertyKeys.join(","));
    }
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (view === "reviews") {
      if (reviewQuery.page !== DEFAULT_REVIEW_QUERY.page) {
        search.set("reviewPage", String(reviewQuery.page));
      }
      if (reviewQuery.pageSize !== DEFAULT_REVIEW_QUERY.pageSize) {
        search.set("reviewPageSize", String(reviewQuery.pageSize));
      }
      if (reviewQuery.query) search.set("reviewQuery", reviewQuery.query);
      if (reviewQuery.propertyKeys.length > 0) {
        search.set("reviewProperties", reviewQuery.propertyKeys.join(","));
      }
      if (reviewQuery.from) search.set("reviewFrom", reviewQuery.from);
      if (reviewQuery.to) search.set("reviewTo", reviewQuery.to);
      if (reviewQuery.minScore !== DEFAULT_REVIEW_QUERY.minScore) {
        search.set("reviewMinScore", String(reviewQuery.minScore));
      }
      if (reviewQuery.maxScore !== DEFAULT_REVIEW_QUERY.maxScore) {
        search.set("reviewMaxScore", String(reviewQuery.maxScore));
      }
      if (reviewQuery.sentiments.length > 0) {
        search.set("reviewSentiments", reviewQuery.sentiments.join(","));
      }
      if (reviewQuery.topics.length > 0) {
        search.set("reviewTopics", reviewQuery.topics.join(","));
      }
      if (reviewQuery.language) {
        search.set("reviewLanguage", reviewQuery.language);
      }
      if (reviewQuery.guestType) {
        search.set("reviewGuestType", reviewQuery.guestType);
      }
      if (reviewQuery.roomType) {
        search.set("reviewRoomType", reviewQuery.roomType);
      }
      if (reviewQuery.sort !== DEFAULT_REVIEW_QUERY.sort) {
        search.set("reviewSort", reviewQuery.sort);
      }
    }
    const next = `${window.location.pathname}${
      search.size > 0 ? `?${search.toString()}` : ""
    }`;
    window.history.replaceState(null, "", next);
  }, [hydrated, view, filters, reviewQuery]);

  const navigate = (nextView: DashboardView) => {
    if (nextView === "reviews" && view !== "reviews") {
      setReviewQuery((current) => {
        const hasReviewScope =
          current.propertyKeys.length > 0 || current.from || current.to;
        return hasReviewScope
          ? current
          : {
              ...current,
              page: 1,
              propertyKeys: filters.propertyKeys,
              from: filters.from,
              to: filters.to,
            };
      });
    }
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openTopicReviews = (
    topic?: TopicKey,
    period?: "current-period",
  ) => {
    setReviewQuery((current) => ({
      ...current,
      page: 1,
      topics: topic ? [topic] : [],
      propertyKeys: filters.propertyKeys,
      from:
        period === "current-period" && data
          ? data.overview.currentWeek.start
          : filters.from,
      to:
        period === "current-period" && data
          ? data.overview.currentWeek.end
          : filters.to,
    }));
    navigate("reviews");
  };

  const content = () => {
    if (!data && !error) return <LoadingState />;
    if (error && !data) {
      return (
        <ErrorState
          message={`${error} Make sure the local data service is running on port 4318.`}
          onRetry={() => setRefreshToken((value) => value + 1)}
        />
      );
    }
    if (!data) return null;
    if (data.properties.length === 0) {
      return (
        <NoPublishedDataState
          action={
            <CollectButton
              controller={collect}
              label="Collect reviews now"
              variant="primary"
            />
          }
        />
      );
    }
    if (view === "overview") {
      return <OverviewView data={data} onNavigate={navigate} />;
    }
    if (view === "trends") return <TrendsView data={data} />;
    if (view === "properties") return <PropertiesView data={data} />;
    if (view === "insights") {
      return <InsightsView data={data} onOpenReviews={openTopicReviews} />;
    }
    if (view === "reviews") {
      return (
        <ReviewsView
          data={data}
          onQueryChange={setReviewQuery}
          query={reviewQuery}
        />
      );
    }
    return <QualityView data={data} />;
  };

  return (
    <div
      className={`app-shell ${
        sidebarCollapsed ? "sidebar-is-collapsed" : ""
      }`}
    >
      <Sidebar
        activeView={view}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onCollapseToggle={() =>
          setSidebarCollapsed((isCollapsed) => !isCollapsed)
        }
        onViewChange={navigate}
        open={sidebarOpen}
      />
      <div className="app-main">
        <AppHeader
          collect={collect}
          data={data}
          onMenuOpen={() => setSidebarOpen(true)}
          onRefresh={() => setRefreshToken((value) => value + 1)}
          refreshing={refreshing}
          view={view}
        />
        <CollectProgress
          controller={collect}
          names={Object.fromEntries(
            (data?.properties ?? []).map((property) => [
              property.propertyKey,
              property.propertyName,
            ]),
          )}
        />
        {view !== "reviews" ? (
          <GlobalFilters
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_DASHBOARD_FILTERS)}
            options={data?.filterOptions ?? null}
          />
        ) : null}
        {error && data ? (
          <div className="stale-data-banner" role="status">
            Showing the last loaded dashboard response. Refresh failed: {error}
          </div>
        ) : null}
        <div
          aria-busy={refreshing}
          className={`view-container ${refreshing ? "is-refreshing" : ""}`}
        >
          {content()}
        </div>
        <footer className="app-footer">
          <span>Azzurro Review Intelligence · Australia/Sydney reporting</span>
          <span>Source facts and derived insights are kept separately.</span>
        </footer>
      </div>
    </div>
  );
}
