import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { auditExportFiles } from "../src/export-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

let report;
try {
  report = await auditExportFiles({
    manifestPath: resolve(
      argument(
        "--manifest",
        resolve(projectRoot, "exports", "export-manifest.json"),
      ),
    ),
    jsonlPath: resolve(
      argument(
        "--jsonl",
        resolve(projectRoot, "exports", "reviews.jsonl"),
      ),
    ),
    propertiesPath: resolve(
      argument(
        "--properties",
        resolve(projectRoot, "config", "properties.json"),
      ),
    ),
  });
} catch {
  report = {
    contractVersion: 1,
    ok: false,
    counts: {},
    properties: [],
    errors: [
      {
        code: "AUDIT_EXECUTION_FAILED",
        field: "audit",
        count: 1,
      },
    ],
  };
}

process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.ok) process.exitCode = 2;
