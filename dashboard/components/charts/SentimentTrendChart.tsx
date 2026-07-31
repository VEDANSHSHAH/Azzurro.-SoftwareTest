"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "../../lib/types";
import { useReducedMotion } from "../../lib/use-reduced-motion";

export function SentimentTrendChart({ data }: { data: TrendPoint[] }) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      aria-label="Positive, mixed, negative, and unclassified review share by week"
      className="chart chart--large"
      role="img"
    >
      <ResponsiveContainer height="100%" width="100%">
        <BarChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
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
            domain={[0, 100]}
            fontSize={11}
            tick={{ fill: "#697386" }}
            tickFormatter={(value) => `${value}%`}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid #e8e4dc",
              borderRadius: 12,
              fontFamily: "Poppins, sans-serif",
              fontSize: 12,
            }}
            formatter={(value, name) => [
              value == null ? "No reviews" : `${Number(value).toFixed(0)}%`,
              name,
            ]}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
          />
          <Bar
            animationDuration={760}
            animationEasing="ease-out"
            dataKey="positiveShare"
            fill="#238b69"
            name="Positive"
            radius={[0, 0, 0, 0]}
            stackId="sentiment"
            isAnimationActive={!reducedMotion}
          />
          <Bar
            animationBegin={45}
            animationDuration={760}
            animationEasing="ease-out"
            dataKey="mixedShare"
            fill="#e4ad4e"
            name="Mixed"
            stackId="sentiment"
            isAnimationActive={!reducedMotion}
          />
          <Bar
            animationBegin={90}
            animationDuration={760}
            animationEasing="ease-out"
            dataKey="negativeShare"
            fill="#e45c77"
            name="Negative"
            stackId="sentiment"
            isAnimationActive={!reducedMotion}
          />
          <Bar
            animationBegin={135}
            animationDuration={760}
            animationEasing="ease-out"
            dataKey="unclassifiedShare"
            fill="#98a2b2"
            name="Unclassified"
            radius={[4, 4, 0, 0]}
            stackId="sentiment"
            isAnimationActive={!reducedMotion}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
