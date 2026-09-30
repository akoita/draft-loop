import type { AgentRole } from "@draft-loop/domain";
import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { describe, expect, it } from "vitest";
import {
  createModelProfileRegistry,
  defaultModelProfileRegistry,
  ModelProfileRegistryError,
} from "./model-profiles.js";

function profile(
  overrides: Partial<Pick<ModelProfile, "id" | "version" | "roles" | "tier">> = {},
): ModelProfile {
  return {
    id: "test-profile",
    version: 1,
    provider: "anthropic",
    modelId: "test-model",
    tier: "standard",
    roles: ["author"],
    runtime: {
      effort: "medium",
      maxOutputTokens: 512,
      thinking: { mode: "budgeted", maxTokens: 128 },
    },
    knownLimits: { maxOutputTokens: 1024, contextWindowTokens: 8192 },
    ...overrides,
  };
}

function expectRegistryError(
  operation: () => unknown,
  code: ModelProfileRegistryError["code"],
  secret?: string,
): void {
  try {
    operation();
    expect.fail("Expected a registry error.");
  } catch (error) {
    expect(error).toBeInstanceOf(ModelProfileRegistryError);
    expect(error).toMatchObject({ code });
    if (secret !== undefined && error instanceof Error) {
      expect(error.message).not.toContain(secret);
    }
  }
}

