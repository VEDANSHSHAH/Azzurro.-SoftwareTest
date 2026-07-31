export const SYDNEY_TIME_ZONE = "Australia/Sydney";

export function formatScore(value: number | null, digits = 1) {
  return value == null ? "—" : value.toFixed(digits);
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("en-AU").format(value);
}

export function formatPercent(value: number | null, digits = 0) {
  return value == null ? "—" : `${value.toFixed(digits)}%`;
}

export function formatDelta(
  value: number | null,
  { suffix = "", digits = 1 }: { suffix?: string; digits?: number } = {},
) {
  if (value == null) return "No comparison";
  if (Math.abs(value) < 10 ** -(digits + 1)) return "No change";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}${suffix}`;
}

export function formatLocalDate(value: string | null, compact = false) {
  if (!value) return "Not available";
  const date = new Date(`${value}T12:00:00+10:00`);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TIME_ZONE,
    day: "numeric",
    month: compact ? "short" : "long",
    year: "numeric",
  }).format(date);
}

export function formatShortDate(value: string) {
  const date = new Date(`${value}T12:00:00+10:00`);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TIME_ZONE,
    day: "numeric",
    month: "short",
  }).format(date);
}

export function scoreTone(score: number) {
  if (score >= 8) return "excellent";
  if (score >= 7) return "good";
  if (score >= 5) return "mixed";
  return "poor";
}

export function sentenceCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
