import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryRunSpanStore, runSpanTree } from "@draft-loop/storage/run-spans";
import { describe, expect, it } from "vitest";

import { createLocalApplicationDriver } from "./local.js";
import { createRunSpanRecorder } from "./run-span-recorder.js";

const silent = { write: () => undefined };

function clock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 11, 8, 0, tick++));
}

function ids(): () => string {
  let next = 0;
  return () => `s${++next}`;
}

describe("the run span recorder", () => {
  it("saves a span when it starts and again when it ends, content-free", async () => {
    const store = createMemoryRunSpanStore();
    const recorder = createRunSpanRecorder({
      store,
      workspaceId: "owner",
      runId: "run-1",
      now: clock(),
      newSpanId: ids(),
    });

    const workflow = recorder.tracer.startSpan("invoke_workflow", { "draftloop.run.id": "run-1" });
    const author = recorder.tracer.startSpan(
      "invoke_agent",
      { "draftloop.step": "author" },
      workflow,
    );
    await recorder.flush();
    expect((await store.list("owner", "run-1")).map((span) => span.status)).toEqual([null, null]);

    author.setAttributes({
      "gen_ai.usage.input_tokens": 1200,
      "error.type": "A sentence of a draft is not an identifier.",
    });
    author.end("error");
    author.end("ok");
    workflow.end("ok");
    await recorder.flush();

    expect(runSpanTree(await store.list("owner", "run-1"))).toEqual([
      {
        workspaceId: "owner",
        runId: "run-1",
        spanId: "s1",
        parentSpanId: null,
        name: "invoke_workflow",
        startedAt: "2026-11-11T08:00:00.000Z",
        endedAt: "2026-11-11T08:00:03.000Z",
        status: "ok",
        attributes: { "draftloop.run.id": "run-1" },
        children: [
          {
            workspaceId: "owner",
            runId: "run-1",
            spanId: "s2",
            parentSpanId: "s1",
            name: "invoke_agent",
            startedAt: "2026-11-11T08:00:01.000Z",
            endedAt: "2026-11-11T08:00:02.000Z",
            status: "error",
            attributes: { "draftloop.step": "author", "gen_ai.usage.input_tokens": 1200 },
            children: [],
          },
        ],
      },
    ]);
  });

  it("reports a failed save once, stops recording and never throws", async () => {
    const errors: unknown[] = [];
    let puts = 0;
    const recorder = createRunSpanRecorder({
      store: {
        put: async () => {
          puts += 1;
          throw new Error("database is down");
        },
      },
      workspaceId: "owner",
      runId: "run-1",
      onError: (error) => {
        errors.push(error);
        throw new Error("the reporter fails too");
      },
    });

    const span = recorder.tracer.startSpan("invoke_workflow", {});
    span.end("ok");
    recorder.tracer.startSpan("invoke_agent", {}, span).end("error");
    await expect(recorder.flush()).resolves.toBeUndefined();

    expect(puts).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it("records the spans of a real run resumed with its tracer", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-run-spans-"));
    try {
      await mkdir(join(root, "evidence"));
      await writeFile(join(root, "job.md"), "TypeScript engineer");
      await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.");
      const driver = createLocalApplicationDriver();
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true, maxRounds: 3 },
        silent,
      );
      const begun = await driver.begin({ root, allowProviderData: false }, silent);
      const store = createMemoryRunSpanStore();
      const recorder = createRunSpanRecorder({ store, workspaceId: "owner", runId: begun.runId });

      const resumed = await driver.resume(
        { root, runId: begun.runId, allowProviderData: false, tracer: recorder.tracer },
        silent,
      );
      await recorder.flush();

      expect(resumed.runId).toBe(begun.runId);
      const tree = runSpanTree(await store.list("owner", begun.runId));
      expect(tree.length).toBeGreaterThan(0);
      expect(tree.every((root) => root.name === "invoke_workflow" && root.status === "ok")).toBe(
        true,
      );
      const agents = tree.flatMap((root) => root.children);
      expect(agents.map((span) => span.name)).toContain("invoke_agent");
      expect(agents.every((span) => span.endedAt !== null)).toBe(true);
      expect(tree[0]?.attributes["draftloop.run.id"]).toBe(begun.runId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
