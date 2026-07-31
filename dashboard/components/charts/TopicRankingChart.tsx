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
import type { TopicMetric } from "../../lib/types";
import { useReducedMotion } from "../../lib/use-reduced-motion";

export function TopicRankingChart({ data }: { data: TopicMetric[] }) {
  const reducedMotion = useReducedMotion();
  const rows = [...data]
    .sort(
      (left, right) =>
        (right.negativeMentionShare ?? -1) -
        (left.negativeMentionShare ?? -1),
    )
    .map((topic) => ({
      label: topic.label,
      share: topic.negativeMentionShare,
      count: topic.negativeMentionCount,
    }));
  return (
    <div
      aria-label="Negative review topic ranking"
      className="chart chart--topic"
      role="img"
    >
      <ResponsiveContainer height="100%" width="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ bottom: 8, left: 18, right: 24, top: 8 }}
        >
          <CartesianGrid stroke="#ece8df" strokeDasharray="3 5" horizontal={false} />
          <XAxis
            axisLine={false}
            domain={[0, 100]}
            fontSize={11}
            tick={{ fill: "#697386" }}
            tickFormatter={(value) => `${value}%`}
            tickLine={false}
            type="number"
          />
          <YAxis
            axisLine={false}
            dataKey="label"
            fontSize={11}
            tick={{ fill: "#334155" }}
            tickLine={false}
            type="category"
            width={104}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid #e8e4dc",
              borderRadius: 12,
              fontFamily: "Poppins, sans-serif",
              fontSize: 12,
            }}
            formatter={(value) => [
              value == null
                ? "No negative feedback"
                : `${Number(value).toFixed(0)}%`,
              "Negative feedback mentioning topic",
            ]}
          />
          <Bar
            animationDuration={820}
            animationEasing="ease-out"
            dataKey="share"
            fill="#e01858"
            isAnimationActive={!reducedMotion}
            radius={[0, 6, 6, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
