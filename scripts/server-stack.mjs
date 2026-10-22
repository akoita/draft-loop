#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Where `compose.yaml` publishes the local server stack. Keep these in step with its ports.
export const localServerStack = Object.freeze({
  DRAFT_LOOP_TEST_POSTGRES_URL: "postgres://postgres:postgres@127.0.0.1:55432/postgres",
  DRAFT_LOOP_TEST_GCS_URL: "http://127.0.0.1:4443",
  DRAFT_LOOP_TEST_API_URL: "http://127.0.0.1:58080",
});

// What the smoke needs besides the URLs: the stack's fixed, local-only owner token from compose.yaml.
export const localServerStackSettings = Object.freeze({
  DRAFT_LOOP_TEST_API_OWNER_TOKEN: "local-stack-owner-token-not-a-secret",
});

// Start or update the stack, then run the storage suites and the end-to-end smoke, in order.
export const serverStackSteps = Object.freeze([
  ["docker", ["compose", "up", "--detach", "--wait", "--build"]],
  ["pnpm", ["test:postgres"]],
  ["pnpm", ["test:gcs"]],
  ["pnpm", ["test:server-smoke"]],
]);

/** Runs every step against the local stack; resolves with the first failing exit code, or 0. */
export function runServerStack({ env = process.env, spawn = spawnSync } = {}) {
  for (const [command, args] of serverStackSteps) {
    const result = spawn(command, args, {
      env: { ...env, ...localServerStack, ...localServerStackSettings },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runServerStack();
}
