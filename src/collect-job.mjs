import { spawn } from "node:child_process";
import { resolve } from "node:path";

/*
 * Runs the collector as a supervised child process on behalf of the local
 * dashboard, so an operations user can start a collection without a terminal.
 *
 * The collector itself is unchanged and stays the only thing that decides what
 * gets published. This module owns process lifecycle and progress reporting
 * only: it never touches the database, and it cannot cause a partial or
 * unverified publication.
 */

const MAX_LOG_LINES = 300;

// Booking's own progress vocabulary, printed by scripts/scrape.mjs.
const STARTED_PATTERN = /^\[[^\]]+\]\s+(?:full|canary):\s+(\S+)$/;
const PROGRESS_PATTERN =
  /^\[[^\]]+\]\s+progress:\s+(\S+)\s+(oldest-first|newest-first)\s+(\d+)\/(\d+)(\s+verified)?$/;
const FINAL_HEAD_PATTERN =
  /^\[[^\]]+\]\s+progress:\s+(\S+)\s+final head verified\s+\((\d+) cards\)$/;
const PASSED_PATTERN = /^\[[^\]]+\]\s+passed:\s+(\S+)\s+\((\d+) reviews\)$/;
const FAILED_PATTERN = /^\[[^\]]+\]\s+failed:\s+(\S+):\s+(\S+)\s*(.*)$/;

export class CollectJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CollectJobError";
    this.code = code;
  }
}

function emptyProperty(key) {
  return {
    propertyKey: key,
    state: "queued",
    pass: null,
    processedCount: 0,
    expectedCount: null,
    reviewCount: null,
    error: null,
  };
}

export function createCollectJobRunner({
  projectRoot,
  databasePath,
  propertiesPath,
  spawnChild = spawn,
  now = () => new Date(),
}) {
  let job = null;
  let child = null;

  function snapshot() {
    if (!job) return { state: "idle", job: null };
    return {
      state: job.state,
      job: {
        jobId: job.jobId,
        state: job.state,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        requestedProperties: job.requestedProperties,
        properties: job.properties.map((property) => ({ ...property })),
        log: job.log.slice(-40),
        exitCode: job.exitCode,
        error: job.error,
      },
    };
  }

  function property(key) {
    return job.properties.find((entry) => entry.propertyKey === key) ?? null;
  }

  function consumeLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    job.log.push(trimmed);
    if (job.log.length > MAX_LOG_LINES) {
      job.log.splice(0, job.log.length - MAX_LOG_LINES);
    }

    const started = STARTED_PATTERN.exec(trimmed);
    if (started) {
      const entry = property(started[1]);
      if (entry) entry.state = "collecting";
      return;
    }
    const progress = PROGRESS_PATTERN.exec(trimmed);
    if (progress) {
      const entry = property(progress[1]);
      if (entry) {
        entry.state = "collecting";
        entry.pass = progress[2];
        entry.processedCount = Number(progress[3]);
        entry.expectedCount = Number(progress[4]);
      }
      return;
    }
    const finalHead = FINAL_HEAD_PATTERN.exec(trimmed);
    if (finalHead) {
      const entry = property(finalHead[1]);
      if (entry) entry.pass = "verifying";
      return;
    }
    const passed = PASSED_PATTERN.exec(trimmed);
    if (passed) {
      const entry = property(passed[1]);
      if (entry) {
        entry.state = "published";
        entry.pass = null;
        entry.reviewCount = Number(passed[2]);
        entry.processedCount = Number(passed[2]);
      }
      return;
    }
    const failed = FAILED_PATTERN.exec(trimmed);
    if (failed) {
      const entry = property(failed[1]);
      if (entry) {
        entry.state = "failed";
        entry.pass = null;
        entry.error = { code: failed[2], message: failed[3] || failed[2] };
      }
    }
  }

  function pumpStream(stream, onLine) {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        onLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
      /* A single unterminated line must not grow without bound. */
      if (buffer.length > 8192) buffer = buffer.slice(-8192);
    });
    stream.on("end", () => {
      if (buffer.trim()) onLine(buffer);
    });
  }

  function finish(state, patch = {}) {
    if (!job || job.state !== "running") return;
    job.state = state;
    job.finishedAt = now().toISOString();
    Object.assign(job, patch);
    /* Anything still mid-flight when the process ended never published. */
    for (const entry of job.properties) {
      if (entry.state === "collecting" || entry.state === "queued") {
        entry.state = state === "cancelled" ? "cancelled" : "not_collected";
        entry.pass = null;
      }
    }
    child = null;
  }

  return {
    status: snapshot,

    isRunning() {
      return job?.state === "running";
    },

    start({ propertyKeys, headed = true, interactiveChallenge = true }) {
      if (job?.state === "running") {
        throw new CollectJobError(
          "COLLECT_ALREADY_RUNNING",
          "A collection is already running.",
        );
      }
      if (!Array.isArray(propertyKeys) || propertyKeys.length === 0) {
        throw new CollectJobError(
          "COLLECT_NO_PROPERTIES",
          "At least one property must be selected.",
        );
      }

      const args = [
        resolve(projectRoot, "scripts/scrape.mjs"),
        "--mode",
        "full",
        "--db",
        databasePath,
        "--properties",
        propertiesPath,
      ];
      for (const key of propertyKeys) args.push("--property", key);
      if (headed) args.push("--headed");
      if (interactiveChallenge) args.push("--interactive-challenge");

      job = {
        jobId: `collect-${now().getTime()}`,
        state: "running",
        startedAt: now().toISOString(),
        finishedAt: null,
        requestedProperties: [...propertyKeys],
        properties: propertyKeys.map(emptyProperty),
        log: [],
        exitCode: null,
        error: null,
      };

      child = spawnChild(process.execPath, args, {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false,
      });

      pumpStream(child.stdout, consumeLine);
      pumpStream(child.stderr, consumeLine);

      child.on("error", (error) => {
        finish("failed", {
          error: {
            code: "COLLECT_SPAWN_FAILED",
            message: error?.message ?? "The collector could not be started.",
          },
        });
      });

      child.on("close", (code) => {
        if (!job || job.state !== "running") return;
        const anyFailed = job.properties.some(
          (entry) => entry.state === "failed",
        );
        finish(code === 0 && !anyFailed ? "succeeded" : "failed", {
          exitCode: code,
          error:
            code === 0 && !anyFailed
              ? null
              : {
                  code: "COLLECT_INCOMPLETE",
                  message:
                    "The collector stopped before every requested property was published.",
                },
        });
      });

      return snapshot();
    },

    cancel() {
      if (!job || job.state !== "running" || !child) {
        throw new CollectJobError(
          "COLLECT_NOT_RUNNING",
          "No collection is currently running.",
        );
      }
      const target = child;
      finish("cancelled", {
        error: { code: "COLLECT_CANCELLED", message: "Cancelled by operator." },
      });
      target.kill();
      return snapshot();
    },

    /* Used on server shutdown so a browser is never orphaned. */
    dispose() {
      if (child) {
        child.kill();
        child = null;
      }
    },
  };
}
