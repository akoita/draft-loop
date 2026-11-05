import { describe, expect, it } from "vitest";

import { contentFreeSpanAttributes, createMemoryRunTracer, noopRunTracer } from "./run-tracing.js";

describe("run tracing", () => {
  it("keeps only allowed names with numbers, booleans and short identifiers", () => {
    expect(
      contentFreeSpanAttributes({
        "draftloop.run.id": "run-1",
        "draftloop.round": 2,
        "gen_ai.request.model": "claude-sonnet-5-5",
        "gen_ai.input.messages": "a prompt",
        "error.type": "Built a ledger service at Example Ledger.",
        "draftloop.estimated_usd": Number.NaN,
      }),
    ).toEqual({
      "draftloop.run.id": "run-1",
      "draftloop.round": 2,
      "gen_ai.request.model": "claude-sonnet-5-5",
    });
  });

  it("records a parent link, attributes added before the end, and the first status", () => {
    const tracer = createMemoryRunTracer();
    const parent = tracer.startSpan("invoke_workflow", { "draftloop.run.id": "run-1" });
    const child = tracer.startSpan("invoke_agent", { "draftloop.step": "author" }, parent);
    child.setAttributes({ "draftloop.attempt": 1 });
    child.end("error");
    child.end("ok");
    child.setAttributes({ "draftloop.attempt": 2 });
    parent.end("ok");
    expect(tracer.spans()).toEqual([
      {
        id: 1,
        parentId: null,
        name: "invoke_workflow",
        attributes: { "draftloop.run.id": "run-1" },
        status: "ok",
      },
      {
        id: 2,
        parentId: 1,
        name: "invoke_agent",
        attributes: { "draftloop.step": "author", "draftloop.attempt": 1 },
        status: "error",
      },
    ]);
  });

  it("records nothing by default", () => {
    const span = noopRunTracer.startSpan("invoke_workflow", {});
    expect(() => {
      span.setAttributes({ "draftloop.round": 1 });
      span.end("ok");
    }).not.toThrow();
  });
});
