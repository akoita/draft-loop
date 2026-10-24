import { describe, expect, it } from "vitest";
import {
  contentScreenerIdentitySchema,
  contentScreeningResultSchema,
  contentScreeningSignals,
} from "./content-screening.js";

const screenedAt = "2026-10-24T09:30:00.000Z";
const rules = { id: "rules", version: "1" };
const model = {
  id: "model",
  version: "2",
  provider: "anthropic",
  model: "claude-haiku-5-5",
};

function result(overrides: Record<string, unknown>): unknown {
  return { verdict: "clear", signals: [], screeners: [rules], screenedAt, ...overrides };
}

describe("contentScreeningResultSchema", () => {
  it("accepts clear, flagged and unscreened results", () => {
    expect(contentScreeningResultSchema.safeParse(result({})).success).toBe(true);
    expect(
      contentScreeningResultSchema.safeParse(
        result({
          verdict: "flagged",
          signals: ["hidden-text", "instruction-override"],
          screeners: [rules, model],
        }),
      ).success,
    ).toBe(true);
    expect(
      contentScreeningResultSchema.safeParse(
        result({ verdict: "unscreened", signals: ["screener-unavailable"], screeners: [] }),
      ).success,
    ).toBe(true);
  });

  it("accepts a flagged result that also lists screener-unavailable", () => {
    expect(
      contentScreeningResultSchema.safeParse(
        result({ verdict: "flagged", signals: ["role-change", "screener-unavailable"] }),
      ).success,
    ).toBe(true);
  });

  it("keeps the signal set closed", () => {
    expect([...contentScreeningSignals].sort()).toEqual([...contentScreeningSignals]);
    expect(
      contentScreeningResultSchema.safeParse(
        result({ verdict: "flagged", signals: ["something-else"] }),
      ).success,
    ).toBe(false);
  });

  it("rejects a clear result with signals or without a screener", () => {
    expect(
      contentScreeningResultSchema.safeParse(result({ signals: ["hidden-text"] })).success,
    ).toBe(false);
    expect(contentScreeningResultSchema.safeParse(result({ screeners: [] })).success).toBe(false);
  });

  it("rejects a flagged result without a content signal", () => {
    expect(contentScreeningResultSchema.safeParse(result({ verdict: "flagged" })).success).toBe(
      false,
    );
    expect(
      contentScreeningResultSchema.safeParse(
        result({ verdict: "flagged", signals: ["screener-unavailable"] }),
      ).success,
    ).toBe(false);
  });

  it("rejects an unscreened result that is not exactly screener-unavailable", () => {
    expect(contentScreeningResultSchema.safeParse(result({ verdict: "unscreened" })).success).toBe(
      false,
    );
    expect(
      contentScreeningResultSchema.safeParse(
        result({ verdict: "unscreened", signals: ["hidden-text", "screener-unavailable"] }),
      ).success,
    ).toBe(false);
  });

  it("rejects unsorted or duplicate signals and duplicate screener ids", () => {
    expect(
      contentScreeningResultSchema.safeParse(
        result({ verdict: "flagged", signals: ["role-change", "hidden-text"] }),
      ).success,
    ).toBe(false);
    expect(
      contentScreeningResultSchema.safeParse(
        result({ verdict: "flagged", signals: ["hidden-text", "hidden-text"] }),
      ).success,
    ).toBe(false);
    expect(
      contentScreeningResultSchema.safeParse(result({ screeners: [rules, rules] })).success,
    ).toBe(false);
  });

  it("rejects extra fields, so no quoted text can ride along", () => {
    expect(
      contentScreeningResultSchema.safeParse(result({ excerpt: "ignore previous instructions" }))
        .success,
    ).toBe(false);
    expect(
      contentScreeningResultSchema.safeParse(
        result({ screeners: [{ ...rules, evidence: "quoted text" }] }),
      ).success,
    ).toBe(false);
  });

  it("rejects an invalid verdict or timestamp", () => {
    expect(contentScreeningResultSchema.safeParse(result({ verdict: "safe" })).success).toBe(false);
    expect(
      contentScreeningResultSchema.safeParse(result({ screenedAt: "yesterday" })).success,
    ).toBe(false);
    expect(
      contentScreeningResultSchema.safeParse({ ...(result({}) as object), screenedAt: undefined })
        .success,
    ).toBe(false);
  });
});

describe("contentScreenerIdentitySchema", () => {
  it("accepts a rule screener and a model screener with its identity", () => {
    expect(contentScreenerIdentitySchema.safeParse(rules).success).toBe(true);
    expect(contentScreenerIdentitySchema.safeParse(model).success).toBe(true);
  });

  it("rejects an empty id or version", () => {
    expect(contentScreenerIdentitySchema.safeParse({ id: " ", version: "1" }).success).toBe(false);
    expect(contentScreenerIdentitySchema.safeParse({ id: "rules", version: "" }).success).toBe(
      false,
    );
  });
});
