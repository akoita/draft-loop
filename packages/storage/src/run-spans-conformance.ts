import { expect } from "vitest";

import { type RunSpanRecord, type RunSpanStore, runSpanTree } from "./run-spans.js";

/**
 * What every run span store must do; the in-memory and Postgres tests both run it. `other` is a
 * second tenant's store where the implementation has tenants.
 */
export async function expectRunSpanStore(store: RunSpanStore, other?: RunSpanStore): Promise<void> {
  const run = { workspaceId: "owner", runId: "run-1" };
  const workflow: RunSpanRecord = {
    ...run,
    spanId: "s1",
    parentSpanId: null,
    name: "invoke_workflow",
    startedAt: "2026-11-11T08:00:00.000Z",
    endedAt: null,
    status: null,
    attributes: { "draftloop.run.id": "run-1" },
  };
  const retrieval: RunSpanRecord = {
    ...run,
    spanId: "s3",
    parentSpanId: "s2",
    name: "retrieve_evidence",
    startedAt: "2026-11-11T08:00:01.000Z",
    endedAt: "2026-11-11T08:00:02.000Z",
    status: "ok",
    attributes: { "draftloop.retrieved_chunks": 12 },
  };
  const author: RunSpanRecord = {
    ...run,
    spanId: "s2",
    parentSpanId: "s1",
    name: "invoke_agent",
    startedAt: "2026-11-11T08:00:01.000Z",
    endedAt: "2026-11-11T08:00:09.000Z",
    status: "error",
    attributes: {
      "gen_ai.provider.name": "anthropic",
      "gen_ai.usage.input_tokens": 1200,
      "draftloop.estimated_usd": 0.0125,
      "draftloop.step": "author",
      "error.type": "provider_overloaded",
    },
  };

  expect(await store.list("owner", "run-1")).toEqual([]);
  expect(await store.removeRun("owner", "run-1")).toBe(0);

  // Saved out of order; read back in start order, then by span id.
  await store.put(retrieval);
  await store.put(author);
  await store.put(workflow);
  await store.put({ ...workflow, runId: "run-2" });
  await store.put({ ...workflow, workspaceId: "second" });
  expect(await store.list("owner", "run-1")).toEqual([workflow, author, retrieval]);

  // Saving a span again replaces it: that is how an open span gets its end.
  const ended: RunSpanRecord = {
    ...workflow,
    endedAt: "2026-11-11T08:00:10.000Z",
    status: "error",
    attributes: { "draftloop.run.id": "run-1", "draftloop.failure_stage": "author" },
  };
  await store.put(ended);
  const spans = await store.list("owner", "run-1");
  expect(spans).toEqual([ended, author, retrieval]);
  expect(runSpanTree(spans)).toEqual([
    { ...ended, children: [{ ...author, children: [{ ...retrieval, children: [] }] }] },
  ]);

  if (other !== undefined) {
    expect(await other.list("owner", "run-1")).toEqual([]);
    expect(await other.removeRun("owner", "run-1")).toBe(0);
  }

  // Nothing outside the content-free set is stored, and a refusal names no attribute.
  for (const invalid of [
    { ...author, attributes: { "gen_ai.input.messages": "x" } },
    { ...author, attributes: { "gen_ai.output.messages": "x" } },
    { ...author, attributes: { "gen_ai.system_instructions": "x" } },
    { ...author, attributes: { "gen_ai.tool.call.arguments": "x" } },
    { ...author, attributes: { "anthropic.tool_result.content": "x" } },
    { ...author, attributes: { "error.type": "Free text is not an identifier." } },
    { ...author, attributes: { "draftloop.round": Number.NaN } },
    { ...author, attributes: { "draftloop.step": { nested: "author" } } },
    { ...author, name: "write_file" },
    { ...author, spanId: "has space" },
    { ...author, parentSpanId: "s2" },
    { ...author, startedAt: "yesterday" },
    { ...author, status: "cancelled" },
    { ...author, runId: "" },
  ]) {
    await expect(store.put(invalid as unknown as RunSpanRecord)).rejects.toMatchObject({
      code: "invalid_span",
    });
  }
  await expect(
    store.put({ ...author, attributes: { "candidate.name": "x" } } as unknown as RunSpanRecord),
  ).rejects.not.toThrow(/candidate\.name/u);
  expect(await store.list("owner", "run-1")).toEqual([ended, author, retrieval]);

  // Removing a run takes its spans only.
  expect(await store.removeRun("owner", "run-1")).toBe(3);
  expect(await store.list("owner", "run-1")).toEqual([]);
  expect(await store.list("owner", "run-2")).toHaveLength(1);
  expect(await store.list("second", "run-1")).toHaveLength(1);
}
