import type { DashboardFilters, ReviewQuery } from "./types";

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = {
  propertyKeys: [],
  from: "",
  to: "",
};

export const DEFAULT_REVIEW_QUERY: ReviewQuery = {
  page: 1,
  pageSize: 20,
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
};
