function percentile(sorted, probability) {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(probability * sorted.length) - 1),
  );
  return sorted[index];
}

export class RunMetrics {
  #startedAt = performance.now();
  #latencies = [];
  #pages = 0;
  #reviews = 0;
  #bytes = 0;
  #retries = 0;

  recordPage({ latencyMs, cardCount, responseBytes = 0, retries = 0 }) {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) {
      throw new Error("latencyMs must be a non-negative number");
    }
    this.#latencies.push(latencyMs);
    this.#pages += 1;
    this.#reviews += cardCount;
    this.#bytes += responseBytes;
    this.#retries += retries;
  }

  snapshot() {
    const durationMs = Math.max(1, Math.round(performance.now() - this.#startedAt));
    const sorted = [...this.#latencies].sort((a, b) => a - b);
    return {
      durationMs,
      pages: this.#pages,
      reviewOccurrences: this.#reviews,
      responseBytes: this.#bytes,
      retries: this.#retries,
      pageLatencyMs: {
        min: sorted[0] ?? null,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.at(-1) ?? null,
      },
      pagesPerMinute: Number(
        ((this.#pages * 60_000) / durationMs).toFixed(2),
      ),
      reviewOccurrencesPerMinute: Number(
        ((this.#reviews * 60_000) / durationMs).toFixed(2),
      ),
    };
  }
}

