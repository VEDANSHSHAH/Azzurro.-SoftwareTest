import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const children = [
  spawn(process.execPath, ["scripts/dashboard-server.mjs"], {
    cwd: projectRoot,
    stdio: "inherit",
  }),
  spawn(npmCommand, ["run", "dev"], {
    cwd: resolve(projectRoot, "dashboard"),
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
    },
  }),
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("error", (error) => {
    process.stderr.write(`Application process failed: ${error.message}\n`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping && (code !== 0 || signal)) {
      process.stderr.write(
        `Application process exited (${signal ?? code ?? "unknown"}).\n`,
      );
      stop(code || 1);
    }
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
