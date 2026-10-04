import { describe, expect, it } from "vitest";
import { createCapabilityPort, validateBridgeCommand } from "./bridge.js";
import {
  ModelProfileBridgeValidationError,
  parseModelProfileReferences,
  parseModelProfileSupportInput,
  parseModelProfileSupportResult,
  projectModelProfileSupport,
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
    expect(projectModelProfileSupport("workspace-1", apiKeyModes).profiles).toHaveLength(12);
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
});
