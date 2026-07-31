"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScoreBucket } from "../../lib/types";
import { useReducedMotion } from "../../lib/use-reduced-motion";

export function ScoreDistributionChart({ data }: { data: ScoreBucket[] }) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      aria-label="Review score distribution"
      className="chart chart--medium"
      role="img"
    >
      <ResponsiveContainer height="100%" width="100%">
        <BarChart data={data} margin={{ left: -18, right: 8, top: 8 }}>
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
            fontSize={11}
            tick={{ fill: "#697386" }}
            tickFormatter={(value) => new Intl.NumberFormat("en-AU", {
              notation: "compact",
            }).format(value)}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid #e8e4dc",
              borderRadius: 12,
              fontFamily: "Poppins, sans-serif",
              fontSize: 12,
            }}
            formatter={(value) => [
              new Intl.NumberFormat("en-AU").format(Number(value)),
              "Reviews",
            ]}
          />
          <Bar
            animationDuration={760}
            animationEasing="ease-out"
            dataKey="count"
            fill="#ec3878"
            isAnimationActive={!reducedMotion}
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
