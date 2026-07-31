import type {
  DashboardFilters,
  DashboardPayload,
  ReviewQuery,
} from "./types";

const DEFAULT_API_ORIGIN =
  process.env.NEXT_PUBLIC_AZZURO_API_ORIGIN ?? "http://127.0.0.1:4318";

function appendList(
  search: URLSearchParams,
  name: string,
  values: string[],
) {
  if (values.length > 0) search.set(name, values.join(","));
}

export function dashboardRequestUrl(
  filters: DashboardFilters,
  reviewQuery: ReviewQuery,
) {
  const search = new URLSearchParams();
  appendList(search, "properties", filters.propertyKeys);
  if (filters.from) search.set("from", filters.from);
  if (filters.to) search.set("to", filters.to);
  search.set("reviewPage", String(reviewQuery.page));
  search.set("reviewPageSize", String(reviewQuery.pageSize));
  if (reviewQuery.query.trim()) {
    search.set("reviewQuery", reviewQuery.query.trim());
  }
  appendList(search, "reviewProperties", reviewQuery.propertyKeys);
  if (reviewQuery.from) search.set("reviewFrom", reviewQuery.from);
  if (reviewQuery.to) search.set("reviewTo", reviewQuery.to);
  search.set("reviewMinScore", String(reviewQuery.minScore));
  search.set("reviewMaxScore", String(reviewQuery.maxScore));
  appendList(search, "reviewSentiments", reviewQuery.sentiments);
  appendList(search, "reviewTopics", reviewQuery.topics);
  if (reviewQuery.language) search.set("reviewLanguage", reviewQuery.language);
  if (reviewQuery.guestType) search.set("reviewGuestType", reviewQuery.guestType);
  if (reviewQuery.roomType) search.set("reviewRoomType", reviewQuery.roomType);
  search.set("reviewSort", reviewQuery.sort);
  return `${DEFAULT_API_ORIGIN}/api/dashboard?${search.toString()}`;
}

export async function fetchDashboard(
  filters: DashboardFilters,
  reviewQuery: ReviewQuery,
  signal?: AbortSignal,
) {
  const response = await fetch(dashboardRequestUrl(filters, reviewQuery), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `Dashboard request failed (${response.status})`;
    throw new Error(message);
  }
  return (await response.json()) as DashboardPayload;
}
