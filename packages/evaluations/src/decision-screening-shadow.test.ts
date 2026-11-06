import { contentScreeningCorpus } from "@draft-loop/ingestion/content-screening-corpus";
import type {
  DecisionModel,
  DecisionRequest,
  DecisionResult,
} from "@draft-loop/providers/decisions";
import { describe, expect, it } from "vitest";
import {
  estimateScreeningShadowTokens,
  scoreScreeningShadow,
  screeningJudgments,
  screeningQuestions,
  screeningSignalsFrom,
} from "./decision-screening-shadow.js";
import { runScreeningShadow } from "./decision-screening-shadow-command.js";

function scriptedModel(answer: (request: DecisionRequest) => Record<string, number | "refusal">): {
  model: DecisionModel;
  requests: DecisionRequest[];
} {
  const requests: DecisionRequest[] = [];
  return {
    requests,
    model: {
      identity: { vendor: "typesafe-jev", model: "jev-latest" },
      async decide(request): Promise<DecisionResult> {
        requests.push(request);
        const probabilities = answer(request);
        return {
          vendor: "typesafe-jev",
          model: "jev-1.14.0",
          requestId: null,
          usage: { inputTokens: 100, outputTokens: 0 },
          answers: Object.fromEntries(
            request.questions.map((question) => {
              const value = probabilities[question.name] ?? 0;
              return [
                question.name,
                value === "refusal"
                  ? { kind: "refusal", name: question.name }
                  : { kind: "predicate", name: question.name, probability: value },
              ];
            }),
          ),
        };
      },
    },
  };
}

describe("decision screening shadow", () => {
  it("asks one yes/no judgment per screened signal", () => {
    expect(screeningQuestions().map((question) => [question.kind, question.name])).toEqual(
      Object.keys(screeningJudgments).map((name) => ["predicate", name]),
    );
  });

  it("turns probabilities into signals by threshold and fails closed on a refusal", () => {
    expect(
      screeningSignalsFrom(
        {
          "role-change": { kind: "predicate", name: "role-change", probability: 0.8 },
          "instruction-override": {
            kind: "predicate",
            name: "instruction-override",
            probability: 0.49,
          },
          "hidden-text": { kind: "refusal", name: "hidden-text" },
        },
        0.5,
      ),
    ).toEqual({ found: ["hidden-text", "role-change"], refusals: 1 });
  });

  it("scores catches, misses, false alarms and exact matches", () => {
    const report = scoreScreeningShadow(
      [
        {
          id: "a",
          expected: ["instruction-override"],
          found: ["instruction-override"],
          refusals: 0,
          latencyMs: 100,
          inputTokens: 1_000_000,
        },
        {
          id: "b",
          expected: ["hidden-text"],
          found: [],
          refusals: 0,
          latencyMs: 300,
          inputTokens: null,
        },
        {
          id: "c",
          expected: [],
          found: ["role-change"],
          refusals: 0,
          latencyMs: 200,
          inputTokens: 0,
        },
        { id: "d", expected: [], found: [], refusals: 0, latencyMs: 400, inputTokens: 0 },
      ],
      0.042,
    );
    expect(report).toMatchObject({
      cases: 4,
      injectedCases: 2,
      injectedCaught: 1,
      cleanCases: 2,
      cleanFalseAlarms: 1,
      exactMatches: 2,
      missedInjectedIds: ["b"],
      falseAlarmIds: ["c"],
      latencyMs: { p50: 200, p95: 400, max: 400 },
      estimatedCostUsd: 0.042,
    });
    expect(report.perSignal["hidden-text"]).toEqual({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 1,
    });
    expect(report.perSignal["role-change"]).toEqual({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 0,
    });
  });

  it("estimates the whole corpus well under the $0.50 cap", () => {
    expect(
      (estimateScreeningShadowTokens(contentScreeningCorpus) / 1_000_000) * 0.042,
    ).toBeLessThan(0.01);
  });

  it("runs every corpus case once, with the case text alone as input", async () => {
    const scripted = scriptedModel((request) =>
      String(request.input).toLowerCase().includes("ignore") ? { "instruction-override": 0.9 } : {},
    );
    const report = await runScreeningShadow(scripted.model, { maxUsd: 0.5, threshold: 0.5 });

    expect(scripted.requests).toHaveLength(contentScreeningCorpus.length);
    expect(new Set(scripted.requests.map((request) => request.input))).toEqual(
      new Set(contentScreeningCorpus.map((corpusCase) => corpusCase.text)),
    );
    expect(scripted.requests.every((request) => !request.dataPolicy.sensitiveData)).toBe(true);
    expect(report.cases).toBe(contentScreeningCorpus.length);
    expect(report.answeredModels).toEqual(["jev-1.14.0"]);
  });

  it("refuses to start when the estimate exceeds the cap", async () => {
    const scripted = scriptedModel(() => ({}));
    await expect(
      runScreeningShadow(scripted.model, { maxUsd: 0.000_001, threshold: 0.5 }),
    ).rejects.toThrow(/exceeds/);
    expect(scripted.requests).toHaveLength(0);
  });
});
