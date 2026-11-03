import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertLocalPreflight,
  ReleaseLocalPreflightError,
  resolveReleaseValidationEnvironment,
  runReleaseLocalPreflight,
} from "./release-local-preflight.mjs";

describe("local release preflight", () => {
  test("removes provider credentials and routing from every step", () => {
    assert.deepEqual(
      resolveReleaseValidationEnvironment({
        PATH: "/usr/bin",
        ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        OPENAI_API_KEY: "synthetic-openai-key",
        DRAFT_LOOP_PROVIDER_AUTH_MODE: "user-session",
        DRAFT_LOOP_ANTHROPIC_AUTH_MODE: "api-key",
        DRAFT_LOOP_OPENAI_AUTH_MODE: "user-session",
        DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL: "claude-sonnet-5-5",
        DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL: "gpt-6-luna",
        DRAFT_LOOP_LIVE_E2E_PRESERVE_WORKSPACE_ON_FAILURE: "1",
      }),
      { PATH: "/usr/bin" },
    );
  });

  test("refuses CI and GitHub Actions environments", () => {
    for (const environment of [{ CI: "true" }, { GITHUB_ACTIONS: "true" }]) {
      assert.throws(() => assertLocalPreflight(environment), ReleaseLocalPreflightError);
      assert.throws(
        () => runReleaseLocalPreflight({ environment, runner: () => ({ status: 0, stdout: "" }) }),
        ReleaseLocalPreflightError,
      );
    }
  });

  test("validates, packages the desktop client and runs its acceptance, with no provider", () => {
    const calls = [];
    runReleaseLocalPreflight({
      // Synthetic values verify that no step receives provider credentials.
      environment: {
        PATH: "/usr/bin",
        ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        OPENAI_API_KEY: "synthetic-openai-key",
      },
      platform: "linux",
      runner: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: "" };
      },
    });
    assert.deepEqual(
      calls.map(({ command, args }) => [command, ...args]),
      [
        ["git", "status", "--porcelain", "--untracked-files=normal"],
        ["pnpm", "validate"],
        ["pnpm", "--filter", "@draft-loop/desktop-client", "package"],
        ["pnpm", "desktop-client:acceptance"],
      ],
    );
    for (const call of calls.slice(1)) {
      assert.equal(Object.hasOwn(call.options.env, "ANTHROPIC_API_KEY"), false);
      assert.equal(Object.hasOwn(call.options.env, "OPENAI_API_KEY"), false);
    }

    const failing = [];
    assert.throws(
      () =>
        runReleaseLocalPreflight({
          environment: {},
          runner: (command, args) => {
            failing.push([command, ...args]);
            return { status: failing.length === 3 ? 1 : 0, stdout: "" };
          },
        }),
      /release actions remain blocked/u,
    );
    assert.deepEqual(failing.at(-1), ["pnpm", "--filter", "@draft-loop/desktop-client", "package"]);
  });

  test("rejects a dirty worktree before validation", () => {
    const calls = [];
    assert.throws(
      () =>
        runReleaseLocalPreflight({
          environment: {},
          runner: (command, args) => {
            calls.push([command, ...args]);
            return { status: 0, stdout: " M package.json\n" };
          },
        }),
      /requires a clean worktree/u,
    );
    assert.deepEqual(calls, [["git", "status", "--porcelain", "--untracked-files=normal"]]);
  });
});
