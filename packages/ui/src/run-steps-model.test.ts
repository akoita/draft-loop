import { describe, expect, it } from "vitest";
import { runStepAdvances, runStepsEstimatedUsd } from "./run-steps-model.js";
import { normalizeRunTraceResult, type RunTraceSpanView } from "./run-trace-contract.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 11, 12, 0, seconds)).toISOString();

function span(overrides: Partial<RunTraceSpanView> & Pick<RunTraceSpanView, "spanId">) {
  return {
    parentSpanId: null,
    name: "invoke_workflow",
    startedAt: at(0),
    endedAt: at(1),
    status: "ok",
    attributes: {},
    ...overrides,
  } satisfies RunTraceSpanView;
}

const trace: readonly RunTraceSpanView[] = [
  span({ spanId: "w1", endedAt: at(50) }),
  span({
    spanId: "a1",
    parentSpanId: "w1",
    name: "invoke_agent",
    startedAt: at(1),
    endedAt: at(31),
    attributes: {
      "draftloop.step": "author",
      "draftloop.round": 1,
      "draftloop.attempt": 1,
      "gen_ai.request.model": "claude-sonnet-5-5",
      "draftloop.estimated_usd": 0.12,
    },
  }),
  span({
    spanId: "r1",
    parentSpanId: "a1",
    name: "retrieve_evidence",
    attributes: { "draftloop.retrieved_chunks": 12 },
  }),
  span({
    spanId: "a2",
    parentSpanId: "w1",
    name: "invoke_agent",
    startedAt: at(31),
    endedAt: at(50),
    status: "error",
    attributes: {
      "draftloop.step": "critic",
      "draftloop.round": 1,
      "draftloop.attempt": 2,
      "gen_ai.request.model": "gpt-6.1-terra",
      "error.type": "rate-limited",
    },
  }),
  // An advance that found the run waiting on the person calls no model.
  span({ spanId: "w2", startedAt: at(60), endedAt: at(60) }),
  // An attempt whose advance is not in the trace.
  span({ spanId: "a3", parentSpanId: "gone", name: "invoke_agent" }),
];

describe("run steps", () => {
  it("groups attempts under the advance that ran them, in start order", () => {
    const advances = runStepAdvances(trace);
    expect(advances).toHaveLength(1);
    expect(advances[0]).toMatchObject({ spanId: "w1", durationMs: 50_000, failed: true });
    expect(advances[0]?.attempts).toEqual([
      {
        spanId: "a1",
        step: "author",
        round: 1,
        attempt: 1,
        durationMs: 30_000,
        model: "claude-sonnet-5-5",
        estimatedUsd: 0.12,
        failed: false,
        errorType: null,
      },
      {
        spanId: "a2",
        step: "critic",
        round: 1,
        attempt: 2,
        durationMs: 19_000,
        model: "gpt-6.1-terra",
        estimatedUsd: null,
        failed: true,
        errorType: "rate-limited",
      },
    ]);
    expect(runStepsEstimatedUsd(advances)).toBe(0.12);
  });

  it("reads an unfinished attempt as having no duration and an empty trace as no steps", () => {
    const advances = runStepAdvances([
      span({ spanId: "w1", endedAt: null, status: null }),
      span({ spanId: "a1", parentSpanId: "w1", name: "invoke_agent", endedAt: null, status: null }),
    ]);
    expect(advances[0]).toMatchObject({ durationMs: null, failed: false });
    expect(advances[0]?.attempts[0]).toMatchObject({ step: null, durationMs: null, failed: false });
    expect(runStepsEstimatedUsd(advances)).toBeNull();
    expect(runStepAdvances([])).toEqual([]);
  });
});

describe("run trace contract", () => {
  const result = { workspaceId: "owner", runId: "run-1", spans: trace };

  it("accepts a content-free trace", () => {
    expect(normalizeRunTraceResult(result)).toEqual(result);
  });

  it("refuses a span that carries an unknown attribute or free text", () => {
    const withAttribute = (attributes: Record<string, unknown>) => ({
      ...result,
      spans: [{ ...trace[0], attributes }],
    });
    expect(normalizeRunTraceResult(withAttribute({ "draft.text": "x" }))).toBeUndefined();
    expect(
      normalizeRunTraceResult(withAttribute({ "error.type": "a sentence of free text" })),
    ).toBeUndefined();
    expect(
      normalizeRunTraceResult({ ...result, spans: [{ ...trace[0], extra: 1 }] }),
    ).toBeUndefined();
  });
});
