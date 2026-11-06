import { contentScreeningCorpus } from "@draft-loop/ingestion/content-screening-corpus";
import type {
  DecisionModel,
  DecisionRequest,
  DecisionResult,
} from "@draft-loop/providers/decisions";
import { describe, expect, it } from "vitest";

import { ruleEvadingCorpus } from "./decision-screening-evading-corpus.js";
import {
  estimateScreeningShadowTokens,
  type ScreeningShadowCaseResult,
  scoreScreeningSet,
  screeningJudgments,
  screeningQuestions,
  screeningSignalsAt,
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

const none = {
  "instruction-override": 0,
  "role-change": 0,
  "exfiltration-link": 0,
  "hidden-text": 0,
};

function caseResult(
  id: string,
  expected: ScreeningShadowCaseResult["expected"],
  probabilities: Partial<ScreeningShadowCaseResult["probabilities"]>,
  ruleSignals: ScreeningShadowCaseResult["ruleSignals"] = [],
): ScreeningShadowCaseResult {
  return {
    id,
    expected,
    probabilities: { ...none, ...probabilities },
    ruleSignals,
    latencyMs: 100,
    inputTokens: 10,
  };
}

describe("decision screening shadow", () => {
  it("asks one yes/no judgment per screened signal", () => {
    expect(screeningQuestions().map((question) => [question.kind, question.name])).toEqual(
      Object.keys(screeningJudgments).map((name) => ["predicate", name]),
    );
  });

  it("raises signals at the threshold and fails closed on a refusal", () => {
    expect(
      screeningSignalsAt(
        { ...none, "role-change": 0.8, "instruction-override": 0.49, "hidden-text": null },
        0.5,
      ),
    ).toEqual(["role-change", "hidden-text"]);
  });

  it("scores the model alone, the rules alone, both together, and every threshold", () => {
    const report = scoreScreeningSet(
      [
        caseResult("caught-by-model", ["instruction-override"], { "instruction-override": 0.8 }),
        caseResult("caught-by-rules", ["hidden-text"], {}, ["hidden-text"]),
        caseResult("missed", ["role-change"], { "role-change": 0.4 }),
        caseResult("false-alarm", [], { "role-change": 0.6 }),
        caseResult("clean", [], {}),
      ],
      0.5,
    );

    expect(report).toMatchObject({ cases: 5, injectedCases: 3, cleanCases: 2, refusals: 0 });
    expect(report.model).toMatchObject({
      injectedCaught: 1,
      cleanFalseAlarms: 1,
      missedInjectedIds: ["caught-by-rules", "missed"],
      falseAlarmIds: ["false-alarm"],
      exactMatches: 2,
    });
    expect(report.rules).toMatchObject({ injectedCaught: 1, cleanFalseAlarms: 0 });
    expect(report.rulesOrModel).toMatchObject({ injectedCaught: 2, missedInjectedIds: ["missed"] });
    expect(report.byThreshold).toEqual([
      {
        threshold: 0.3,
        modelCaught: 2,
        modelFalseAlarms: 1,
        combinedCaught: 3,
        combinedFalseAlarms: 1,
      },
      {
        threshold: 0.5,
        modelCaught: 1,
        modelFalseAlarms: 1,
        combinedCaught: 2,
        combinedFalseAlarms: 1,
      },
      {
        threshold: 0.7,
        modelCaught: 1,
        modelFalseAlarms: 0,
        combinedCaught: 2,
        combinedFalseAlarms: 0,
      },
      {
        threshold: 0.9,
        modelCaught: 0,
        modelFalseAlarms: 0,
        combinedCaught: 1,
        combinedFalseAlarms: 0,
      },
    ]);
    expect(report.caseProbabilities.missed?.["role-change"]).toBe(0.4);
  });

  it("estimates both corpora well under the $0.50 cap", () => {
    const cases = [...contentScreeningCorpus, ...ruleEvadingCorpus];
    expect((estimateScreeningShadowTokens(cases) / 1_000_000) * 0.042).toBeLessThan(0.01);
  });

  it("runs every case of both corpora once, with the case text alone as input", async () => {
    const scripted = scriptedModel((request) =>
      String(request.input).toLowerCase().includes("ignore") ? { "instruction-override": 0.9 } : {},
    );
    const report = await runScreeningShadow(scripted.model, { maxUsd: 0.5, threshold: 0.5 });

    const all = [...contentScreeningCorpus, ...ruleEvadingCorpus];
    expect(scripted.requests).toHaveLength(all.length);
    expect(new Set(scripted.requests.map((request) => request.input))).toEqual(
      new Set(all.map((corpusCase) => corpusCase.text)),
    );
    expect(scripted.requests.every((request) => !request.dataPolicy.sensitiveData)).toBe(true);
    expect(report.ruleCorpus.cases).toBe(contentScreeningCorpus.length);
    expect(report.ruleEvading.cases).toBe(ruleEvadingCorpus.length);
    expect(report.ruleEvading.rules.injectedCaught).toBe(0);
    expect(report.answeredModels).toEqual(["jev-1.14.0"]);
    expect(report.stoppedAtCap).toBe(false);
    expect(JSON.stringify(report)).not.toContain(ruleEvadingCorpus[0]?.text);
  });

  it("refuses to start when the estimate exceeds the cap", async () => {
    const scripted = scriptedModel(() => ({}));
    await expect(
      runScreeningShadow(scripted.model, { maxUsd: 0.000_001, threshold: 0.5 }),
    ).rejects.toThrow(/exceeds/);
    expect(scripted.requests).toHaveLength(0);
  });
});
