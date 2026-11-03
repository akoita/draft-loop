import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { URL } from "node:url";

import {
  runSelfHostedSmoke,
  selfHostedComposeFiles,
  selfHostedSmokeApiUrl,
  selfHostedSmokeProject,
} from "./self-hosted-smoke.mjs";

const steps = (calls) => calls.map(([command, args]) => [command, args.slice(-1)[0]]);

describe("self-hosted smoke", () => {
  it("boots the stack from the clone with the worker on fixtures, under its own project", async () => {
    assert.deepEqual(selfHostedComposeFiles, [
      "deploy/local/compose.yaml",
      "deploy/local/compose.build.yaml",
      "scripts/self-hosted-ci.compose.yaml",
    ]);
    const overlay = await readFile(
      new URL("./self-hosted-ci.compose.yaml", import.meta.url),
      "utf8",
    );
    assert.match(overlay, /\n {2}worker:\n {4}environment:\n {6}DRAFT_LOOP_MODEL_ROUTES: ""\n/u);
    assert.notEqual(selfHostedSmokeProject, "draft-loop-self-hosted");
    const compose = await readFile(
      new URL("../deploy/local/compose.yaml", import.meta.url),
      "utf8",
    );
    assert.match(compose, /\nname: draft-loop-self-hosted\n/u);
    assert.equal(new URL(selfHostedSmokeApiUrl).port, "8080");
  });

  it("runs the smoke with the stack's own token, then removes the stack", () => {
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push([command, args, options.env]);
      return args.includes("cat") ? { status: 0, stdout: "generated-token\n" } : { status: 0 };
    };
    assert.equal(runSelfHostedSmoke({ env: {}, spawn }), 0);
    assert.deepEqual(steps(calls), [
      ["docker", "--build"],
      ["docker", "/secrets/owner_token"],
      ["pnpm", "apps/api/src/server-stack.smoke.test.ts"],
      ["docker", "--volumes"],
    ]);
    assert.equal(calls[2][2].DRAFT_LOOP_TEST_API_OWNER_TOKEN, "generated-token");
    assert.equal(calls[2][2].DRAFT_LOOP_TEST_API_URL, selfHostedSmokeApiUrl);
    for (const [, args] of calls.filter(([command]) => command === "docker")) {
      assert.deepEqual(args.slice(0, 3), ["compose", "--project-name", selfHostedSmokeProject]);
    }
  });

  it("prints the logs and still removes the stack when a step fails", () => {
    const calls = [];
    const spawn = (command, args) => {
      calls.push([command, args]);
      return { status: args.includes("vitest") ? 1 : 0, stdout: "token" };
    };
    assert.equal(runSelfHostedSmoke({ env: {}, spawn }), 1);
    assert.deepEqual(steps(calls).slice(-2), [
      ["docker", "--no-color"],
      ["docker", "--volumes"],
    ]);
  });

  it("keeps a failed stack for a look when asked", () => {
    const calls = [];
    const spawn = (_command, args) => {
      calls.push(args.at(-1));
      return { status: 1 };
    };
    assert.equal(runSelfHostedSmoke({ env: {}, spawn, keep: true }), 1);
    assert.deepEqual(calls, ["--build", "--no-color"]);
  });
});

describe("Self-hosted stack CI job", () => {
  it("runs the smoke on every pull request", async () => {
    const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    const job = ci.match(/\n {2}self-hosted-stack:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n|$)/u);
    assert.ok(job, "ci.yml defines the self-hosted-stack job");
    assert.match(job[1], /name: Self-hosted stack\n/u);
    assert.match(job[1], /run: pnpm self-hosted:test\n/u);
    assert.doesNotMatch(job[1], /secrets\./u);
  });
});
