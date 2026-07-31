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
import type { PropertyMetric } from "../../lib/types";
import { useReducedMotion } from "../../lib/use-reduced-motion";

export function PropertyComparisonChart({
  data,
}: {
  data: PropertyMetric[];
}) {
  const reducedMotion = useReducedMotion();
  const rows = data.map((property) => ({
    name: property.propertyName
      .replace("Olympic ", "Olympic\n")
      .replace("Darling ", "Darling\n")
      .replace("Central ", "Central\n"),
    current: property.currentWeekAverage,
    previous: property.previousWeekAverage,
  }));
  return (
    <div
      aria-label="Current and previous week rating comparison by property"
      className="chart chart--medium"
      role="img"
    >
      <ResponsiveContainer height="100%" width="100%">
        <BarChart data={rows} margin={{ bottom: 8, left: -18, right: 8 }}>
          <CartesianGrid stroke="#ece8df" strokeDasharray="3 5" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="name"
            fontSize={10}
            interval={0}
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
            contentStyle={{
              border: "1px solid #e8e4dc",
              borderRadius: 12,
              fontFamily: "Poppins, sans-serif",
              fontSize: 12,
            }}
            formatter={(value, name) => [
              value == null ? "No reviews" : Number(value).toFixed(2),
              name === "current" ? "Current week" : "Previous week",
            ]}
          />
          <Bar
            animationDuration={700}
            animationEasing="ease-out"
            dataKey="previous"
            fill="#d8dce4"
            name="previous"
            radius={[5, 5, 0, 0]}
            isAnimationActive={!reducedMotion}
          />
          <Bar
            animationBegin={90}
            animationDuration={760}
            animationEasing="ease-out"
            dataKey="current"
            fill="#0f2a4d"
            name="current"
            radius={[5, 5, 0, 0]}
            isAnimationActive={!reducedMotion}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
