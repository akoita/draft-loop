#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Boots the self-hosted stack (deploy/local) built from this clone, with the worker on its offline
 * fixtures, and runs the hosted smoke through the API: upload, run, review, approval and a DOCX
 * export, with no provider call. Used by the Self-hosted stack CI job and `pnpm self-hosted:test`.
 */
export const selfHostedComposeFiles = Object.freeze([
  "deploy/local/compose.yaml",
  "deploy/local/compose.build.yaml",
  "scripts/self-hosted-ci.compose.yaml",
]);

// A project name of its own, so the smoke never touches a person's own self-hosted stack.
export const selfHostedSmokeProject = "draft-loop-self-hosted-smoke";
// The stack's default port; the API listens on 127.0.0.1 only.
export const selfHostedSmokeApiUrl = "http://127.0.0.1:8080";

const compose = (...args) => [
  "docker",
  [
    "compose",
    "--project-name",
    selfHostedSmokeProject,
    ...selfHostedComposeFiles.flatMap((file) => ["--file", file]),
    ...args,
  ],
];

export const selfHostedSmokeSteps = Object.freeze({
  up: compose("up", "--detach", "--wait", "--build"),
  token: compose("exec", "-T", "api", "cat", "/secrets/owner_token"),
  smoke: ["pnpm", ["exec", "vitest", "run", "apps/api/src/server-stack.smoke.test.ts"]],
  logs: compose("logs", "--no-color"),
  down: compose("down", "--volumes"),
});

/**
 * Runs the smoke and always removes the stack and its volumes afterwards. Resolves with the first
 * failing exit code, or 0. `keep` leaves the stack running for a look after a failure.
 */
export function runSelfHostedSmoke({ env = process.env, spawn = spawnSync, keep = false } = {}) {
  const run = ([command, args], options = {}) =>
    spawn(command, args, {
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
  let status;
  try {
    status = run(selfHostedSmokeSteps.up).status ?? 1;
    if (status === 0) {
      const token = run(selfHostedSmokeSteps.token, {
        stdio: ["ignore", "pipe", "inherit"],
        encoding: "utf8",
      });
      const ownerToken = String(token.stdout ?? "").trim();
      status = token.status !== 0 || ownerToken === "" ? token.status || 1 : 0;
      if (status === 0) {
        status =
          run(selfHostedSmokeSteps.smoke, {
            env: {
              ...env,
              DRAFT_LOOP_TEST_API_URL: selfHostedSmokeApiUrl,
              DRAFT_LOOP_TEST_API_OWNER_TOKEN: ownerToken,
            },
          }).status ?? 1;
      }
    }
    if (status !== 0) run(selfHostedSmokeSteps.logs);
  } finally {
    if (!keep) run(selfHostedSmokeSteps.down);
  }
  return status;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runSelfHostedSmoke({ keep: process.argv.includes("--keep") });
}
