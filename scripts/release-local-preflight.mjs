import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULTS = Object.freeze({
  DRAFT_LOOP_ANTHROPIC_AUTH_MODE: "api-key",
  DRAFT_LOOP_OPENAI_AUTH_MODE: "user-session",
  DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL: "claude-haiku-4-5",
  DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL: "gpt-5.3-codex-spark",
});

export class ReleaseLocalPreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseLocalPreflightError";
  }
}

function enabled(value) {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

export function resolveReleasePreflightEnvironment(environment = process.env) {
  if (enabled(environment.CI) || enabled(environment.GITHUB_ACTIONS)) {
    throw new ReleaseLocalPreflightError(
      "release preflight is local-only and must not run in CI/CD.",
    );
  }
  return Object.fromEntries(
    Object.entries(DEFAULTS).map(([name, fallback]) => [name, environment[name] ?? fallback]),
  );
}

export function runReleaseLocalPreflight({
  environment = process.env,
  platform = process.platform,
  runner = spawnSync,
} = {}) {
  const resolved = resolveReleasePreflightEnvironment(environment);
  const command = platform === "win32" ? "pnpm.cmd" : "pnpm";
  const commands = [["validate"], ["test:e2e:live"]];

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

  for (const args of commands) {
    const result = runner(command, args, {
      env: { ...environment, ...resolved },
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
