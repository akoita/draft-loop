import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { type LiveResult, liveFailRates, liveRegressions, liveResultKey } from "./eval-live.js";

const models = {
  author: { modelId: "claude-haiku-5-5", promptTemplateVersion: "cli-author-v21" },
  critic: { modelId: "gpt-6-luna", promptTemplateVersion: "cli-critic-v12" },
};

const result = (overrides: Partial<LiveResult>): LiveResult => ({
  recordedAt: "2026-11-22T06:00:00.000Z",
  label: "test",
  commit: "abc12345",
  models,
  judge: { version: "cohort-judge-v1", model: "gpt-6-luna" },
  cases: ["case-nurse"],
  rounds: 4,
  costUsd: 0.2,
  failRates: {},
  ...overrides,
});

describe("live evaluation", () => {
  it("counts a missing draft as no-draft only", () => {
    const rates = liveFailRates([
      null,
      { "placeholder-left": "fail", "role-omission": "pass" },
      { "placeholder-left": "pass", "role-omission": "pass" },
      { "placeholder-left": "fail" },
    ]);
    expect(rates["no-draft"]).toBe(0.25);
    expect(rates["placeholder-left"]).toBeCloseTo(2 / 3);
    expect(rates["role-omission"]).toBe(0);
    expect(rates["scope-stretch"]).toBeUndefined();
  });

  it("compares only with a result from the same models, prompts and judge", () => {
    const before = result({
      label: "v20",
      models: {
        ...models,
        author: { ...models.author, promptTemplateVersion: "cli-author-v20" },
      },
      failRates: { "role-omission": 0 },
    });
    const current = result({ failRates: { "role-omission": 1 } });
    expect(liveResultKey(before)).not.toBe(liveResultKey(current));
    expect(liveRegressions(current, [before])).toEqual({ baseline: null, regressions: [] });
  });

  it("flags a rise of more than one round and ignores one extra failing round", () => {
    const baseline = result({ failRates: { "role-omission": 0.25, "placeholder-left": 0.5 } });
    const current = result({ failRates: { "role-omission": 0.5, "placeholder-left": 1 } });
    const { regressions } = liveRegressions(current, [baseline]);
    expect(regressions).toEqual([{ mode: "placeholder-left", before: 0.5, after: 1 }]);
  });

  it("starts from an empty, valid results file", () => {
    const file = JSON.parse(
      readFileSync(new URL("../fixtures/eval-live/results.json", import.meta.url), "utf8"),
    ) as { readonly schemaVersion: number; readonly results: readonly LiveResult[] };
    expect(file.schemaVersion).toBe(1);
    expect(Array.isArray(file.results)).toBe(true);
  });
});
