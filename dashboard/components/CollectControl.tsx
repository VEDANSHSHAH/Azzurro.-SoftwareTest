"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  DownloadCloud,
  Loader2,
  X,
} from "lucide-react";
import {
  cancelCollection,
  fetchCollectStatus,
  startCollection,
  type CollectPropertyProgress,
  type CollectStatus,
} from "../lib/collect-client";

const POLL_INTERVAL_MS = 1500;

export interface CollectController {
  status: CollectStatus | null;
  running: boolean;
  busy: boolean;
  error: string | null;
  start: () => void;
  cancel: () => void;
  dismiss: () => void;
  visible: boolean;
}

/*
 * Owns the collect job lifecycle for the dashboard. Polling only runs while a
 * job is active, so an idle dashboard makes one request and then stops.
 */
export function useCollectJob(onPublished: () => void): CollectController {
  const [status, setStatus] = useState<CollectStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const previousState = useRef<string | null>(null);
  const onPublishedRef = useRef(onPublished);

  useEffect(() => {
    onPublishedRef.current = onPublished;
  }, [onPublished]);

  const running = status?.state === "running";

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchCollectStatus(signal);
      setStatus(next);
      /* Reload dashboard data the moment a run stops publishing. */
      if (
        previousState.current === "running" &&
        next.state !== "running"
      ) {
        onPublishedRef.current();
      }
      previousState.current = next.state;
    } catch {
      /* A missing collect endpoint must not break the dashboard. */
    }
  }, []);

  /* Subscribing to the collector's state is exactly the external-system case
     effects exist for; the state lands in an async callback, not in render. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const start = useCallback(() => {
    setError(null);
    setDismissed(false);
    setBusy(true);
    startCollection()
      .then((next) => {
        setStatus(next);
        previousState.current = next.state;
      })
      .catch((startError: unknown) => {
        setError(
          startError instanceof Error
            ? startError.message
            : "The collection could not be started.",
        );
      })
      .finally(() => setBusy(false));
  }, []);

  const cancel = useCallback(() => {
    setBusy(true);
    cancelCollection()
      .then(setStatus)
      .catch((cancelError: unknown) => {
        setError(
          cancelError instanceof Error
            ? cancelError.message
            : "The collection could not be stopped.",
        );
      })
      .finally(() => setBusy(false));
  }, []);

  return {
    status,
    running,
    busy,
    error,
    start,
    cancel,
    dismiss: () => setDismissed(true),
    visible: Boolean(status?.job) && !dismissed,
  };
}

export function CollectButton({
  controller,
  variant = "secondary",
  label = "Collect reviews",
}: {
  controller: CollectController;
  variant?: "primary" | "secondary";
  label?: string;
}) {
  const { running, busy, start } = controller;
  return (
    <button
      className={`button button--${variant} collect-button`}
      disabled={running || busy}
      onClick={start}
      title="Run the Booking.com collector for every configured property. A browser window opens so you can complete any verification step."
      type="button"
    >
      {running || busy ? (
        <Loader2 aria-hidden="true" className="is-spinning" size={16} />
      ) : (
        <DownloadCloud aria-hidden="true" size={16} />
      )}
      {running ? "Collecting…" : label}
    </button>
  );
}

function propertyLabel(property: CollectPropertyProgress) {
  if (property.state === "published") {
    return `${property.reviewCount ?? 0} reviews published`;
  }
  if (property.state === "failed") {
    return property.error?.message || property.error?.code || "Failed";
  }
  if (property.state === "cancelled") return "Cancelled";
  if (property.state === "not_collected") return "Not collected";
  if (property.state === "queued") return "Waiting";
  if (property.pass === "verifying") return "Verifying…";
  if (property.expectedCount) {
    const pass = property.pass === "newest-first" ? "pass 2 of 2" : "pass 1 of 2";
    return `${property.processedCount} of ${property.expectedCount} · ${pass}`;
  }
  return "Starting…";
}

function propertyPercent(property: CollectPropertyProgress) {
  if (property.state === "published") return 100;
  if (!property.expectedCount || property.expectedCount === 0) return 0;
  /* Two full passes make one complete property. */
  const passOffset = property.pass === "newest-first" ? 0.5 : 0;
  const within =
    Math.min(property.processedCount / property.expectedCount, 1) * 0.5;
  return Math.round((passOffset + within) * 100);
}

export function CollectProgress({
  controller,
  names,
}: {
  controller: CollectController;
  names: Record<string, string>;
}) {
  const { status, running, busy, cancel, dismiss, error, visible } = controller;
  const job = status?.job;
  if (!visible || !job) {
    return error ? (
      <div className="collect-panel collect-panel--failed" role="alert">
        <CircleAlert aria-hidden="true" size={18} />
        <p>{error}</p>
      </div>
    ) : null;
  }

  const headline =
    job.state === "running"
      ? "Collecting reviews from Booking.com"
      : job.state === "succeeded"
        ? "Collection complete"
        : job.state === "cancelled"
          ? "Collection cancelled"
          : "Collection did not finish";
  const Icon =
    job.state === "running"
      ? Loader2
      : job.state === "succeeded"
        ? CircleCheck
        : job.state === "cancelled"
          ? CircleSlash
          : CircleAlert;

  return (
    <section
      aria-live="polite"
      className={`collect-panel collect-panel--${job.state}`}
    >
      <header className="collect-panel__head">
        <span className="collect-panel__title">
          <Icon
            aria-hidden="true"
            className={job.state === "running" ? "is-spinning" : ""}
            size={18}
          />
          {headline}
        </span>
        {running ? (
          <button
            className="button button--ghost"
            disabled={busy}
            onClick={cancel}
            type="button"
          >
            Stop
          </button>
        ) : (
          <button
            aria-label="Dismiss collection summary"
            className="icon-button"
            onClick={dismiss}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        )}
      </header>

      {running ? (
        <p className="collect-panel__hint">
          A browser window is open. If Booking shows a verification step,
          complete it there and collection continues automatically. Each
          property is read twice for accuracy, so this takes several minutes.
        </p>
      ) : null}
      {error ? <p className="collect-panel__hint">{error}</p> : null}

      <ul className="collect-panel__list">
        {job.properties.map((property) => (
          <li
            className={`collect-row collect-row--${property.state}`}
            key={property.propertyKey}
          >
            <span className="collect-row__name">
              {names[property.propertyKey] ?? property.propertyKey}
            </span>
            <span className="collect-row__meter" aria-hidden="true">
              <span
                className="collect-row__fill"
                style={{ width: `${propertyPercent(property)}%` }}
              />
            </span>
            <span className="collect-row__status">
              {propertyLabel(property)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