describe("model profile registry", () => {
  it("preserves the legacy author and critic profile snapshots", () => {
    expect(defaultModelProfileRegistry.list().slice(0, 2)).toEqual([
      expect.objectContaining({
        id: "legacy-anthropic-author",
        version: 1,
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
        tier: "economy",
        roles: ["author"],
        runtime: expect.objectContaining({
          effort: "provider-default",
          maxOutputTokens: 32768,
          thinking: { mode: "budgeted", maxTokens: 16384 },
        }),
        knownLimits: { maxOutputTokens: 64000, contextWindowTokens: 200000 },
      }),
      expect.objectContaining({
        id: "legacy-openai-critic",
        version: 1,
        provider: "openai",
        modelId: "gpt-5.6-luna",
        tier: "economy",
        roles: ["critic"],
        runtime: expect.objectContaining({
          effort: "provider-default",
          maxOutputTokens: 16384,
          thinking: { mode: "provider-default" },
        }),
        knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1050000 },
      }),
    ]);
  });

  it("adds standard, premium, and current economy role-specific profiles without changing defaults", () => {
    const profiles = defaultModelProfileRegistry.list();
    expect(profiles).toHaveLength(7);
    expect(profiles.slice(2)).toEqual([
      {
        id: "standard-anthropic-author",
        version: 1,
        provider: "anthropic",
        modelId: "claude-opus-5-5",
        tier: "standard",
        roles: ["author"],
        runtime: {
          effort: "medium",
          maxOutputTokens: 32768,
          thinking: { mode: "provider-default" },
        },
        knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1000000 },
      },
      {
        id: "standard-openai-critic",
        version: 1,
        provider: "openai",
        modelId: "gpt-6-sol",
        tier: "standard",
        roles: ["critic"],
        runtime: {
          effort: "low",
          maxOutputTokens: 16384,
          thinking: { mode: "provider-default" },
        },
        knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1050000 },
      },
      {
        id: "premium-anthropic-author",
        version: 1,
        provider: "anthropic",
        modelId: "claude-fable-5-1",
        tier: "premium",
        roles: ["author"],
        runtime: {
          effort: "high",
          maxOutputTokens: 32768,
          thinking: { mode: "provider-default" },
        },
        knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1000000 },
      },
      {
        id: "premium-openai-critic",
        version: 1,
        provider: "openai",
        modelId: "gpt-6-astra",
        tier: "premium",
        roles: ["critic"],
        runtime: {
          effort: "medium",
          maxOutputTokens: 16384,
          thinking: { mode: "provider-default" },
        },
        knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1050000 },
      },
      {
        id: "economy-openai-critic",
        version: 1,
        provider: "openai",
        modelId: "gpt-6-luna",
        tier: "economy",
        roles: ["critic"],
        runtime: {
          effort: "low",
          maxOutputTokens: 16384,
          thinking: { mode: "provider-default" },
        },
        knownLimits: { maxOutputTokens: 128000, contextWindowTokens: 1050000 },
      },
    ]);
    expect(defaultModelProfileRegistry.resolve("legacy-anthropic-author", 1, "author")).toEqual(
      profiles[0],
    );
    expect(defaultModelProfileRegistry.resolve("legacy-openai-critic", 1, "critic")).toEqual(
      profiles[1],
    );
  });

  it("normalizes profile identities and rejects duplicate ID/version pairs", () => {
    expectRegistryError(
      () =>
        createModelProfileRegistry([
          profile({ id: " duplicate ", version: 3 }),
          profile({ id: "duplicate", version: 3 }),
        ]),
      "duplicate-profile",
    );
  });

  it("rejects invalid profile data without exposing candidate values", () => {
    const invalidEffort = {
      ...profile({ id: "private-candidate-model" }),
      runtime: { ...profile().runtime, effort: "unlisted-effort" },
    };
    const invalidLimits = {
      ...profile(),
      knownLimits: { maxOutputTokens: 128 },
    };

    expectRegistryError(
      () => createModelProfileRegistry([invalidEffort as unknown as ModelProfile]),
      "invalid-profile",
      "private-candidate-model",
    );
    expectRegistryError(() => createModelProfileRegistry([invalidLimits]), "invalid-profile");
    expectRegistryError(
      () => createModelProfileRegistry([profile({ id: "secret", roles: [] })]),
      "invalid-profile",
      "secret",
    );
  });

  it("requires an exact ID, version, and supported role without fallback", () => {
    const registry = createModelProfileRegistry([
      profile({ id: "versioned", version: 1 }),
      profile({ id: "versioned", version: 2, tier: "premium" }),
    ]);

    expect(registry.resolve("versioned", 2, "author").tier).toBe("premium");
    expect(registry.resolve("versioned", 1, "author").tier).toBe("standard");
    expectRegistryError(() => registry.resolve("versioned", 3, "author"), "not-found", "versioned");
    expectRegistryError(
      () => registry.resolve("missing-secret-id", 1, "author"),
      "not-found",
      "missing-secret-id",
    );
    expectRegistryError(
      () => registry.resolve("versioned", undefined as unknown as number, "author"),
      "not-found",
    );
    expectRegistryError(() => registry.resolve("versioned", 1, "critic"), "unsupported-role");
    expectRegistryError(
      () => registry.resolve("versioned", 1, "admin" as AgentRole),
      "unsupported-role",
    );
  });

  it("detaches constructor inputs and every returned nested snapshot", () => {
    const input = {
      id: "detached",
      version: 1,
      provider: "anthropic",
      modelId: "test-model",
      tier: "economy",
      roles: ["author"] as AgentRole[],
      runtime: {
        effort: "low",
        maxOutputTokens: 512,
        thinking: { mode: "budgeted" as const, maxTokens: 128 },
      },
      knownLimits: { maxOutputTokens: 1024, contextWindowTokens: 8192 },
    } satisfies ModelProfile;
    const registry = createModelProfileRegistry([input]);

    input.roles[0] = "critic";
    input.runtime.thinking.maxTokens = 256;
    input.knownLimits.contextWindowTokens = 16384;

    const resolved = registry.resolve("detached", 1, "author");
    expect(resolved.roles).toEqual(["author"]);
    expect(resolved.runtime.thinking).toEqual({ mode: "budgeted", maxTokens: 128 });
    expect(resolved.knownLimits.contextWindowTokens).toBe(8192);

    (resolved.roles as AgentRole[])[0] = "critic";
    (resolved.runtime.thinking as unknown as { maxTokens: number }).maxTokens = 1;
    (resolved.knownLimits as { contextWindowTokens?: number }).contextWindowTokens = 1;

    const returnedList = registry.list();
    const returnedListFirst = returnedList[0];
    if (returnedListFirst === undefined) {
      throw new Error("Expected a registered model profile.");
    }
    (returnedListFirst.roles as AgentRole[]).push("critic");
    (returnedListFirst.runtime.thinking as unknown as { maxTokens: number }).maxTokens = 2;
    returnedList[0] = profile({ id: "replacement" });
    returnedList.push(profile({ id: "extra" }));

    expect(registry.list()).toHaveLength(1);
    expect(registry.resolve("detached", 1, "author").roles).toEqual(["author"]);
    expect(registry.resolve("detached", 1, "author").runtime.thinking).toEqual({
      mode: "budgeted",
      maxTokens: 128,
    });
  });
});
