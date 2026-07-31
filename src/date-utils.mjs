const SYDNEY_ZONE = "Australia/Sydney";
const MAX_SUPPORTED_EPOCH_SECONDS = 253_402_300_799;
const sydneyPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SYDNEY_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function partsFor(date) {
  return Object.fromEntries(
    sydneyPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDateKey(dateKey) {
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error("dateKey must use YYYY-MM-DD");
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new Error("dateKey must be a valid calendar date");
  }
  return { year, month, day };
}

export function sydneyDateFromEpoch(epochSeconds) {
  if (
    !Number.isSafeInteger(epochSeconds) ||
    epochSeconds <= 0 ||
    epochSeconds > MAX_SUPPORTED_EPOCH_SECONDS
  ) {
    throw new Error(
      "epochSeconds must be a positive supported Unix timestamp",
    );
  }
  const date = new Date(epochSeconds * 1000);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("epochSeconds is outside the supported date range");
  }
  const parts = partsFor(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function mondayWeekStart(dateKey) {
  const { year, month, day } = parseDateKey(dateKey);
  const utcDate = new Date(0);
  utcDate.setUTCFullYear(year, month - 1, day);
  utcDate.setUTCHours(0, 0, 0, 0);
  const daysSinceMonday = (utcDate.getUTCDay() + 6) % 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - daysSinceMonday);
  return utcDate.toISOString().slice(0, 10);
}

export function sydneyWeekStartFromEpoch(epochSeconds) {
  return mondayWeekStart(sydneyDateFromEpoch(epochSeconds));
}
