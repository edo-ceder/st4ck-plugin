#!/usr/bin/env node
/**
 * run-test-next.js — thin shim that spawns the new st4ck-runner CLI and
 * mirrors its exit code. Streams stdin / stdout / stderr through unchanged
 * so the IPC pause protocol (§8.5) works end-to-end from a parent agent.
 *
 * Phase 1.11 (2026-04-24). Phase 1.12 will add a flag-aware dispatcher
 * that branches between this and the legacy run-test.js based on the test's
 * `use_new_runner` column — keep the legacy path as fallback for tests
 * whose action shape still needs the old runner.
 *
 * Resolves the runner binary via:
 *   1. ST4CK_RUNNER_BIN env (explicit path)
 *   2. A fig-video-scribe sibling probe (dev setup)
 *   3. Global `st4ck-runner` bin on PATH (via `which`)
 */

"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function resolveRunner() {
  const env = process.env.ST4CK_RUNNER_BIN;
  if (env) {
    if (!fs.existsSync(env)) {
      console.error(`[run-test-next] ST4CK_RUNNER_BIN set but file not found: ${env}`);
      process.exit(2);
    }
    return { cmd: "node", args: [env] };
  }

  // Sibling repo probe (dev setup): assumes the two repos sit next to each
  // other under the same parent directory.
  const sibling = path.resolve(
    __dirname, "..", "..", "..",
    "fig-video-scribe", "packages", "st4ck-runner", "dist", "cli.js",
  );
  if (fs.existsSync(sibling)) return { cmd: "node", args: [sibling] };

  // Last resort: global PATH.
  const which = spawnSync("which", ["st4ck-runner"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) {
    return { cmd: which.stdout.trim(), args: [] };
  }

  console.error(
    "[run-test-next] st4ck-runner not found. Set ST4CK_RUNNER_BIN to the " +
    "compiled dist/cli.js, or install @st4ck/runner globally.",
  );
  process.exit(2);
}

const { cmd, args: base } = resolveRunner();
const userArgs = process.argv.slice(2);

const child = spawn(cmd, [...base, ...userArgs], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, sig) => {
  if (sig) {
    // Re-raise the signal so the parent sees the same termination cause.
    try { process.kill(process.pid, sig); } catch { process.exit(1); }
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error(`[run-test-next] failed to spawn: ${err.message}`);
  process.exit(2);
});
