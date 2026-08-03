import type { PropertyMetric } from "./types";

export const SOURCE_GAP_VERIFIED_LABEL =
  "Verified with Booking count disclosure";

export function isAcceptedPublication(
  status: PropertyMetric["status"],
) {
  return status === "verified" || status === "source-gap";
}

export function publicationStatusLabel(
  status: PropertyMetric["status"],
) {
  if (status === "verified") return "Verified";
  if (status === "source-gap") return SOURCE_GAP_VERIFIED_LABEL;
  if (status === "evidence-error") return "Evidence needs attention";
  if (status === "collecting") return "Pending verification";
  return "Unavailable";
}
