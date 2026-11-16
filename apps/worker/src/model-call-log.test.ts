import { describe, expect, it } from "vitest";

import { modelCallLog, withJobIds } from "./model-call-log.js";

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
});
