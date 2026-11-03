import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { URL } from "node:url";

import {
  runSelfHostedSmoke,
  selfHostedSmokeApiUrl,
  selfHostedSmokeProject,
  selfHostedSmokeRegistry,
  selfHostedSmokeVersion,
} from "./self-hosted-smoke.mjs";

/** A spawn stand-in: records each step and answers the reads the smoke compares. */
function fakeSpawn({ runsAfter = "2", failOn } = {}) {
  const calls = [];
  let restored = false;
  const spawn = (command, args, options) => {
    const line = [command, ...args].join(" ");
    calls.push({ line, env: options.env });
    if (failOn !== undefined && line.includes(failOn)) return { status: 1 };
    if (line.includes(" install ")) {
      const home = args.at(-1);
      mkdirSync(join(home, "bin"), { recursive: true });
      writeFileSync(join(home, ".env"), `DRAFT_LOOP_VERSION=${selfHostedSmokeVersion}\n`);
    }
    if (line.includes(" restore ")) restored = true;
    if (line.endsWith(" token")) return { status: 0, stdout: "generated-token\n" };
    if (line.includes("count(*) from draft_loop.runs")) {
      return { status: 0, stdout: restored ? `${runsAfter}\n` : "2\n" };
    }
    if (line.includes("find /blobs -type f")) return { status: 0, stdout: "3\n" };
    return { status: 0, stdout: "" };
  };
  return { calls, spawn };
}

const scratch = () => mkdtempSync(join(tmpdir(), "self-hosted-smoke-test-"));

/** Short names for the steps, in order. */
function steps(calls) {
  return calls.map(({ line }) => {
    for (const [pattern, name] of [
      [/compose\.build\.yaml build$/u, "build"],
      [/^docker tag /u, "tag"],
      [/^tar -czf /u, "pack"],
      [/draft-loop-server install /u, "install"],
      [/draft-loop-server up$/u, "up"],
      [/draft-loop-server token$/u, "token"],
      [/vitest run /u, "smoke"],
      [/count\(\*\) from draft_loop\.runs/u, "count-runs"],
      [/find \/blobs/u, "count-files"],
      [/draft-loop-server backup /u, "backup"],
      [/draft-loop-server restore /u, "restore"],
      [/ logs /u, "logs"],
      [/ down --volumes$/u, "erase"],
    ]) {
      if (pattern.test(line)) return name;
    }
    return line;
  });
}

describe("self-hosted smoke", () => {
  it("installs the clone's images as a release, then smokes, backs up, erases and restores", () => {
    const { calls, spawn } = fakeSpawn();
    const folder = scratch();
    assert.equal(runSelfHostedSmoke({ env: {}, spawn, keep: true, scratch: folder }), 0);
    assert.deepEqual(steps(calls), [
      "build",
      "tag",
      "tag",
      "tag",
      "pack",
      "install",
      "up",
      "token",
      "smoke",
      "count-runs",
      "count-files",
      "backup",
      "erase",
      "restore",
      "count-runs",
      "count-files",
      "token",
      "smoke",
    ]);
    const smoke = calls.find(({ line }) => line.includes("vitest"));
    assert.equal(smoke.env.DRAFT_LOOP_TEST_API_OWNER_TOKEN, "generated-token");
    assert.equal(smoke.env.DRAFT_LOOP_TEST_API_URL, selfHostedSmokeApiUrl);
    assert.ok(calls.every(({ env }) => env.COMPOSE_PROJECT_NAME === selfHostedSmokeProject));
    assert.ok(
      calls.some(({ line }) =>
        line.endsWith(
          `draft-loop-api:self-hosted ${selfHostedSmokeRegistry}/draft-loop-api:${selfHostedSmokeVersion}`,
        ),
      ),
    );
    const home = join(folder, "server");
    assert.match(
      readFileSync(join(home, ".env"), "utf8"),
      /DRAFT_LOOP_IMAGE_REGISTRY=draft-loop-smoke\nDRAFT_LOOP_PORT=58090\n/u,
    );
    assert.match(
      readFileSync(join(home, "compose.override.yaml"), "utf8"),
      /\n {2}worker:\n {4}environment:\n {6}DRAFT_LOOP_MODEL_ROUTES: ""\n/u,
    );
    rmSync(folder, { force: true, recursive: true });
  });

  it("fails when the restored stack lost records, prints the logs and erases the stack", () => {
    const { calls, spawn } = fakeSpawn({ runsAfter: "1" });
    assert.equal(runSelfHostedSmoke({ env: {}, spawn, scratch: scratch() }), 1);
    assert.deepEqual(steps(calls).slice(-2), ["logs", "erase"]);
  });

  it("stops at a failed build and still erases the stack", () => {
    const { calls, spawn } = fakeSpawn({ failOn: "compose.build.yaml build" });
    assert.equal(runSelfHostedSmoke({ env: {}, spawn, scratch: scratch() }), 1);
    assert.deepEqual(steps(calls), ["build", "logs", "erase"]);
  });

  it("uses a project name and port of its own", async () => {
    assert.notEqual(selfHostedSmokeProject, "draft-loop-self-hosted");
    const compose = await readFile(
      new URL("../deploy/local/compose.yaml", import.meta.url),
      "utf8",
    );
    assert.match(compose, /\nname: draft-loop-self-hosted\n/u);
    assert.notEqual(new URL(selfHostedSmokeApiUrl).port, "8080");
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
