import { describe, expect, it } from "vitest";
import { createCapabilityPort, validateBridgeCommand } from "./bridge.js";
import {
  ModelProfileBridgeValidationError,
  parseModelProfileReferences,
  parseModelProfileSupportInput,
  parseModelProfileSupportResult,
  parseSavedModelProfilesResult,
  projectModelProfileSupport,
  projectSavedModelProfiles,
} from "./model-profile-bridge.js";

const apiKeyModes = { anthropic: "api-key", openai: "api-key" } as const;

function expectInvalid(operation: () => unknown): void {
  expect(operation).toThrow(ModelProfileBridgeValidationError);
}

describe("desktop model profile bridge projections", () => {
  it("accepts only an exact author/critic reference pair", () => {
    expect(
      parseModelProfileReferences({
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "standard-openai-critic", version: 2 },
      }),
    ).toEqual({
      author: { id: "standard-anthropic-author", version: 1 },
      critic: { id: "standard-openai-critic", version: 2 },
    });

    for (const malformed of [
      null,
      {},
      { author: { id: "x", version: 1 } },
      {
        author: { id: "x", version: 1, extra: true },
        critic: { id: "y", version: 1 },
      },
      { author: { id: "  ", version: 1 }, critic: { id: "y", version: 1 } },
      { author: { id: "x\u0000y", version: 1 }, critic: { id: "y", version: 1 } },
      { author: { id: "x".repeat(129), version: 1 }, critic: { id: "y", version: 1 } },
      {
        author: { id: "x", version: Number.MAX_SAFE_INTEGER + 1 },
        critic: { id: "y", version: 1 },
      },
      { author: { id: "x", version: 1 }, critic: { id: "y", version: 1 }, extra: true },
    ]) {
      expectInvalid(() => parseModelProfileReferences(malformed));
    }
  });

  it("validates support lookup identity and returns detached support data", () => {
    expect(parseModelProfileSupportInput({ workspaceId: "workspace-1" })).toEqual({
      workspaceId: "workspace-1",
    });
    expectInvalid(() => parseModelProfileSupportInput({ workspaceId: "workspace-1", path: "/x" }));

    const support = projectModelProfileSupport("workspace-1", apiKeyModes);
    expect(parseModelProfileSupportResult(support, "workspace-1")).toEqual(support);
    expect(support).toMatchObject({
      workspaceId: "workspace-1",
      authModes: apiKeyModes,
      profiles: expect.arrayContaining([
        { id: "legacy-anthropic-author", version: 1, supported: true },
        { id: "legacy-openai-critic", version: 1, supported: true },
      ]),
    });
    expectInvalid(() => parseModelProfileSupportResult(support, "workspace-2"));

    const mutable = support as unknown as { profiles: { supported: boolean }[] };
    const first = mutable.profiles[0];
    if (first === undefined) throw new Error("Expected a registered profile.");
    first.supported = false;
    mutable.profiles.pop();
    expect(projectModelProfileSupport("workspace-1", apiKeyModes).profiles).toHaveLength(13);
  });

  it("rejects malformed support results and bounded-list violations", () => {
    const valid = projectModelProfileSupport("workspace-1", apiKeyModes);
    const invalidResults: unknown[] = [
      { ...valid, unexpected: true },
      { ...valid, authModes: { anthropic: "api-key", openai: "oauth" } },
      { ...valid, profiles: [] },
      {
        ...valid,
        profiles: [
          ...valid.profiles,
          { id: valid.profiles[0]?.id, version: valid.profiles[0]?.version, supported: true },
        ],
      },
      {
        ...valid,
        profiles: valid.profiles.map((profile) => ({ ...profile, ignored: true })),
      },
      {
        ...valid,
        profiles: Array.from({ length: 257 }, (_value, index) => ({
          id: `profile-${index}`,
          version: 1,
          supported: true,
        })),
      },
    ];

    for (const result of invalidResults) {
      expectInvalid(() => parseModelProfileSupportResult(result));
    }
  });

  it("wires strict start references and bounded support output through bridge validation", async () => {
    const references = {
      author: { id: "legacy-anthropic-author", version: 1 },
      critic: { id: "legacy-openai-critic", version: 1 },
    };
    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "start", modelProfiles: references },
        },
      }),
    ).toMatchObject({ input: { action: { type: "start", modelProfiles: references } } });
    expect(() =>
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "start", modelProfiles: { ...references, unexpected: true } },
        },
      }),
    ).toThrow("invalid");

    const projected = projectModelProfileSupport("workspace-1", apiKeyModes);
    const port = createCapabilityPort({
      capabilities: ["models.profile-support"],
      invoke: async () => ({ ok: true, value: projected }),
    });
    await expect(
      port.execute({ type: "models.profile-support", input: { workspaceId: "workspace-1" } }),
    ).resolves.toEqual({ ok: true, value: projected });

    const invalidPort = createCapabilityPort({
      capabilities: ["models.profile-support"],
      invoke: async () => ({ ok: true, value: { ...projected, workspaceId: "other" } }),
    });
    await expect(
      invalidPort.execute({
        type: "models.profile-support",
        input: { workspaceId: "workspace-1" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });

  it("validates the saved-profile commands with their real payloads and exact key allowlists", async () => {
    const references = {
      author: { id: "standard-anthropic-author", version: 1 },
      critic: { id: "standard-openai-critic", version: 2 },
    };

    expect(
      validateBridgeCommand({
        type: "models.saved-profiles.read",
        input: { workspaceId: "workspace-1" },
      }),
    ).toEqual({ type: "models.saved-profiles.read", input: { workspaceId: "workspace-1" } });
    expect(
      validateBridgeCommand({
        type: "models.saved-profiles.save",
        input: { workspaceId: "workspace-1", modelProfiles: references },
      }),
    ).toEqual({
      type: "models.saved-profiles.save",
      input: { workspaceId: "workspace-1", modelProfiles: references },
    });
    expect(
      validateBridgeCommand({
        type: "models.saved-profiles.save",
        input: { workspaceId: "workspace-1", modelProfiles: null },
      }),
    ).toMatchObject({ input: { modelProfiles: null } });

    for (const input of [
      { workspaceId: "workspace-1", extra: true },
      { workspaceId: "workspace-1", modelProfiles: null },
    ]) {
      expect(() => validateBridgeCommand({ type: "models.saved-profiles.read", input })).toThrow();
    }
    for (const input of [
      { workspaceId: "workspace-1" },
      { workspaceId: "workspace-1", modelProfiles: undefined },
      { workspaceId: "workspace-1", modelProfiles: null, appliedAt: "2026-01-01T00:00:00.000Z" },
      { workspaceId: "workspace-1", modelProfiles: { ...references, extra: true } },
      { workspaceId: "workspace-1", modelProfiles: { author: references.author } },
      { modelProfiles: null },
    ]) {
      expect(() => validateBridgeCommand({ type: "models.saved-profiles.save", input })).toThrow();
    }
  });

  it("parses saved-profile results strictly and pairs a saved pair with its timestamp", () => {
    const references = {
      author: { id: "standard-anthropic-author", version: 1 },
      critic: { id: "standard-openai-critic", version: 2 },
    };
    const saved = projectSavedModelProfiles(
      "workspace-1",
      { modelProfiles: references, appliedAt: "2026-01-01T00:00:00.000Z" },
      "the critic profile is for another model",
    );
    expect(saved).toEqual({
      workspaceId: "workspace-1",
      modelProfiles: references,
      appliedAt: "2026-01-01T00:00:00.000Z",
      ignoredReason: "the critic profile is for another model",
    });
    expect(parseSavedModelProfilesResult(saved, "workspace-1")).toEqual(saved);
    expect(projectSavedModelProfiles("workspace-1", undefined, "ignored")).toEqual({
      workspaceId: "workspace-1",
      modelProfiles: null,
      appliedAt: null,
      ignoredReason: null,
    });

    expectInvalid(() => parseSavedModelProfilesResult(saved, "other"));
    expectInvalid(() => parseSavedModelProfilesResult({ ...saved, extra: 1 }));
    expectInvalid(() => parseSavedModelProfilesResult({ ...saved, appliedAt: null }));
    expectInvalid(() =>
      parseSavedModelProfilesResult({
        workspaceId: "workspace-1",
        modelProfiles: null,
        appliedAt: null,
        ignoredReason: "orphan",
      }),
    );
    expectInvalid(() => parseSavedModelProfilesResult({ ...saved, ignoredReason: "" }));
  });

  it("rejects a saved-profile result for another workspace at the capability port", async () => {
    const result = projectSavedModelProfiles("workspace-1", undefined, undefined);
    const port = createCapabilityPort({
      capabilities: ["models.saved-profiles.read", "models.saved-profiles.save"],
      invoke: async () => ({ ok: true, value: { ...result, workspaceId: "other" } }),
    });
    await expect(
      port.execute({ type: "models.saved-profiles.read", input: { workspaceId: "workspace-1" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    await expect(
      port.execute({
        type: "models.saved-profiles.save",
        input: { workspaceId: "workspace-1", modelProfiles: null },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });
});
