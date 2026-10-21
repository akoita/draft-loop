import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { URL } from "node:url";

import { localServerStack, runServerStorageSuites } from "./server-stack.mjs";

describe("local server stack", () => {
  it("points the storage suites at the ports compose.yaml publishes", async () => {
    const compose = await readFile(new URL("../compose.yaml", import.meta.url), "utf8");
    for (const url of Object.values(localServerStack)) {
      const { hostname, port } = new URL(url);
      assert.ok(compose.includes(`"${hostname}:${port}:`), `compose.yaml publishes ${url}`);
    }
  });

  it("runs the Postgres then the Cloud Storage suite with the stack's URLs", () => {
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push([command, ...args, options.env.DRAFT_LOOP_TEST_GCS_URL]);
      return { status: 0 };
    };
    assert.equal(runServerStorageSuites({ env: {}, spawn }), 0);
    assert.deepEqual(calls, [
      ["pnpm", "test:postgres", localServerStack.DRAFT_LOOP_TEST_GCS_URL],
      ["pnpm", "test:gcs", localServerStack.DRAFT_LOOP_TEST_GCS_URL],
    ]);
  });

  it("stops at the first failing suite", () => {
    const calls = [];
    const spawn = (_command, args) => {
      calls.push(args[0]);
      return { status: 1 };
    };
    assert.equal(runServerStorageSuites({ env: {}, spawn }), 1);
    assert.deepEqual(calls, ["test:postgres"]);
  });
});
