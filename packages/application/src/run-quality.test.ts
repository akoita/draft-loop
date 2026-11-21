import { describe, expect, it } from "vitest";

import {
  maximumRunQualityCodes,
  meanReadiness,
  type RunQualityInput,
  reachedQualityState,
  runQuality,
  runQualitySpanAttributes,
} from "./run-quality.js";

const secret = "Led the Zephyr migration at Acme, saving 40%";

const execution = (step: "author" | "critic" | "revision", modelId: string, extra = {}) => ({
  id: `e-${step}-${modelId}`,
  runId: "run-1",
  contextSnapshotId: "ctx-1",
  round: 1,
  step,
  status: "completed" as const,
  provider: "anthropic",
  modelId,
  providerRequestId: null,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  estimatedUsd: 0.01,
  completedAt: "2026-11-21T00:00:00.000Z",
  ...extra,
});

const run = (overrides: Partial<RunQualityInput> = {}): RunQualityInput =>
  ({
    state: "awaiting-approval",
    round: 2,
    totalCostUsd: 0.1234567,
    findings: [
      {
        code: "uncovered-requirement",
        severity: "error",
        category: "coverage",
        message: secret,
        requirementId: "r1",
      },
      {
        code: "uncovered-requirement",
        severity: "error",
        category: "coverage",
        message: secret,
        requirementId: "r1",
      },
      { code: "unsupported-metric", severity: "warning", category: "factuality", message: secret },
      { code: secret, severity: "warning", message: secret },
    ],
    latestEvaluation: {
      status: "awaiting-approval",
      stopReason: "max-rounds",
      ready: false,
      meetsRubric: false,
      bestAvailable: true,
      scoreVector: { relevance: 0.8, factuality: 0.9 },
      scores: [{ dimension: "relevance", score: 0.8, rationale: secret }],
    },
    executionHistory: [
      execution("author", "claude-haiku-5-5"),
      execution("critic", "gpt-terra", {
        output: {
          findings: [],
          coverageJudgements: [
            { requirementId: "r1", verdict: "not-satisfied", citedBlockIds: [], rationale: secret },
            { requirementId: "r2", verdict: "satisfied", citedBlockIds: ["b1"], rationale: secret },
            { requirementId: "r3", verdict: "satisfied", citedBlockIds: ["b2"], rationale: secret },
          ],
        },
      }),
      execution("revision", "claude-sonnet-5-5"),
      { ...execution("critic", "gpt-other"), status: "failed" as const },
    ],
    ...overrides,
  }) as unknown as RunQualityInput;

describe("runQuality", () => {
  it("records the critic's verdicts, readiness, findings and cost", () => {
    expect(runQuality(run())).toEqual({
      state: "awaiting-approval",
      round: 2,
      authorModel: "claude-sonnet-5-5",
      criticModel: "gpt-terra",
      criticFallback: false,
      readiness: {
        status: "awaiting-approval",
        stopReason: "max-rounds",
        ready: false,
        meetsRubric: false,
        bestAvailable: true,
        scores: { relevance: 0.8, factuality: 0.9 },
      },
      findings: {
        total: 4,
        errors: 2,
        warnings: 2,
        byCategory: [
          { code: "coverage", count: 2 },
          { code: "factuality", count: 1 },
          { code: "none", count: 1 },
        ],
        byCode: [
          { code: "uncovered-requirement", count: 2 },
          { code: "other", count: 1 },
          { code: "unsupported-metric", count: 1 },
        ],
      },
      coverage: { judged: 3, satisfied: 2, notSatisfied: 1, uncovered: 1 },
      estimatedUsd: 0.123457,
    });
  });

  it("never carries a message, rationale or free-text code", () => {
    const text = JSON.stringify(runQuality(run()));
    expect(text).not.toContain("Zephyr");
    expect(text).not.toContain("Acme");
    expect(text).not.toContain("r1");
  });

  it("handles a run with no draft, no critic and no evaluation", () => {
    expect(
      runQuality(
        run({ findings: [], latestEvaluation: null, executionHistory: [], totalCostUsd: 0 }),
      ),
    ).toMatchObject({
      authorModel: null,
      criticModel: null,
      readiness: null,
      findings: { total: 0, errors: 0, warnings: 0, byCategory: [], byCode: [] },
      coverage: { judged: 0, satisfied: 0, notSatisfied: 0, uncovered: 0 },
    });
  });

  it("caps the codes it lists and sums the rest as other", () => {
    const findings = Array.from({ length: maximumRunQualityCodes + 5 }, (_, index) => ({
      code: `code-${String(index).padStart(2, "0")}`,
      severity: "warning",
      message: secret,
    }));
    const { byCode } = runQuality(run({ findings } as Partial<RunQualityInput>)).findings;
    expect(byCode).toHaveLength(maximumRunQualityCodes);
    expect(byCode.at(-1)).toEqual({ code: "other", count: 6 });
  });

  it("notes a fallback critic", () => {
    const history = [
      execution("critic", "claude-haiku-5-5", { criticFallback: { company: "anthropic" } }),
    ];
    expect(
      runQuality(run({ executionHistory: history } as unknown as Partial<RunQualityInput>))
        .criticFallback,
    ).toBe(true);
  });
});

describe("the evaluate_run span (#3240)", () => {
  it("carries the verdict as scores and codes", () => {
    const quality = runQuality(run());
    expect(meanReadiness(quality)).toBe(0.85);
    expect(runQualitySpanAttributes(quality)).toEqual({
      "gen_ai.operation.name": "evaluate_run",
      "gen_ai.request.model": "gpt-terra",
      "draftloop.quality.author_model": "claude-sonnet-5-5",
      "draftloop.round": 2,
      "draftloop.estimated_usd": 0.123457,
      "draftloop.quality.state": "awaiting-approval",
      "draftloop.quality.ready": false,
      "draftloop.quality.stop_reason": "max-rounds",
      "draftloop.quality.readiness": 0.85,
      "draftloop.quality.uncovered": 1,
      "draftloop.quality.error_findings": 2,
    });
  });

  it("is recorded once per arrival at review", () => {
    const at = { state: "awaiting-approval", round: 1 } as const;
    expect(reachedQualityState(at, { state: "reviewing", round: 1 } as never)).toBe(true);
    expect(reachedQualityState(at, at)).toBe(false);
    expect(reachedQualityState({ ...at, round: 2 }, at)).toBe(true);
    expect(reachedQualityState({ state: "revising", round: 1 } as never)).toBe(false);
  });
});
