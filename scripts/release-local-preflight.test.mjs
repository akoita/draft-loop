import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ReleaseLocalPreflightError,
  resolveReleasePreflightEnvironment,
  resolveReleaseValidationEnvironment,
  runReleaseLocalPreflight,
} from "./release-local-preflight.mjs";

const preserveWorkspaceVariable = "DRAFT_LOOP_LIVE_E2E_PRESERVE_WORKSPACE_ON_FAILURE";

describe("local release preflight", () => {
  test("defaults to the verified mixed provider route", () => {
    assert.deepEqual(resolveReleasePreflightEnvironment({}), {
      DRAFT_LOOP_ANTHROPIC_AUTH_MODE: "api-key",
      DRAFT_LOOP_OPENAI_AUTH_MODE: "user-session",
      DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL: "claude-haiku-4-5",
      DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL: "gpt-6-luna",
    });
  });

  test("preserves explicit local overrides", () => {
    assert.equal(
      resolveReleasePreflightEnvironment({
        DRAFT_LOOP_OPENAI_AUTH_MODE: "api-key",
      }).DRAFT_LOOP_OPENAI_AUTH_MODE,
      "api-key",
    );
  });

  test("removes live provider routing from deterministic validation", () => {
    assert.deepEqual(
      resolveReleaseValidationEnvironment({
        PATH: "/usr/bin",
        ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        OPENAI_API_KEY: "synthetic-openai-key",
        DRAFT_LOOP_PROVIDER_AUTH_MODE: "user-session",
        DRAFT_LOOP_ANTHROPIC_AUTH_MODE: "api-key",
        DRAFT_LOOP_OPENAI_AUTH_MODE: "user-session",
        DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL: "claude-haiku-4-5",
        DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL: "gpt-6-luna",
        [preserveWorkspaceVariable]: "1",
      }),
      { PATH: "/usr/bin" },
    );
  });

  test("refuses CI and GitHub Actions environments", () => {
    for (const environment of [{ CI: "true" }, { GITHUB_ACTIONS: "true" }]) {
      assert.throws(
        () => resolveReleasePreflightEnvironment(environment),
        ReleaseLocalPreflightError,
      );
    }
  });

  test("runs validation and suggestion availability before the E2E gate", () => {
    const calls = [];
    runReleaseLocalPreflight({
      // Synthetic values verify env projection without invoking provider APIs.
      environment: {
        DRAFT_LOOP_PROVIDER_AUTH_MODE: "user-session",
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
        ["pnpm", "test:model-suggestions:live"],
        ["pnpm", "test:e2e:live"],
      ],
    );
    assert.equal(Object.hasOwn(calls[1].options.env, "DRAFT_LOOP_PROVIDER_AUTH_MODE"), false);
    assert.equal(Object.hasOwn(calls[1].options.env, "DRAFT_LOOP_OPENAI_AUTH_MODE"), false);
    assert.equal(Object.hasOwn(calls[1].options.env, preserveWorkspaceVariable), false);
    assert.equal(Object.hasOwn(calls[1].options.env, "ANTHROPIC_API_KEY"), false);
    assert.equal(Object.hasOwn(calls[1].options.env, "OPENAI_API_KEY"), false);
    assert.equal(calls[2].options.env.DRAFT_LOOP_OPENAI_AUTH_MODE, "user-session");
    assert.equal(calls[2].options.env.ANTHROPIC_API_KEY, "synthetic-anthropic-key");
    assert.equal(calls[3].options.env[preserveWorkspaceVariable], "1");

    let call = 0;
    assert.throws(
      () =>
        runReleaseLocalPreflight({
          environment: {},
          runner: () => {
            call += 1;
            return call === 1 ? { status: 0, stdout: "" } : { status: 1 };
          },
        }),
      /release actions remain blocked/u,
    );

    call = 0;
    const availabilityCalls = [];
    assert.throws(
      () =>
        runReleaseLocalPreflight({
          environment: {},
          runner: (command, args) => {
            availabilityCalls.push([command, ...args]);
            call += 1;
            return { status: call === 3 ? 1 : 0, stdout: "" };
          },
        }),
      /release actions remain blocked/u,
    );
    assert.deepEqual(availabilityCalls.at(-1), ["pnpm", "test:model-suggestions:live"]);
  });

  test("rejects a dirty worktree before validation or provider usage", () => {
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
