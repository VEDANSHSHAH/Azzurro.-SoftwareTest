"use client";

import { CalendarRange, Check, ChevronDown, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  DashboardFilters,
  FilterOptions,
} from "../lib/types";
import { formatLocalDate } from "../lib/format";
import { publicationStatusLabel } from "../lib/publication-status";

interface GlobalFiltersProps {
  filters: DashboardFilters;
  options: FilterOptions | null;
  onChange: (filters: DashboardFilters) => void;
  onReset: () => void;
}

export function GlobalFilters({
  filters,
  options,
  onChange,
  onReset,
}: GlobalFiltersProps) {
  const [propertyMenuOpen, setPropertyMenuOpen] = useState(false);
  const propertyMenu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (
        propertyMenu.current &&
        !propertyMenu.current.contains(event.target as Node)
      ) {
        setPropertyMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const selectedNames =
    filters.propertyKeys.length === 0
      ? "All properties"
      : options?.properties
          .filter((property) =>
            filters.propertyKeys.includes(property.propertyKey),
          )
          .map((property) => property.propertyName)
          .join(", ") || "Selected properties";

  return (
    <section aria-label="Dashboard filters" className="global-filters">
      <div className="global-filters__group" ref={propertyMenu}>
        <label id="property-filter-label">Property</label>
        <button
          aria-expanded={propertyMenuOpen}
          aria-labelledby="property-filter-label"
          className="filter-trigger"
          onClick={() => setPropertyMenuOpen((value) => !value)}
          type="button"
        >
          <span className="filter-trigger__value">{selectedNames}</span>
          <ChevronDown aria-hidden="true" size={16} />
        </button>
        {propertyMenuOpen ? (
          <div className="property-menu" role="menu">
            <button
              className={
                filters.propertyKeys.length === 0 ? "is-selected" : ""
              }
              onClick={() =>
                onChange({ ...filters, propertyKeys: [] })
              }
              role="menuitemcheckbox"
              aria-checked={filters.propertyKeys.length === 0}
              type="button"
            >
              <span>
                <strong>All properties</strong>
                <small>Combined portfolio view</small>
              </span>
              {filters.propertyKeys.length === 0 ? (
                <Check aria-hidden="true" size={16} />
              ) : null}
            </button>
            {options?.properties.map((property) => {
              const selected = filters.propertyKeys.includes(
                property.propertyKey,
              );
              return (
                <button
                  aria-checked={selected}
                  className={selected ? "is-selected" : ""}
                  key={property.propertyKey}
                  onClick={() => {
                    const propertyKeys = selected
                      ? filters.propertyKeys.filter(
                          (key) => key !== property.propertyKey,
                        )
                      : [...filters.propertyKeys, property.propertyKey];
                    onChange({ ...filters, propertyKeys });
                  }}
                  role="menuitemcheckbox"
                  type="button"
                >
                  <span>
                    <strong>{property.propertyName}</strong>
                    <small>{publicationStatusLabel(property.status)}</small>
                  </span>
                  {selected ? <Check aria-hidden="true" size={16} /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="global-filters__group">
        <label htmlFor="date-from">From</label>
        <div className="date-field">
          <CalendarRange aria-hidden="true" size={16} />
          <input
            id="date-from"
            max={filters.to || options?.dateBounds.max || undefined}
            min={options?.dateBounds.min || undefined}
            onChange={(event) =>
              onChange({ ...filters, from: event.target.value })
            }
            type="date"
            value={filters.from}
          />
        </div>
      </div>

      <div className="global-filters__group">
        <label htmlFor="date-to">To</label>
        <div className="date-field">
          <CalendarRange aria-hidden="true" size={16} />
          <input
            id="date-to"
            max={options?.dateBounds.max || undefined}
            min={filters.from || options?.dateBounds.min || undefined}
            onChange={(event) =>
              onChange({ ...filters, to: event.target.value })
            }
            type="date"
            value={filters.to}
          />
        </div>
      </div>

      <div className="global-filters__summary">
        <span>
          {filters.from && filters.to
            ? `${formatLocalDate(filters.from, true)} – ${formatLocalDate(
                filters.to,
                true,
              )}`
            : filters.from
              ? `From ${formatLocalDate(filters.from, true)}`
              : filters.to
                ? `Through ${formatLocalDate(filters.to, true)}`
                : "All available review dates"}
        </span>
        <button className="text-button" onClick={onReset} type="button">
          <RotateCcw aria-hidden="true" size={14} />
          Reset
        </button>
      </div>
    </section>
  );
}
