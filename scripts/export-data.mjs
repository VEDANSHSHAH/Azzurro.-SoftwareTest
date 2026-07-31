import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectExportRecords,
  ExportValidationError,
  recordsToCsv,
} from "../src/exporter.mjs";
import { loadProperties } from "../src/property-config.mjs";
import { ReviewStorage } from "../src/storage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function atomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, path);
}

const databasePath = resolve(
  argument("--db", resolve(projectRoot, "data", "azzurro-reviews.sqlite")),
);
const outputDirectory = resolve(
  argument("--out", resolve(projectRoot, "exports")),
);
const propertiesPath = resolve(
  argument(
    "--properties",
    resolve(projectRoot, "config", "properties.json"),
  ),
);
const all = process.argv.includes("--all");
const samplePerProperty = all
  ? Infinity
  : Number(argument("--sample-per-property", "25"));
if (
  samplePerProperty !== Infinity &&
  (!Number.isInteger(samplePerProperty) || samplePerProperty < 1)
) {
  throw new Error("--sample-per-property must be a positive integer");
}

const configured = await loadProperties(propertiesPath);
const storage = new ReviewStorage(databasePath);
try {
  const exported = collectExportRecords(
    storage,
    configured.map((property) => property.key),
    { samplePerProperty, strictAll: all },
  );
  await mkdir(outputDirectory, { recursive: true });
  const jsonl = exported.records
    .map((record) => JSON.stringify(record))
    .join("\n");
  await atomic(
    resolve(outputDirectory, all ? "reviews.jsonl" : "sample-reviews.jsonl"),
    jsonl ? `${jsonl}\n` : "",
  );
  await atomic(
    resolve(outputDirectory, all ? "reviews.csv" : "sample-reviews.csv"),
    recordsToCsv(exported.records),
  );
  await atomic(
    resolve(outputDirectory, "export-manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: all ? "all_current_reviews" : "sample",
        samplePerProperty: all ? null : samplePerProperty,
        totalRecords: exported.records.length,
        ...exported,
        records: undefined,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({
      outputDirectory,
      properties: exported.properties.length,
      records: exported.records.length,
      mode: all ? "all" : "sample",
      strictAll: all,
    })}\n`,
  );
} catch (error) {
  if (!(error instanceof ExportValidationError)) throw error;
  process.stderr.write(
    `${JSON.stringify({
      code: error.code,
      message: error.message,
      details: error.details,
    })}\n`,
  );
  process.exitCode = 2;
} finally {
  storage.close();
}
