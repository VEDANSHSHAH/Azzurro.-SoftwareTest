"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "../../lib/types";
import { useReducedMotion } from "../../lib/use-reduced-motion";

const TOOLTIP_STYLE = {
  border: "1px solid #e8e4dc",
  borderRadius: "12px",
  boxShadow: "0 12px 32px rgba(15, 42, 77, 0.12)",
  color: "#0f2a4d",
  fontFamily: "Poppins, sans-serif",
  fontSize: "12px",
};

export function RatingTrendChart({ data }: { data: TrendPoint[] }) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      aria-label="Weekly average rating trend"
      className="chart chart--large"
      role="img"
    >
      <ResponsiveContainer height="100%" width="100%">
        <ComposedChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="#ece8df" strokeDasharray="3 5" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="label"
            fontSize={11}
            tick={{ fill: "#697386" }}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            domain={[0, 10]}
            fontSize={11}
            tick={{ fill: "#697386" }}
            tickLine={false}
            ticks={[0, 2, 4, 6, 8, 10]}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [
              value == null ? "No reviews" : Number(value).toFixed(2),
              "Average rating",
            ]}
            labelFormatter={(label) => `Week of ${label}`}
          />
          <Line
            animationDuration={850}
            animationEasing="ease-out"
            connectNulls={false}
            dataKey="average"
            dot={{ fill: "#ffffff", r: 3, stroke: "#e01858", strokeWidth: 2 }}
            name="Average rating"
            stroke="#e01858"
            strokeWidth={3}
            type="monotone"
            isAnimationActive={!reducedMotion}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
