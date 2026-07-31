import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Info,
} from "lucide-react";
import type { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: string;
  supportingText: string;
  deltaText: string;
  deltaDirection: "up" | "down" | "flat" | "unavailable";
  goodDirection?: "up" | "down";
  icon: ReactNode;
  tone?: "navy" | "pink" | "green" | "amber";
}

export function KpiCard({
  label,
  value,
  supportingText,
  deltaText,
  deltaDirection,
  goodDirection = "up",
  icon,
  tone = "navy",
}: KpiCardProps) {
  const isGood =
    deltaDirection !== "unavailable" &&
    deltaDirection !== "flat" &&
    deltaDirection === goodDirection;
  const isBad =
    deltaDirection !== "unavailable" &&
    deltaDirection !== "flat" &&
    deltaDirection !== goodDirection;
  const DeltaIcon =
    deltaDirection === "up"
      ? ArrowUpRight
      : deltaDirection === "down"
        ? ArrowDownRight
        : deltaDirection === "flat"
          ? ArrowRight
          : Info;

  return (
    <article className={`kpi-card kpi-card--${tone}`}>
      <div className="kpi-card__top">
        <span className="kpi-card__icon">{icon}</span>
        <span
          className={`delta-chip ${
            isGood ? "is-good" : isBad ? "is-bad" : "is-neutral"
          }`}
        >
          <DeltaIcon aria-hidden="true" size={14} />
          {deltaText}
        </span>
      </div>
      <p className="kpi-card__label">{label}</p>
      <strong className="kpi-card__value">{value}</strong>
      <p className="kpi-card__support">{supportingText}</p>
    </article>
  );
}
