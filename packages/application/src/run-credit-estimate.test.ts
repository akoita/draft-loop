import type { ModelProfileTier } from "@draft-loop/domain/model-profile";
import { describe, expect, it } from "vitest";
import { getModelProfilePreset } from "./model-profile-catalog.js";
import { createModelProfileRegistry, defaultModelProfileRegistry } from "./model-profiles.js";
import {
  estimateRunCredits,
  RunCreditEstimateError,
  resolveRunCreditTiers,
  runCreditEstimateVersion,
} from "./run-credit-estimate.js";

const tiers: readonly ModelProfileTier[] = ["economy", "standard", "premium"];

describe("estimateRunCredits", () => {
  it("is version 1", () => {
    expect(runCreditEstimateVersion).toBe(1);
    expect(
      estimateRunCredits({ authorTier: "economy", criticTier: "economy", maxRounds: 1 }).version,
    ).toBe(1);
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [10, 5],
  ])("prices %i rounds on a non-premium pair at %i credits", (maxRounds, credits) => {
    for (const authorTier of ["economy", "standard"] as const) {
      for (const criticTier of ["economy", "standard"] as const) {
        const estimate = estimateRunCredits({ authorTier, criticTier, maxRounds });
        expect(estimate.credits).toBe(credits);
        expect(estimate.basis).toEqual({ base: 1, premium: false, roundBlocks: credits });
      }
    }
  });

  it.each([
    [1, 2],
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 6],
    [10, 10],
  ])("prices %i rounds with a premium model at %i credits", (maxRounds, credits) => {
    for (const other of tiers) {
      for (const [authorTier, criticTier] of [
        ["premium", other],
        [other, "premium"],
      ] as const) {
        const estimate = estimateRunCredits({ authorTier, criticTier, maxRounds });
        expect(estimate.credits).toBe(credits);
        expect(estimate.basis).toEqual({ base: 2, premium: true, roundBlocks: credits / 2 });
      }
    }
  });

  it("never prices more rounds below fewer", () => {
    for (const authorTier of tiers) {
      for (const criticTier of tiers) {
        let previous = 0;
        for (let maxRounds = 1; maxRounds <= 12; maxRounds += 1) {
          const { credits } = estimateRunCredits({ authorTier, criticTier, maxRounds });
          expect(credits).toBeGreaterThanOrEqual(previous);
          previous = credits;
        }
      }
    }
  });

  it("carries only numbers and flags", () => {
    const estimate = estimateRunCredits({
      authorTier: "premium",
      criticTier: "standard",
      maxRounds: 4,
    });
    expect(Object.keys(estimate).sort()).toEqual(["basis", "credits", "version"]);
    expect(Object.keys(estimate.basis).sort()).toEqual(["base", "premium", "roundBlocks"]);
  });

  it.each([0, -1, -2, 1.5, 2.0000001, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "rejects the round limit %s",
    (maxRounds) => {
      expect(() =>
        estimateRunCredits({ authorTier: "economy", criticTier: "economy", maxRounds }),
      ).toThrow(RunCreditEstimateError);
    },
  );
});

describe("resolveRunCreditTiers", () => {
  it("reads the tiers of a preset's exact pair", () => {
    for (const [presetId, expected] of [
      ["economy", ["economy", "economy"]],
      ["balanced", ["economy", "standard"]],
      ["standard", ["standard", "standard"]],
    ] as const) {
      const preset = getModelProfilePreset(presetId);
      expect(
        resolveRunCreditTiers({ modelProfiles: { author: preset.author, critic: preset.critic } }),
      ).toEqual({ status: "known", authorTier: expected[0], criticTier: expected[1] });
    }
  });

  it("finds a premium pair that no preset lists", () => {
    const result = resolveRunCreditTiers({
      modelProfiles: {
        author: { id: "premium-anthropic-author", version: 1 },
        critic: { id: "premium-openai-critic", version: 1 },
      },
    });
    expect(result).toEqual({ status: "known", authorTier: "premium", criticTier: "premium" });
    if (result.status === "known") {
      expect(estimateRunCredits({ ...result, maxRounds: 3 }).credits).toBe(4);
    }
  });

  it("reports an unregistered profile instead of guessing", () => {
    expect(
      resolveRunCreditTiers({
        modelProfiles: {
          author: { id: "economy-anthropic-author", version: 2 },
          critic: { id: "no-such-critic", version: 1 },
        },
      }),
    ).toEqual({ status: "unknown", role: "critic", reason: "unknown-profile" });
    expect(
      resolveRunCreditTiers({
        modelProfiles: {
          author: { id: "economy-anthropic-author", version: 99 },
          critic: { id: "economy-openai-critic", version: 1 },
        },
      }),
    ).toEqual({ status: "unknown", role: "author", reason: "unknown-profile" });
  });

  it("rejects a profile named for the wrong role", () => {
    expect(
      resolveRunCreditTiers({
        modelProfiles: {
          author: { id: "economy-openai-critic", version: 1 },
          critic: { id: "economy-openai-critic", version: 1 },
        },
      }),
    ).toEqual({ status: "unknown", role: "author", reason: "unknown-profile" });
  });

  it("uses the configured models when exactly one tier matches", () => {
    expect(
      resolveRunCreditTiers({
        configured: {
          author: { company: "anthropic", model: "claude-opus-5-5" },
          critic: { company: "openai", model: "gpt-6-astra" },
        },
      }),
    ).toEqual({ status: "known", authorTier: "standard", criticTier: "premium" });
  });

  it("lets a named pair override the configured models", () => {
    expect(
      resolveRunCreditTiers({
        modelProfiles: {
          author: { id: "premium-anthropic-author", version: 1 },
          critic: { id: "premium-openai-critic", version: 1 },
        },
        configured: {
          author: { company: "anthropic", model: "claude-haiku-5-5" },
          critic: { company: "openai", model: "gpt-6-luna" },
        },
      }),
    ).toEqual({ status: "known", authorTier: "premium", criticTier: "premium" });
  });

  it("reports a configured model no profile matches, or none at all", () => {
    expect(
      resolveRunCreditTiers({
        configured: {
          author: { company: "anthropic", model: "claude-opus-5-5" },
          critic: { company: "openai", model: "gpt-unlisted" },
        },
      }),
    ).toEqual({ status: "unknown", role: "critic", reason: "no-matching-profile" });
    expect(resolveRunCreditTiers({})).toEqual({
      status: "unknown",
      role: "author",
      reason: "no-matching-profile",
    });
  });

  it("reports a configured model whose profiles disagree on the tier", () => {
    const base = defaultModelProfileRegistry.resolve("economy-anthropic-author", 2, "author");
    const registry = createModelProfileRegistry([
      base,
      { ...base, id: "standard-same-model-author", tier: "standard" },
    ]);
    expect(
      resolveRunCreditTiers({
        registry,
        configured: {
          author: { company: base.provider, model: base.modelId },
          critic: { company: "openai", model: "gpt-6-luna" },
        },
      }),
    ).toEqual({ status: "unknown", role: "author", reason: "ambiguous-tier" });
  });
});
