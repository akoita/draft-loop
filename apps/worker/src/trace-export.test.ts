import type { RunSpan, RunTracer } from "@draft-loop/orchestrator";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";

import { createTraceExport, traceExportConfig } from "./trace-export.js";

/** Synthetic text standing in for anything a person might send or a model might write. */
const marker = "SYNTHETIC CANDIDATE TEXT, with spaces";

function recordingTracer() {
  const started: { name: string; parent: RunSpan | undefined; span: RunSpan }[] = [];
  const tracer: RunTracer = {
    startSpan: (name, _attributes, parent) => {
      const span: RunSpan = { setAttributes: vi.fn(), end: vi.fn() };
      started.push({ name, parent, span });
      return span;
    },
  };
  return { tracer, started };
}

describe("trace export settings (#3238)", () => {
  it("is off unless asked for, and needs a project", () => {
    expect(traceExportConfig({})).toBeUndefined();
    expect(traceExportConfig({ DRAFT_LOOP_TRACE_EXPORT: "off" })).toBeUndefined();
    expect(
      traceExportConfig({
        DRAFT_LOOP_TRACE_EXPORT: "cloud-trace",
        DRAFT_LOOP_TRACE_PROJECT: "draft-loop-test",
      }),
    ).toEqual({ projectId: "draft-loop-test", serviceName: "draft-loop-worker" });
    expect(() => traceExportConfig({ DRAFT_LOOP_TRACE_EXPORT: "cloud-trace" })).toThrow(/PROJECT/u);
    expect(() => traceExportConfig({ DRAFT_LOOP_TRACE_EXPORT: "jaeger" })).toThrow(/cloud-trace/u);
  });
});

describe("mirrored run spans (#3238)", () => {
  it("exports each span with its parent and content-free attributes, and keeps the recorder", async () => {
    const exporter = new InMemorySpanExporter();
    const traces = createTraceExport(
      { projectId: "draft-loop-test", serviceName: "worker" },
      { exporter },
    );
    const primary = recordingTracer();
    const flush = vi.fn(async () => undefined);
    const recorder = traces.wrap({ tracer: primary.tracer, flush });

    const run = recorder.tracer.startSpan("invoke_workflow", { "draftloop.run.id": "run-1" });
    const call = recorder.tracer.startSpan(
      "invoke_agent",
      {
        "gen_ai.request.model": "claude-haiku-5-5",
        "gen_ai.usage.input_tokens": 120,
        "error.type": marker,
        // A name outside the vocabulary never leaves.
        ...({ "gen_ai.input.messages": marker } as object),
      },
      run,
    );
    call.setAttributes({ "draftloop.failure_reason": marker, "gen_ai.usage.output_tokens": 40 });
    call.end("error");
    run.end("ok");
    await recorder.flush();

    expect(flush).toHaveBeenCalledOnce();
    expect(primary.started.map(({ name }) => name)).toEqual(["invoke_workflow", "invoke_agent"]);
    expect(primary.started[1]?.parent).toBe(primary.started[0]?.span);

    const spans = exporter.getFinishedSpans();
    const workflow = spans.find((span) => span.name === "invoke_workflow");
    const agent = spans.find((span) => span.name === "invoke_agent");
    expect(agent?.parentSpanContext?.spanId).toBe(workflow?.spanContext().spanId);
    expect(agent?.spanContext().traceId).toBe(workflow?.spanContext().traceId);
    expect(agent?.status.code).toBe(2);
    expect(agent?.attributes).toEqual({
      "gen_ai.request.model": "claude-haiku-5-5",
      "gen_ai.usage.input_tokens": 120,
      "gen_ai.usage.output_tokens": 40,
    });
    expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain("SYNTHETIC");
    expect(workflow?.resource.attributes["gcp.project_id"]).toBe("draft-loop-test");
    await traces.shutdown();
  });

  it("never lets an export failure reach the run", async () => {
    const onError = vi.fn();
    const exporter = {
      export: () => {
        throw new Error("network down");
      },
      shutdown: async () => undefined,
    };
    const traces = createTraceExport(
      { projectId: "draft-loop-test", serviceName: "worker" },
      { exporter, onError },
    );
    const primary = recordingTracer();
    const recorder = traces.wrap({ tracer: primary.tracer, flush: async () => undefined });
    recorder.tracer.startSpan("invoke_workflow", {}).end("ok");
    await expect(recorder.flush()).resolves.toBeUndefined();
    await expect(traces.shutdown()).resolves.toBeUndefined();
  });
});
