import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { URL } from "node:url";

import { localServerStack, localServerStackSettings, runServerStack } from "./server-stack.mjs";

describe("local server stack", () => {
  it("points the suites at the ports and values compose.yaml publishes", async () => {
    const compose = await readFile(new URL("../compose.yaml", import.meta.url), "utf8");
    for (const url of Object.values(localServerStack)) {
      const { hostname, port } = new URL(url);
      assert.ok(compose.includes(`"${hostname}:${port}:`), `compose.yaml publishes ${url}`);
    }
    for (const value of [
      localServerStackSettings.DRAFT_LOOP_TEST_TENANT_ID,
      localServerStackSettings.DRAFT_LOOP_TEST_BLOB_BUCKET,
      localServerStackSettings.DRAFT_LOOP_TEST_API_OWNER_TOKEN,
    ]) {
      assert.ok(compose.includes(value), `compose.yaml sets ${value}`);
    }
  });

  it("starts the stack, then runs the storage suites and the smoke with its settings", () => {
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push([command, args.at(-1), options.env.DRAFT_LOOP_TEST_API_URL]);
      return { status: 0 };
    };
    assert.equal(runServerStack({ env: {}, spawn }), 0);
    const api = localServerStack.DRAFT_LOOP_TEST_API_URL;
    assert.deepEqual(calls, [
      ["docker", "--build", api],
      ["pnpm", "test:postgres", api],
      ["pnpm", "test:gcs", api],
      ["pnpm", "test:server-smoke", api],
    ]);
  });

  it("stops at the first failing step", () => {
    const calls = [];
    const spawn = (command) => {
      calls.push(command);
      return { status: 1 };
    };
    assert.equal(runServerStack({ env: {}, spawn }), 1);
    assert.deepEqual(calls, ["docker"]);
  });
});
