import type { ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { type MeteredModelCall, meterAdapter } from "./model-call-meter.js";

const identity = {
  purpose: "opportunity-extraction",
  company: "anthropic",
  model: "claude-haiku",
} as const;

function answered(): ModelResponse<never> {
  return {
    output: undefined as never,
    contextSnapshotId: "op-1",
    provider: "anthropic",
    company: "anthropic",
    route: "anthropic-api",
    modelId: "claude-haiku-dated",
    providerRequestId: null,
    structuredOutputSha256: "x",
    usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
    cost: { estimatedUsd: 0.0027 },
  };
}

describe("meterAdapter", () => {
  it("returns the adapter itself without a meter", () => {
    const adapter = { execute: async () => answered() };
    expect(meterAdapter(adapter, identity, undefined)).toBe(adapter);
  });

  it("reports an answered call's model, route, tokens and cost", async () => {
    const calls: MeteredModelCall[] = [];
    const adapter = { label: "kept", execute: async (_request: never) => answered() };
    const metered = meterAdapter(adapter, identity, (call) => calls.push(call));
    await metered.execute(undefined as never);
    expect(metered.label).toBe("kept");
    expect(calls).toEqual([
      {
        purpose: "opportunity-extraction",
        company: "anthropic",
        model: "claude-haiku-dated",
        route: "anthropic-api",
        inputTokens: 1200,
        outputTokens: 300,
        estimatedUsd: 0.0027,
        failed: false,
      },
    ]);
  });

  it("reports a failed call with what the provider billed, and rethrows", async () => {
    const calls: MeteredModelCall[] = [];
    const failure = Object.assign(new Error("cut off"), {
      route: "vertex-eu",
      billed: {
        usage: { inputTokens: 900, outputTokens: 8192, totalTokens: 9092 },
        cost: { estimatedUsd: 0.042 },
      },
    });
    const adapter = {
      execute: async (_request: never): Promise<ModelResponse<never>> => {
        throw failure;
      },
    };
    const metered = meterAdapter(adapter, identity, (call) => calls.push(call));
    await expect(metered.execute(undefined as never)).rejects.toBe(failure);
    expect(calls).toEqual([
      {
        ...identity,
        route: "vertex-eu",
        inputTokens: 900,
        outputTokens: 8192,
        estimatedUsd: 0.042,
        failed: true,
      },
    ]);
  });

  it("reports a call that never answered as costing nothing", async () => {
    const calls: MeteredModelCall[] = [];
    const adapter = {
      execute: async (_request: never): Promise<ModelResponse<never>> => {
        throw new Error("network");
      },
    };
    await expect(
      meterAdapter(adapter, identity, (call) => calls.push(call)).execute(undefined as never),
    ).rejects.toThrow("network");
    expect(calls).toEqual([
      { ...identity, route: null, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, failed: true },
    ]);
  });
});
