import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

// The desktop client calls no provider (ADR 0011, D9), so the release preflight launches the
// packaged client against a scripted server instead of the former live-provider E2E. Provider
// credentials are kept out of every step.
const VALIDATION_ENVIRONMENT_EXCLUSIONS = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DRAFT_LOOP_PROVIDER_AUTH_MODE",
  "DRAFT_LOOP_ANTHROPIC_AUTH_MODE",
  "DRAFT_LOOP_OPENAI_AUTH_MODE",
  "DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL",
  "DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL",
  "DRAFT_LOOP_LIVE_E2E_PRESERVE_WORKSPACE_ON_FAILURE",
]);

export class ReleaseLocalPreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseLocalPreflightError";
  }
}

function enabled(value) {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

export function assertLocalPreflight(environment = process.env) {
  if (enabled(environment.CI) || enabled(environment.GITHUB_ACTIONS)) {
    throw new ReleaseLocalPreflightError(
      "release preflight is local-only and must not run in CI/CD.",
    );
  }
}

export function resolveReleaseValidationEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !VALIDATION_ENVIRONMENT_EXCLUSIONS.has(name)),
  );
}

export function runReleaseLocalPreflight({
  environment = process.env,
  platform = process.platform,
  runner = spawnSync,
} = {}) {
  assertLocalPreflight(environment);
  const validationEnvironment = resolveReleaseValidationEnvironment(environment);
  const command = platform === "win32" ? "pnpm.cmd" : "pnpm";
  const commands = [
    { args: ["validate"], environment: validationEnvironment },
    {
      args: ["--filter", "@draft-loop/desktop-client", "package"],
      environment: validationEnvironment,
    },
    { args: ["desktop-client:acceptance"], environment: validationEnvironment },
  ];

  const status = runner("git", ["status", "--porcelain", "--untracked-files=normal"], {
    env: { ...environment },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    shell: false,
  });
  if (status.error !== undefined || status.status !== 0) {
    throw new ReleaseLocalPreflightError("could not verify the release worktree state.");
  }
  if (typeof status.stdout !== "string" || status.stdout.trim() !== "") {
    throw new ReleaseLocalPreflightError(
      "release preflight requires a clean worktree at the exact revision being released.",
    );
  }

  for (const { args, environment: commandEnvironment } of commands) {
    const result = runner(command, args, {
      env: commandEnvironment,
      stdio: "inherit",
      shell: false,
    });
    if (result.error !== undefined) {
      throw new ReleaseLocalPreflightError(`could not run pnpm ${args.join(" ")}.`);
    }
    if (result.status !== 0) {
      throw new ReleaseLocalPreflightError(
        `pnpm ${args.join(" ")} failed; release actions remain blocked.`,
      );
    }
  }
}

export function main(options) {
  try {
    runReleaseLocalPreflight(options);
    process.stdout.write("Local release preflight passed; release actions may proceed.\n");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release local preflight: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
