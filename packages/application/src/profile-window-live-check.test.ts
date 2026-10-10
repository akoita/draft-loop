import { ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import type { CanonicalProfileExtractionExecutor } from "./canonical-profile-extraction-fallback.js";
import {
  profileWindowLiveCheckCharacters,
  runProfileWindowLiveCheck,
  syntheticCareerText,
} from "./profile-window-live-check.js";
import { runProfileWindowLiveCheckCommand } from "./profile-window-live-check-command.js";

const model = { company: "mistral", modelId: "mistral-large-4", role: "author" as const };
const controls = {
  model: { ...model, promptTemplateVersion: "test" },
  systemPrompt: "test",
  maxOutputTokens: 32_768,
  dataPolicy: {
    allowTransmission: true,
    allowedCompanies: ["mistral"],
    sensitiveData: true,
    sensitiveDataAcknowledged: true,
    requestedRetention: "provider-default" as const,
  },
};

function sourceText(input: unknown): string {
  const sources = (input as { sources?: { text?: string }[] }).sources ?? [];
  return sources.map((source) => source.text ?? "").join("");
}

function fakeExecutor(
  tokensPerCharacter: number,
  limit = 32_768,
): CanonicalProfileExtractionExecutor {
  return {
    execute: async (request) => {
      const characters = sourceText(request.input).length;
      const outputTokens = Math.round(characters * tokensPerCharacter);
      if (outputTokens > limit) {
        throw new ProviderAdapterError("mistral", "invalid-response", "Output limit.", {
          retryable: false,
          failureStage: "output-token-budget-exceeded",
        });
      }
      return {
        output: { schemaVersion: 1, facts: [], issues: [] },
        contextSnapshotId: request.contextSnapshotId,
        provider: "mistral",
        company: "mistral",
        modelId: "mistral-large-4",
        providerRequestId: null,
        structuredOutputSha256: "0".repeat(64),
        usage: { inputTokens: characters, outputTokens, totalTokens: characters + outputTokens },
        cost: { estimatedUsd: null },
      };
    },
  };
}

describe("synthetic career text", () => {
  it("is deterministic, above the unplanned bound, and in both styles", () => {
    const dense = syntheticCareerText("dense");
    const prose = syntheticCareerText("prose");
    expect(dense).toBe(syntheticCareerText("dense"));
    expect(dense.length).toBeGreaterThanOrEqual(profileWindowLiveCheckCharacters);
    expect(prose.length).toBeGreaterThanOrEqual(profileWindowLiveCheckCharacters);
    expect(dense).toContain("\n- ");
    expect(prose).not.toContain("\n- ");
    expect(dense).toContain("## ");
  });
});

describe("profile window live check", () => {
  it("passes and reports the ratio when every window fits the output budget", async () => {
    const result = await runProfileWindowLiveCheck({ executor: fakeExecutor(1.1), controls });

    expect(result.passed).toBe(true);
    expect(result.windowCharacters).toBe(15_360);
    expect(result.outputLimitCalls).toBe(0);
    expect(result.maximumOutputTokensPerCharacter).toBeCloseTo(1.1, 2);
    for (const text of result.texts) {
      expect(text.completed).toBe(true);
      expect(text.calls.length).toBeGreaterThanOrEqual(5);
      expect(text.calls.every((call) => call.sourceCharacters <= 15_360)).toBe(true);
    }
  });

  it("fails and counts the calls that hit the output limit", async () => {
    // 2.5 tokens per character overflows a 15,360-character window but fits its halves.
    const result = await runProfileWindowLiveCheck({ executor: fakeExecutor(2.5), controls });

    expect(result.passed).toBe(false);
    expect(result.outputLimitCalls).toBeGreaterThan(0);
    expect(result.texts.every((text) => text.completed)).toBe(true);
  });

  it("refuses to run in CI and rejects malformed routes", async () => {
    const errors: string[] = [];
    const writeStderr = (value: string) => errors.push(value);
    expect(
      await runProfileWindowLiveCheckCommand([], { environment: { CI: "true" }, writeStderr }),
    ).toBe(2);
    expect(
      await runProfileWindowLiveCheckCommand(["mistral"], { environment: {}, writeStderr }),
    ).toBe(2);
    expect(errors.join("")).toContain("local-only");
  });

  it("runs each route through the injected executor and exits 0 when all pass", async () => {
    const output: string[] = [];
    const code = await runProfileWindowLiveCheckCommand(["mistral/mistral-large-4"], {
      environment: {},
      createExecutor: async () => fakeExecutor(1.1),
      writeStdout: (value) => output.push(value),
      writeStderr: () => undefined,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(output.join("")) as { results: { passed: boolean }[] };
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.passed).toBe(true);
  });
});
