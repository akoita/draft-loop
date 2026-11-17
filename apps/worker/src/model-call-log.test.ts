import { describe, expect, it } from "vitest";

import { currentJobUsage, modelCallLog, totalUsage, withJobIds } from "./model-call-log.js";

const call = {
  purpose: "profile-derivation",
  company: "anthropic",
  model: "claude-haiku",
  route: "vertex-eu",
  inputTokens: 5000,
  outputTokens: 1200,
  estimatedUsd: 0.011,
  failed: false,
} as const;

describe("modelCallLog", () => {
  it("logs each call with the ids of the job that made it", async () => {
    const lines: string[] = [];
    const meter = modelCallLog((line) => lines.push(line));
    await withJobIds({ tenantId: "t1", workspaceId: "w1", profileId: "p1" }, async () => {
      await Promise.resolve();
      meter(call);
    });
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      severity: "INFO",
      message: "model call",
      tenantId: "t1",
      workspaceId: "w1",
      profileId: "p1",
      ...call,
    });
  });

  it("logs a failed call as a warning", () => {
    const lines: string[] = [];
    modelCallLog((line) => lines.push(line))({ ...call, failed: true });
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ severity: "WARNING", failed: true });
  });

  it("totals the running job's calls, failed ones included, and nothing outside a job", async () => {
    const meter = modelCallLog(() => undefined);
    meter(call);
    expect(currentJobUsage()).toBeUndefined();
    const usage = await withJobIds({ profileId: "p1" }, async () => {
      expect(currentJobUsage()).toBeUndefined();
      meter(call);
      meter({ ...call, inputTokens: 100, outputTokens: 0, estimatedUsd: 0.001, failed: true });
      return currentJobUsage();
    });
    expect(usage).toEqual({
      calls: 2,
      failedCalls: 1,
      inputTokens: 5100,
      outputTokens: 1200,
      estimatedUsd: 0.012,
    });
  });

  it("gives no cost when a model has no price", () => {
    expect(totalUsage([call, { ...call, estimatedUsd: null }]).estimatedUsd).toBeNull();
  });
});
