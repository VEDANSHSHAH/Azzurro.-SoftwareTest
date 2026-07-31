const DEFAULT_API_ORIGIN =
  process.env.NEXT_PUBLIC_AZZURO_API_ORIGIN ?? "http://127.0.0.1:4318";

export type CollectPropertyState =
  | "queued"
  | "collecting"
  | "published"
  | "failed"
  | "cancelled"
  | "not_collected";

export type CollectJobState =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface CollectPropertyProgress {
  propertyKey: string;
  state: CollectPropertyState;
  pass: string | null;
  processedCount: number;
  expectedCount: number | null;
  reviewCount: number | null;
  error: { code: string; message: string } | null;
}

export interface CollectJob {
  jobId: string;
  state: CollectJobState;
  startedAt: string;
  finishedAt: string | null;
  requestedProperties: string[];
  properties: CollectPropertyProgress[];
  log: string[];
  exitCode: number | null;
  error: { code: string; message: string } | null;
}

export interface CollectStatus {
  state: CollectJobState | "idle";
  job: CollectJob | null;
}

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload.error === "string"
    ? payload.error
    : `${fallback} (${response.status})`;
}

export async function fetchCollectStatus(signal?: AbortSignal) {
  const response = await fetch(`${DEFAULT_API_ORIGIN}/api/collect`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Collection status unavailable"));
  }
  return (await response.json()) as CollectStatus;
}

export async function startCollection(properties?: string[]) {
  const response = await fetch(`${DEFAULT_API_ORIGIN}/api/collect`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      /* Required by the data service; a cross-site page cannot set it. */
      "x-azzurro-collect": "1",
    },
    body: JSON.stringify(properties?.length ? { properties } : {}),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Collection could not start"));
  }
  return (await response.json()) as CollectStatus;
}

export async function cancelCollection() {
  const response = await fetch(`${DEFAULT_API_ORIGIN}/api/collect`, {
    method: "DELETE",
    headers: { Accept: "application/json", "x-azzurro-collect": "1" },
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Collection could not be stopped"));
  }
  return (await response.json()) as CollectStatus;
}
