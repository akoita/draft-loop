import {
  type DecisionModel,
  DecisionModelError,
  type DecisionRequest,
  type DecisionResult,
} from "@draft-loop/providers/decisions";
import { describe, expect, it } from "vitest";

import {
  createDecisionScreeningShadow,
  type ScreeningShadowInput,
  screeningShadowMaxChars,
} from "./decision-screening-shadow.js";

interface LogLine {
  readonly level: "info" | "warn";
  readonly fields: { readonly screeningShadow: Record<string, unknown> };
  readonly message: string;
}

function recordingLog(): ScreeningShadowInput["log"] & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    lines,
    info: (fields, message) => lines.push({ level: "info", fields: fields as never, message }),
    warn: (fields, message) => lines.push({ level: "warn", fields: fields as never, message }),
  };
}

function scriptedModel(
  answer: (request: DecisionRequest) => Record<string, number> | Error,
  inputTokens = 1_000,
): DecisionModel & { readonly requests: DecisionRequest[] } {
  const requests: DecisionRequest[] = [];
  return {
    requests,
    identity: { vendor: "typesafe-jev", model: "jev-latest" },
    async decide(request): Promise<DecisionResult> {
      requests.push(request);
      const probabilities = answer(request);
      if (probabilities instanceof Error) throw probabilities;
      return {
        vendor: "typesafe-jev",
        model: "jev-1.14.0",
        requestId: "jev-request-1",
        usage: { inputTokens, outputTokens: 0 },
        answers: Object.fromEntries(
          request.questions.map((question) => [
            question.name,
            {
              kind: "predicate",
              name: question.name,
              probability: probabilities[question.name] ?? 0.02,
            },
          ]),
        ),
      };
    },
  };
}

function input(
  log: ScreeningShadowInput["log"],
  overrides: Partial<ScreeningShadowInput> = {},
): ScreeningShadowInput {
  return {
    text: "A fictional job post for a support engineer.",
    tenantId: "tenant-1",
    resultId: "screening-1",
    verdict: "clear",
    signals: [],
    log,
    ...overrides,
  };
}

describe("decision screening shadow", () => {
  it("logs the model's signals at 0.7 beside the stored verdict, without the text", async () => {
    const model = scriptedModel(() => ({ "role-change": 0.88, "instruction-override": 0.55 }));
    const log = recordingLog();
    const shadow = createDecisionScreeningShadow({ model, maxDailyUsd: 0.1 });

    await shadow.observe(input(log));

    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.dataPolicy).toMatchObject({ sensitiveData: false });
    expect(model.requests[0]?.questions.map((question) => question.name)).toEqual([
      "instruction-override",
      "role-change",
      "exfiltration-link",
      "hidden-text",
    ]);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatchObject({
      level: "info",
      message: "content screening shadow",
      fields: {
        screeningShadow: {
          tenantId: "tenant-1",
          resultId: "screening-1",
          model: "jev-1.14.0",
          threshold: 0.7,
          verdict: "clear",
          modelSignals: ["role-change"],
          agreement: "model-only",
          truncated: false,
          inputTokens: 1_000,
        },
      },
    });
    expect(JSON.stringify(log.lines)).not.toContain("support engineer");
  });

  it("names agreement when both flag, and when only the screening does", async () => {
    const log = recordingLog();
    const flagging = createDecisionScreeningShadow({
      model: scriptedModel(() => ({ "hidden-text": 0.9 })),
      maxDailyUsd: 0.1,
    });
    const quiet = createDecisionScreeningShadow({
      model: scriptedModel(() => ({})),
      maxDailyUsd: 0.1,
    });

    await flagging.observe(input(log, { verdict: "flagged", signals: ["hidden-text"] }));
    await quiet.observe(input(log, { verdict: "flagged", signals: ["hidden-text"] }));
    await quiet.observe(input(log));

    expect(log.lines.map((line) => line.fields.screeningShadow.agreement)).toEqual([
      "both",
      "screening-only",
      "neither",
    ]);
  });

  it("cuts a long page before sending it", async () => {
    const model = scriptedModel(() => ({}));
    const log = recordingLog();
    const shadow = createDecisionScreeningShadow({ model, maxDailyUsd: 0.1 });

    await shadow.observe(input(log, { text: "x".repeat(screeningShadowMaxChars + 10) }));

    expect(String(model.requests[0]?.input)).toHaveLength(screeningShadowMaxChars);
    expect(log.lines[0]?.fields.screeningShadow.truncated).toBe(true);
  });

  it("logs a failure by code and never throws", async () => {
    const model = scriptedModel(
      () => new DecisionModelError("typesafe-jev", "rate-limit", "Rate limited."),
    );
    const log = recordingLog();
    const shadow = createDecisionScreeningShadow({ model, maxDailyUsd: 0.1 });

    await expect(shadow.observe(input(log))).resolves.toBeUndefined();

    expect(log.lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "content screening shadow failed",
        fields: { screeningShadow: expect.objectContaining({ code: "rate-limit" }) },
      }),
    ]);
  });

  it("stops at the daily cap, says so once, and starts again the next day", async () => {
    // 1,000,000 tokens at $0.042 per million: one call spends the whole $0.04 cap.
    const model = scriptedModel(() => ({}), 1_000_000);
    const log = recordingLog();
    let now = new Date("2026-11-06T10:00:00Z");
    const shadow = createDecisionScreeningShadow({ model, maxDailyUsd: 0.04, now: () => now });

    await shadow.observe(input(log));
    await shadow.observe(input(log));
    await shadow.observe(input(log));
    now = new Date("2026-11-07T00:00:01Z");
    await shadow.observe(input(log));

    expect(model.requests).toHaveLength(2);
    expect(log.lines.map((line) => line.message)).toEqual([
      "content screening shadow",
      "content screening shadow daily cap reached",
      "content screening shadow",
    ]);
  });

  it("refuses a cap that is not a positive number", () => {
    expect(() =>
      createDecisionScreeningShadow({ model: scriptedModel(() => ({})), maxDailyUsd: 0 }),
    ).toThrow(RangeError);
  });
});
