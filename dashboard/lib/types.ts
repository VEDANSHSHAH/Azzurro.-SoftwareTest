export type DashboardView =
  | "overview"
  | "trends"
  | "properties"
  | "insights"
  | "reviews"
  | "quality";

export type Sentiment = "positive" | "mixed" | "negative" | "unclassified";

export type TopicKey =
  | "cleanliness"
  | "check_in"
  | "staff_reception"
  | "noise"
  | "facilities"
  | "location"
  | "room_condition"
  | "value_for_money";

export interface DashboardFilters {
  propertyKeys: string[];
  from: string;
  to: string;
}

export interface PeriodMetric {
  start: string;
  end: string;
  average: number | null;
  reviewCount: number;
  positiveCount: number;
  mixedCount: number;
  negativeCount: number;
  negativeFeedbackCount: number;
  unclassifiedCount: number;
  responseCount: number;
}

export interface KpiComparison {
  current: number | null;
  previous: number | null;
  delta: number | null;
  direction: "up" | "down" | "flat" | "unavailable";
}

export interface OverviewMetrics {
  periodKind: "current-week" | "custom";
  currentWeek: PeriodMetric;
  previousWeek: PeriodMetric;
  averageRating: KpiComparison;
  reviewVolume: KpiComparison;
  negativeShare: KpiComparison;
  responseRate: KpiComparison;
  dataThrough: string | null;
  attentionItems: AttentionItem[];
  recentReviews: ReviewItem[];
}

export interface AttentionItem {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  propertyKey?: string;
  topic?: TopicKey;
  reviewCount?: number;
}

export interface TrendPoint {
  periodStart: string;
  periodEnd: string;
  isPartial: boolean;
  label: string;
  average: number | null;
  reviewCount: number;
  positiveShare: number | null;
  mixedShare: number | null;
  negativeShare: number | null;
  unclassifiedShare: number | null;
  responseRate: number | null;
}

export interface ScoreBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  share: number;
}

export interface PropertyMetric {
  propertyKey: string;
  propertyName: string;
  bookingHotelId: number;
  publishedReviewCount: number;
  averageScore: number | null;
  currentWeekAverage: number | null;
  previousWeekAverage: number | null;
  weekDelta: number | null;
  currentWeekCount: number;
  negativeShare: number | null;
  responseRate: number | null;
  topNegativeTopic: string | null;
  lastReviewedLocalDate: string | null;
  categoryScores: CategoryScore[];
  status:
    | "verified"
    | "source-gap"
    | "evidence-error"
    | "collecting"
    | "unavailable";
}

export interface CategoryScore {
  name: string;
  score: number;
}

export interface TopicMetric {
  topic: TopicKey;
  label: string;
  description: string;
  negativeMentionCount: number;
  negativeMentionShare: number | null;
  previousNegativeMentionShare: number | null;
  shareDelta: number | null;
  allMentionCount: number;
  affectedPropertyCount: number;
  leadingPropertyName: string | null;
  trend: "improving" | "worsening" | "stable" | "unavailable";
}

export interface ReviewTopic {
  topic: TopicKey;
  label: string;
  polarity: "positive" | "negative" | "mixed";
  evidence: string[];
}

export interface ReviewItem {
  reviewId: string;
  propertyKey: string;
  propertyName: string;
  reviewedLocalDate: string;
  score: number;
  title: string | null;
  positiveText: string | null;
  negativeText: string | null;
  partnerReply: string | null;
  sourceLanguage: string | null;
  helpfulVotesCount: number | null;
  sentiment: Sentiment;
  sentimentReason: string;
  topics: ReviewTopic[];
  guest: {
    username: string | null;
    countryName: string | null;
    guestType: string | null;
  } | null;
  stay: {
    roomName: string | null;
    customerType: string | null;
    numNights: number | null;
    checkinDate: string | null;
    checkoutDate: string | null;
  } | null;
}

export interface ReviewPage {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  items: ReviewItem[];
}

export interface FilterOptions {
  properties: Array<{
    propertyKey: string;
    propertyName: string;
    status: PropertyMetric["status"];
  }>;
  dateBounds: {
    min: string | null;
    max: string | null;
  };
  topics: Array<{ topic: TopicKey; label: string }>;
  languages: string[];
  guestTypes: string[];
  roomTypes: string[];
}

export interface QualityProperty {
  propertyKey: string;
  propertyName: string;
  status: PropertyMetric["status"];
  retrievableCount: number | null;
  advertisedCount: number | null;
  sourceGap: number;
  publicationGeneration: number | null;
  parserVersion: string | null;
  publishedAtUtc: string | null;
  inventoriesMatch: boolean | null;
  recordsMatch: boolean | null;
  sourceDiscrepancy: {
    sourceDiscrepancyKind: string;
    advertisedReviews: number;
    retrievableReviews: number;
    sourceReviewGap: number;
    sourceDiscrepancyScoreBucket: string;
    advertisedBucketReviews: number;
    retrievableBucketReviews: number;
  } | null;
  note: string;
}

export interface QualitySummary {
  overallStatus: "verified" | "attention" | "collecting" | "error";
  databaseIntegrity: "ok" | "unknown" | "error";
  classifierVersion: string;
  collectionMethod: string;
  generatedAtUtc: string;
  properties: QualityProperty[];
}

export interface DashboardPayload {
  contractVersion: number;
  timezone: "Australia/Sydney";
  overview: OverviewMetrics;
  trends: TrendPoint[];
  scoreDistribution: ScoreBucket[];
  properties: PropertyMetric[];
  topics: TopicMetric[];
  reviews: ReviewPage;
  filterOptions: FilterOptions;
  quality: QualitySummary;
}

export interface ReviewQuery {
  page: number;
  pageSize: number;
  query: string;
  propertyKeys: string[];
  from: string;
  to: string;
  minScore: number;
  maxScore: number;
  sentiments: Sentiment[];
  topics: TopicKey[];
  language: string;
  guestType: string;
  roomType: string;
  sort:
    | "newest"
    | "oldest"
    | "highest"
    | "lowest"
    | "most_helpful";
}
