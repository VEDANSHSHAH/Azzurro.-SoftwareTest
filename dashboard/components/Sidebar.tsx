"use client";

import {
  BarChart3,
  Building2,
  ChartNoAxesCombined,
  ClipboardCheck,
  LayoutDashboard,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  X,
} from "lucide-react";
import type { DashboardView } from "../lib/types";

const NAV_ITEMS: Array<{
  id: DashboardView;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}> = [
  {
    id: "overview",
    label: "Overview",
    description: "This week at a glance",
    icon: LayoutDashboard,
  },
  {
    id: "trends",
    label: "Trends",
    description: "Ratings and sentiment",
    icon: ChartNoAxesCombined,
  },
  {
    id: "properties",
    label: "Properties",
    description: "Compare locations",
    icon: Building2,
  },
  {
    id: "insights",
    label: "Review insights",
    description: "Operational topics",
    icon: Sparkles,
  },
  {
    id: "reviews",
    label: "Reviews",
    description: "Read and filter feedback",
    icon: MessageSquareText,
  },
  {
    id: "quality",
    label: "Data quality",
    description: "Collection confidence",
    icon: ClipboardCheck,
  },
];

interface SidebarProps {
  activeView: DashboardView;
  collapsed: boolean;
  open: boolean;
  onClose: () => void;
  onCollapseToggle: () => void;
  onViewChange: (view: DashboardView) => void;
}

export function Sidebar({
  activeView,
  collapsed,
  open,
  onClose,
  onCollapseToggle,
  onViewChange,
}: SidebarProps) {
  return (
    <>
      <button
        aria-label="Close navigation"
        className={`sidebar-backdrop ${open ? "is-visible" : ""}`}
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label="Main navigation"
        className={`sidebar ${open ? "is-open" : ""} ${
          collapsed ? "is-collapsed" : ""
        }`}
      >
        <div className="sidebar__brand">
          <button
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="icon-button sidebar__collapse"
            onClick={onCollapseToggle}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            type="button"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" size={18} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={18} />
            )}
          </button>
          <button
            aria-label="Close navigation"
            className="icon-button sidebar__close"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
          <div aria-label="Azzurro" className="brand-wordmark">
            <span className="brand-wordmark__full">
              Azzurro<em>.</em>
            </span>
            <span aria-hidden="true" className="brand-wordmark__compact">
              A<em>.</em>
            </span>
          </div>
          <div className="brand-product">
            <BarChart3 aria-hidden="true" size={15} />
            Review intelligence
          </div>
        </div>

        <nav className="sidebar__nav">
          <p className="sidebar__eyebrow">Operations workspace</p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeView;
            return (
              <button
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`nav-item ${active ? "is-active" : ""}`}
                key={item.id}
                onClick={() => {
                  onViewChange(item.id);
                  onClose();
                }}
                title={collapsed ? item.label : undefined}
                type="button"
              >
                <span className="nav-item__icon">
                  <Icon aria-hidden="true" size={19} strokeWidth={1.9} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="source-pill">
            <span className="source-pill__dot" />
            <span className="source-pill__label">Booking.com reviews</span>
          </div>
          <p>Australia/Sydney reporting</p>
        </div>
      </aside>
    </>
  );
}
