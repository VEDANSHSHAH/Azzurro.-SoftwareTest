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
import type { PropertyMetric } from "../../lib/types";
import { useReducedMotion } from "../../lib/use-reduced-motion";

interface CategoryDefinition {
  key: string;
  label: string;
  shortLabel: string;
}

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  { key: "staff", label: "Staff", shortLabel: "Staff" },
  { key: "facilities", label: "Facilities", shortLabel: "Facilities" },
  { key: "cleanliness", label: "Cleanliness", shortLabel: "Clean" },
  { key: "comfort", label: "Comfort", shortLabel: "Comfort" },
  { key: "value", label: "Value for money", shortLabel: "Value" },
  { key: "location", label: "Location", shortLabel: "Location" },
  { key: "wifi", label: "Free Wifi", shortLabel: "Wi-Fi" },
];

const CATEGORY_ALIASES: Record<string, string> = {
  staff: "staff",
  facilities: "facilities",
  cleanliness: "cleanliness",
  comfort: "comfort",
  value: "value",
  "value for money": "value",
  location: "location",
  wifi: "wifi",
  "wi fi": "wifi",
  "free wifi": "wifi",
  "free wi fi": "wifi",
};

const PROPERTY_COLORS = ["#0f2a4d", "#e01858", "#1c7e62", "#b97814"];

function normalizedCategoryName(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function categoryKey(name: string) {
  const normalized = normalizedCategoryName(name);
  return CATEGORY_ALIASES[normalized] ?? `source:${normalized}`;
}

function shortCategoryLabel(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 15 ? `${trimmed.slice(0, 13)}…` : trimmed;
}

function categoryDefinitions(properties: PropertyMetric[]) {
  const availableKeys = new Set<string>();
  const unknown = new Map<string, CategoryDefinition>();
  for (const property of properties) {
    for (const category of property.categoryScores) {
      const key = categoryKey(category.name);
      availableKeys.add(key);
      if (key.startsWith("source:") && !unknown.has(key)) {
        unknown.set(key, {
          key,
          label: category.name.trim(),
          shortLabel: shortCategoryLabel(category.name),
        });
      }
    }
  }
  return [
    ...CATEGORY_DEFINITIONS.filter((category) =>
      availableKeys.has(category.key),
    ),
    ...[...unknown.values()].sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
  ];
}

function scoreMap(property: PropertyMetric) {
  const scores = new Map<string, number>();
  for (const category of property.categoryScores) {
    scores.set(categoryKey(category.name), category.score);
  }
  return scores;
}

function shortPropertyName(property: PropertyMetric) {
  const name = property.propertyName;
  if (/olympic/i.test(name)) return "Olympic Paddington";
  if (/potts/i.test(name)) return "Potts Point";
  if (/darling/i.test(name)) return "Darling Harbour";
  if (/central/i.test(name)) return "Central Sydney";
  return name;
}

function chartTooltipFormatter(value: unknown, name: unknown) {
  return [
    value == null ? "Not available" : `${Number(value).toFixed(1)} / 10`,
    String(name),
  ];
}

export function BookingCategoryPortfolioChart({
  data,
}: {
  data: PropertyMetric[];
}) {
  const reducedMotion = useReducedMotion();
  const properties = data.filter(
    (property) => property.categoryScores.length > 0,
  );
  const scoreMaps = new Map(
    properties.map((property) => [property.propertyKey, scoreMap(property)]),
  );
  const categories = categoryDefinitions(properties);
  const rows = categories.map((category) => {
    const row: Record<string, string | number | null> = {
      category: category.shortLabel,
      fullCategory: category.label,
    };
    for (const property of properties) {
      row[property.propertyKey] =
        scoreMaps.get(property.propertyKey)?.get(category.key) ?? null;
    }
    return row;
  });

  if (properties.length === 0 || rows.length === 0) {
    return (
      <p className="muted-copy">
        Booking category scores are not available for the accepted
        publications.
      </p>
    );
  }

  const omittedProperties = data.filter(
    (property) => property.categoryScores.length === 0,
  );

  return (
    <div className="category-chart">
      <div aria-hidden="true" className="chart chart--category">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ bottom: 8, left: 12, right: 18, top: 12 }}
          >
            <CartesianGrid
              horizontal={false}
              stroke="#ece8df"
              strokeDasharray="3 5"
            />
            <XAxis
              axisLine={false}
              domain={[0, 10]}
              fontSize={11}
              tick={{ fill: "#697386" }}
              tickLine={false}
              ticks={[0, 2, 4, 6, 8, 10]}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="category"
              fontSize={10}
              tick={{ fill: "#485568" }}
              tickLine={false}
              type="category"
              width={94}
            />
            <Tooltip
              contentStyle={{
                border: "1px solid #e8e4dc",
                borderRadius: 12,
                fontFamily: "Poppins, sans-serif",
                fontSize: 12,
              }}
              formatter={chartTooltipFormatter}
              labelFormatter={(_, payload) =>
                String(payload?.[0]?.payload?.fullCategory ?? "")
              }
            />
            <Legend
              align="right"
              iconSize={8}
              iconType="circle"
              verticalAlign="top"
              wrapperStyle={{ fontSize: 11, paddingBottom: 12 }}
            />
            {properties.map((property, index) => (
              <Bar
                animationBegin={index * 80}
                animationDuration={760}
                animationEasing="ease-out"
                dataKey={property.propertyKey}
                fill={PROPERTY_COLORS[index % PROPERTY_COLORS.length]}
                isAnimationActive={!reducedMotion}
                key={property.propertyKey}
                name={shortPropertyName(property)}
                radius={[0, 4, 4, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table>
          <caption>Exact Booking category scores by accepted property</caption>
          <thead>
            <tr>
              <th>Category</th>
              {properties.map((property) => (
                <th key={property.propertyKey}>{property.propertyName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.key}>
                <th>{category.label}</th>
                {properties.map((property) => {
                  const score =
                    scoreMaps.get(property.propertyKey)?.get(category.key);
                  return (
                    <td key={property.propertyKey}>
                      {score == null ? "Not published" : score.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="category-chart-note">
        A missing bar means Booking did not publish that category; it is not a
        zero.
        {omittedProperties.length > 0
          ? ` ${omittedProperties
              .map((property) => shortPropertyName(property))
              .join(", ")} ${
              omittedProperties.length === 1 ? "is" : "are"
            } omitted until accepted source category scores are available.`
          : ""}
      </p>
    </div>
  );
}
