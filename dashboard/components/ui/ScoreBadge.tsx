import { scoreTone } from "../../lib/format";

export function ScoreBadge({
  score,
  size = "regular",
}: {
  score: number;
  size?: "small" | "regular" | "large";
}) {
  return (
    <span
      aria-label={`Review score ${score.toFixed(1)} out of 10`}
      className={`score-badge score-badge--${scoreTone(score)} score-badge--${size}`}
    >
      {score.toFixed(1)}
    </span>
  );
}
