import { describe, expect, it } from "vitest";

import { createMemoryRunSpanStore, type RunSpanRecord, runSpanTree } from "./run-spans.js";
import { expectRunSpanStore } from "./run-spans-conformance.js";

const span = (spanId: string, parentSpanId: string | null, startedAt: string): RunSpanRecord => ({
  workspaceId: "owner",
  runId: "run-1",
  spanId,
  parentSpanId,
  name: "invoke_agent",
  startedAt,
  endedAt: null,
  status: null,
  attributes: {},
});

describe("the in-memory run span store", () => {
  it("saves, replaces, lists in start order and removes a run's content-free spans", async () => {
    await expectRunSpanStore(createMemoryRunSpanStore());
  });
});

describe("runSpanTree", () => {
  it("orders each level by start and shows orphans and loops as roots", () => {
    const tree = runSpanTree([
      span("late", "root", "2026-11-11T08:00:03.000Z"),
      span("early", "root", "2026-11-11T08:00:01.000Z"),
      span("root", null, "2026-11-11T08:00:00.000Z"),
      span("orphan", "never-saved", "2026-11-11T08:00:04.000Z"),
      span("loop-a", "loop-b", "2026-11-11T08:00:05.000Z"),
      span("loop-b", "loop-a", "2026-11-11T08:00:06.000Z"),
    ]);

    expect(tree.map((node) => node.spanId)).toEqual(["root", "orphan", "loop-a", "loop-b"]);
    expect(tree[0]?.children.map((node) => node.spanId)).toEqual(["early", "late"]);
    expect(tree.slice(1).every((node) => node.children.length === 0)).toBe(true);
  });
});
