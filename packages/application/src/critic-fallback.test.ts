import type {
  AgentExecution,
  CriticAgent,
  CriticRequest,
  Critique,
} from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { runCriticWithFallback, withCriticFallback } from "./critic-fallback.js";

function request(round: number): CriticRequest {
  return { runId: "run-1", round } as unknown as CriticRequest;
}

function execution(provider: string, modelId: string): AgentExecution<Critique> {
  return {
    output: {} as Critique,
    provider,
    modelId,
    providerRequestId: null,
    outputChecksum: "sha256:0",
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    estimatedUsd: null,
    completedAt: "2026-11-19T18:00:00.000Z",
  };
}

class ProviderFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function failing(code: string, calls: number[]): CriticAgent {
  return {
    execute: async (req) => {
      calls.push(req.round);
      throw new ProviderFailure(code);
    },
  };
}

function answering(provider: string, model: string, calls: number[]): CriticAgent {
  return {
    execute: async (req) => {
      calls.push(req.round);
      return execution(provider, model);
    },
  };
}

describe("the critic fallback (#3122)", () => {
  it("switches once on a quota error and records the critic it replaced", async () => {
    const primaryCalls: number[] = [];
    const fallbackCalls: number[] = [];
    let reads = 0;
    const critic = withCriticFallback({
      primary: failing("quota-exhausted", primaryCalls),
      primaryProvider: "openai",
      primaryModel: "gpt-6.1-terra",
      fallback: () => {
        reads += 1;
        return answering("anthropic", "claude-haiku-5-5", fallbackCalls);
      },
    });

    const first = await critic.execute(request(2));
    const second = await critic.execute(request(3));

    expect(first).toMatchObject({
      provider: "anthropic",
      modelId: "claude-haiku-5-5",
      criticFallback: {
        fromProvider: "openai",
        fromModel: "gpt-6.1-terra",
        errorClass: "quota-exhausted",
        round: 2,
      },
    });
    expect(second.criticFallback).toEqual(first.criticFallback);
    expect(primaryCalls).toEqual([2]);
    expect(fallbackCalls).toEqual([2, 3]);
    expect(reads).toBe(1);
  });

  it("does not switch when no fallback may be used, such as a consent that does not cover it", async () => {
    const primaryCalls: number[] = [];
    const critic = withCriticFallback({
      primary: failing("authentication", primaryCalls),
      primaryProvider: "openai",
      primaryModel: "gpt-6.1-terra",
      fallback: () => undefined,
    });

    await expect(critic.execute(request(1))).rejects.toMatchObject({ code: "authentication" });
    await expect(critic.execute(request(1))).rejects.toMatchObject({ code: "authentication" });
    expect(primaryCalls).toEqual([1, 1]);
  });

  it("leaves errors the run can wait out or fix to the run", async () => {
    for (const code of ["rate-limit", "timeout", "invalid-response", "cancelled"]) {
      const fallbackCalls: number[] = [];
      const critic = withCriticFallback({
        primary: failing(code, []),
        primaryProvider: "openai",
        primaryModel: "gpt-6.1-terra",
        fallback: () => answering("anthropic", "claude-haiku-5-5", fallbackCalls),
      });
      await expect(critic.execute(request(1))).rejects.toMatchObject({ code });
      expect(fallbackCalls).toEqual([]);
    }
  });

  it("passes a working critic's executions through untouched", async () => {
    const critic = withCriticFallback({
      primary: answering("openai", "gpt-6.1-terra", []),
      primaryProvider: "openai",
      primaryModel: "gpt-6.1-terra",
      fallback: () => {
        throw new Error("not read");
      },
    });
    const result = await critic.execute(request(1));
    expect(result.criticFallback).toBeUndefined();
    expect(result.provider).toBe("openai");
  });

  it("builds no wrapper without a fallback, or for one naming the run's own critic (#3131)", () => {
    const built: string[] = [];
    const criticFor = (company: string, modelId: string) => {
      built.push(`${company}:${modelId}`);
      return answering(company, modelId, []);
    };
    const identity = { company: "openai", modelId: "gpt-6.1-terra" };
    const permitted = async () => true;

    runCriticWithFallback(identity, undefined, criticFor);
    runCriticWithFallback(identity, { ...identity, permitted }, criticFor);
    expect(built).toEqual(["openai:gpt-6.1-terra", "openai:gpt-6.1-terra"]);
  });

  it("switches to the deployment's fallback only when consent covers its company (#3131)", async () => {
    const identity = { company: "openai", modelId: "gpt-6.1-terra" };
    const criticFor = (company: string, modelId: string) =>
      company === "openai" ? failing("quota-exhausted", []) : answering(company, modelId, []);
    const fallback = (allowed: boolean) => ({
      company: "anthropic",
      modelId: "claude-haiku-5-5",
      permitted: async () => allowed,
    });

    const allowed = runCriticWithFallback(identity, fallback(true), criticFor);
    const result = await allowed.execute(request(1));
    expect(result.provider).toBe("anthropic");
    expect(result.criticFallback).toMatchObject({ errorClass: "quota-exhausted" });

    const refused = runCriticWithFallback(identity, fallback(false), criticFor);
    await expect(refused.execute(request(1))).rejects.toMatchObject({ code: "quota-exhausted" });
  });
});
