import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { describe, expect, it, vi } from "vitest";

import { createModelProfileRegistry, defaultModelProfileRegistry } from "./model-profiles.js";
import {
  RunModelProfileError,
  type RunProviderAuthModeConfiguration,
  resolveRunModelProfiles,
} from "./run-model-profiles.js";

const apiKeyRoutes: RunProviderAuthModeConfiguration = {
  anthropic: "api-key",
  openai: "api-key",
};

function profile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "test-profile",
    version: 1,
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    tier: "economy",
    roles: ["author"],
    runtime: {
      effort: "provider-default",
      maxOutputTokens: 4096,
      thinking: { mode: "budgeted", maxTokens: 1024 },
    },
    knownLimits: { maxOutputTokens: 64000 },
    ...overrides,
  };
}

function references(authorId: string, criticId: string, version = 1) {
  return {
    author: { id: authorId, version },
    critic: { id: criticId, version },
  };
}

function registryFor(author = profile(), critic?: ModelProfile) {
  return createModelProfileRegistry([
    author,
    critic ??
      profile({
        id: "test-critic",
        provider: "openai",
        modelId: "gpt-5.6-luna",
        roles: ["critic"],
        runtime: {
          effort: "provider-default",
          maxOutputTokens: 4096,
          thinking: { mode: "provider-default" },
        },
      }),
  ]);
}

describe("run model profile resolution", () => {
  it("resolves exact role references once and accepts the verified Claude session snapshot", () => {
    const calls: unknown[][] = [];
    const registry = {
      resolve: vi.fn((id: string, version: number, role: "author" | "critic") => {
        calls.push([id, version, role]);
        return defaultModelProfileRegistry.resolve(id, version, role);
      }),
      list: () => [],
    };

    const resolved = resolveRunModelProfiles(
      references("legacy-anthropic-author", "legacy-openai-critic"),
      registry,
      { anthropic: "user-session", openai: "api-key" },
    );

    expect(calls).toEqual([
      ["legacy-anthropic-author", 1, "author"],
      ["legacy-openai-critic", 1, "critic"],
    ]);
    expect(resolved.author.runtime.maxOutputTokens).toBe(32768);
  });

  it.each([
    ["unknown profile", references("missing-secret-id", "test-critic")],
    ["wrong version", references("test-profile", "test-critic", 2)],
    ["wrong role", references("test-profile", "test-profile")],
    [
      "extra reference field",
      {
        author: { id: "test-profile", version: 1, fallback: "must not leak" },
        critic: { id: "test-critic", version: 1 },
      },
    ],
  ])("rejects %s with a fixed safe error", (_label, refs) => {
    let thrown: unknown;
    try {
      resolveRunModelProfiles(refs, registryFor(), apiKeyRoutes);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RunModelProfileError);
    expect((thrown as Error).message).not.toContain("missing-secret-id");
    expect((thrown as Error).message).not.toContain("must not leak");
  });

  it.each([
    profile({ provider: "local", modelId: "local-model" }),
    profile({ provider: "unregistered-provider", modelId: "unknown-model" }),
    profile({
      runtime: {
        effort: "provider-default",
        maxOutputTokens: 4096,
        thinking: { mode: "budgeted", maxTokens: 4096 },
      },
    }),
    profile({
      runtime: {
        effort: "provider-default",
        maxOutputTokens: 4096,
        thinking: { mode: "budgeted", maxTokens: 1023 },
      },
    }),
    profile({
      runtime: {
        effort: "provider-default",
        maxOutputTokens: 32769,
        thinking: { mode: "provider-default" },
      },
      knownLimits: { maxOutputTokens: 64000 },
    }),
  ])("rejects a profile whose provider route cannot enforce its declared controls", (invalid) => {
    const registry = registryFor(invalid);
    expect(() =>
      resolveRunModelProfiles(references(invalid.id, "test-critic"), registry, apiKeyRoutes),
    ).toThrow(RunModelProfileError);
  });

  it("rejects OpenAI thinking controls and OpenAI user-session transport", () => {
    const openAi = profile({
      provider: "openai",
      modelId: "gpt-5.6-luna",
      roles: ["author"],
      runtime: {
        effort: "provider-default",
        maxOutputTokens: 4096,
        thinking: { mode: "provider-default" },
      },
    });
    const openAiThinking = {
      ...openAi,
      runtime: { ...openAi.runtime, thinking: { mode: "disabled" as const } },
    };
    expect(() =>
      resolveRunModelProfiles(
        references(openAiThinking.id, "test-critic"),
        registryFor(openAiThinking),
        apiKeyRoutes,
      ),
    ).toThrow(RunModelProfileError);
    expect(() =>
      resolveRunModelProfiles(references(openAi.id, "test-critic"), registryFor(openAi), {
        ...apiKeyRoutes,
        openai: "user-session",
      }),
    ).toThrow(RunModelProfileError);
  });

  it("rejects budgeted thinking on an unverified Claude model and incompatible Sonnet effort", () => {
    const generic = profile({ modelId: "claude-unverified-model" });
    expect(() =>
      resolveRunModelProfiles(references(generic.id, "test-critic"), registryFor(generic), {
        ...apiKeyRoutes,
        anthropic: "user-session",
      }),
    ).toThrow(RunModelProfileError);
    const effortfulSonnet = profile({
      runtime: { ...profile().runtime, effort: "high" },
    });
    expect(() =>
      resolveRunModelProfiles(
        references(effortfulSonnet.id, "test-critic"),
        registryFor(effortfulSonnet),
        { ...apiKeyRoutes, anthropic: "user-session" },
      ),
    ).toThrow(RunModelProfileError);
  });

  it("accepts only the exact development GLM profile route", () => {
    const glm = defaultModelProfileRegistry.resolve("dev-deepinfra-glm-author", 1, "author");
    expect(
      resolveRunModelProfiles(references(glm.id, "test-critic"), registryFor(glm), apiKeyRoutes)
        .author,
    ).toEqual(glm);

    for (const invalid of [
      { ...glm, modelId: "another-glm-model" },
      { ...glm, runtime: { ...glm.runtime, effort: "medium" as const } },
      { ...glm, runtime: { ...glm.runtime, thinking: { mode: "disabled" as const } } },
    ]) {
      expect(() =>
        resolveRunModelProfiles(
          references(invalid.id, "test-critic"),
          registryFor(invalid),
          apiKeyRoutes,
        ),
      ).toThrow(RunModelProfileError);
    }
  });
});
