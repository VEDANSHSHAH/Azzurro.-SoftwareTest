import {
  AlertTriangle,
  Database,
  Inbox,
  RefreshCw,
} from "lucide-react";

export function LoadingState() {
  return (
    <div aria-live="polite" className="page-state page-state--loading">
      <div className="loading-mark">
        <span />
        <span />
        <span />
      </div>
      <div>
        <strong>Preparing the verified view</strong>
        <p>Calculating metrics from the latest accepted publications.</p>
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="page-state page-state--error" role="alert">
      <span className="page-state__icon">
        <AlertTriangle aria-hidden="true" size={24} />
      </span>
      <div>
        <strong>The dashboard data could not be loaded</strong>
        <p>{message}</p>
        <button className="button button--primary" onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={15} />
          Try again
        </button>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  compact = false,
}: {
  title: string;
  detail: string;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "empty-state--compact" : ""}`}>
      <Inbox aria-hidden="true" size={compact ? 20 : 28} />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function NoPublishedDataState() {
  return (
    <div className="page-state">
      <span className="page-state__icon">
        <Database aria-hidden="true" size={24} />
      </span>
      <div>
        <strong>No accepted property publications yet</strong>
        <p>
          Run the accuracy-first collector, then refresh this view. Unverified
          scrape attempts are never shown as dashboard data.
        </p>
      </div>
    </div>
  );
}
