#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Where `compose.yaml` publishes the local server stack. Keep these in step with its ports.
export const localServerStack = Object.freeze({
  DRAFT_LOOP_TEST_POSTGRES_URL: "postgres://postgres:postgres@127.0.0.1:55432/postgres",
  DRAFT_LOOP_TEST_GCS_URL: "http://127.0.0.1:4443",
});

// The storage suites that run against the stack, in order.
export const serverStorageSuites = Object.freeze(["test:postgres", "test:gcs"]);

/** Runs every server storage suite against the local stack; resolves with the exit code. */
export function runServerStorageSuites({ env = process.env, spawn = spawnSync } = {}) {
  for (const suite of serverStorageSuites) {
    const result = spawn("pnpm", [suite], {
      env: { ...env, ...localServerStack },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runServerStorageSuites();
}
