import { describe, expect, it, vi } from "vitest";
import type { NativeBridge } from "./bridge.js";
import { createFixtureReviewState } from "./model.js";
import { projectModelProfileSupport } from "./model-profile-bridge.js";
import { createBridgeReviewPort, createNativeCapabilityPort } from "./native.js";

function canonicalCandidateProfileResult(
  workspaceId: string,
  version = 1,
  status: "draft" | "reviewed" = "draft",
): Record<string, unknown> {
  const capturedAt = "2026-08-28T10:00:00.000Z";
  return {
    workspaceId,
    profileId: "profile-1",
    version,
    parentVersion: version === 1 ? null : version - 1,
    status,
    createdAt: capturedAt,
    updatedAt: capturedAt,
    reviewedAt: status === "reviewed" ? capturedAt : null,
    checksum: "b".repeat(64),
    facts: [
      {
        id: "fact-link",
        category: "approved-link",
        field: "url",
        value: "https://approved.example.test/me",
        provenance: [
          {
            storeId: "store-1",
            knowledgeBaseId: "knowledge-1",
            sourceId: "source-1",
            versionId: "version-1",
            kind: "candidate-provided",
          },
        ],
      },
    ],
    issues: [],
  };
}

describe("desktop native profile capabilities", () => {
  it("binds all profile operations to the active workspace without exposing it as input", async () => {
    const state = createFixtureReviewState();
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "review.load") return { ok: true, value: state };
      if (command.type === "profile.list") {
        return {
          ok: true,
          value: {
            workspaceId: state.workspaceId,
            profileId: "profile-1",
            versions: [canonicalCandidateProfileResult(state.workspaceId)],
          },
        };
      }
      if (command.type === "profile.catalog") {
        return {
          ok: true,
          value: {
            workspaceId: state.workspaceId,
            profiles: [{ profileId: "profile-1", version: 1, reviewedAt: "2026-09-30T12:00:00Z" }],
          },
        };
      }
      return { ok: true, value: canonicalCandidateProfileResult(state.workspaceId) };
    });
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: [
          "review.load",
          "profile.derive",
          "profile.get",
          "profile.list",
          "profile.edit",
          "profile.review",
          "profile.catalog",
        ],
        invoke,
      }),
    );

    await expect(
      port.deriveCanonicalCandidateProfile?.({
        profileId: "profile-1",
        providerTransmissionApproved: true,
      }),
    ).resolves.toMatchObject({ profileId: "profile-1", version: 1 });
    await expect(port.getCanonicalCandidateProfile?.("profile-1", 1)).resolves.toMatchObject({
      profileId: "profile-1",
      version: 1,
    });
    await expect(port.listCanonicalCandidateProfileVersions?.("profile-1")).resolves.toMatchObject({
      workspaceId: state.workspaceId,
      profileId: "profile-1",
      versions: [{ version: 1 }],
    });
    await expect(
      port.editCanonicalCandidateProfile?.({
        profileId: "profile-1",
        expectedVersion: 1,
        patch: {
          facts: [
            {
              id: "fact-link",
              category: "approved-link",
              field: "url",
              value: "https://approved.example.test/me",
              provenance: [
                {
                  storeId: "store-1",
                  knowledgeBaseId: "knowledge-1",
                  sourceId: "source-1",
                  versionId: "version-1",
                  kind: "candidate-provided",
                },
              ],
            },
          ],
        },
      }),
    ).resolves.toMatchObject({ version: 1 });
    await expect(port.reviewCanonicalCandidateProfile?.("profile-1", 1)).resolves.toMatchObject({
      profileId: "profile-1",
      version: 1,
    });
    await expect(
      port.listReviewedCanonicalCandidateProfiles?.(state.workspaceId),
    ).resolves.toMatchObject({
      workspaceId: state.workspaceId,
      profiles: [{ profileId: "profile-1", version: 1 }],
    });

    const operations = invoke.mock.calls
      .map(([command]) => command)
      .filter((command) => command.type.startsWith("profile."));
    expect(operations).toEqual([
      {
        type: "profile.derive",
        input: {
          workspaceId: state.workspaceId,
          profileId: "profile-1",
          providerTransmissionApproved: true,
        },
      },
      {
        type: "profile.get",
        input: { workspaceId: state.workspaceId, profileId: "profile-1", version: 1 },
      },
      {
        type: "profile.list",
        input: { workspaceId: state.workspaceId, profileId: "profile-1" },
      },
      {
        type: "profile.edit",
        input: {
          workspaceId: state.workspaceId,
          profileId: "profile-1",
          expectedVersion: 1,
          patch: {
            facts: [
              {
                id: "fact-link",
                category: "approved-link",
                field: "url",
                value: "https://approved.example.test/me",
                provenance: [
                  {
                    storeId: "store-1",
                    knowledgeBaseId: "knowledge-1",
                    sourceId: "source-1",
                    versionId: "version-1",
                    kind: "candidate-provided",
                  },
                ],
              },
            ],
          },
        },
      },
      {
        type: "profile.review",
        input: { workspaceId: state.workspaceId, profileId: "profile-1", expectedVersion: 1 },
      },
      {
        type: "profile.catalog",
        input: { workspaceId: state.workspaceId },
      },
    ]);
  });

  it("binds profile progress and cancel to the active workspace and gates them by capability", async () => {
    const state = createFixtureReviewState();
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "review.load") return { ok: true, value: state };
      if (command.type === "profile.progress") {
        return { ok: true, value: { active: true, completedCalls: 1, plannedCalls: 2 } };
      }
      return { ok: true, value: { cancelled: true } };
    });
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load", "profile.progress", "profile.cancel"],
        invoke,
      }),
    );

    await expect(port.getCanonicalCandidateProfileProgress?.("profile-1")).resolves.toEqual({
      active: true,
      completedCalls: 1,
      plannedCalls: 2,
    });
    await expect(port.cancelCanonicalCandidateProfileGeneration?.("profile-1")).resolves.toEqual({
      cancelled: true,
    });
    expect(
      invoke.mock.calls
        .map(([command]) => command)
        .filter((command) => command.type.startsWith("profile.")),
    ).toEqual([
      {
        type: "profile.progress",
        input: { workspaceId: state.workspaceId, profileId: "profile-1" },
      },
      {
        type: "profile.cancel",
        input: { workspaceId: state.workspaceId, profileId: "profile-1" },
      },
    ]);

    const bare = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load"],
        invoke: async () => ({ ok: true, value: state }),
      }),
    );
    expect(bare.getCanonicalCandidateProfileProgress).toBeUndefined();
    expect(bare.cancelCanonicalCandidateProfileGeneration).toBeUndefined();
  });

  it("sends opportunity.cancel for the loaded workspace and gates it on the capability", async () => {
    const state = createFixtureReviewState();
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) =>
      command.type === "review.load"
        ? { ok: true, value: state }
        : { ok: true, value: { cancelled: true } },
    );
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({ capabilities: ["review.load", "opportunity.cancel"], invoke }),
    );
    await expect(port.cancelOpportunityExtraction?.()).resolves.toEqual({ cancelled: true });
    expect(invoke).toHaveBeenLastCalledWith({
      type: "opportunity.cancel",
      input: { workspaceId: state.workspaceId },
    });
    const bare = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load"],
        invoke: async () => ({ ok: true, value: state }),
      }),
    );
    expect(bare.cancelOpportunityExtraction).toBeUndefined();
  });

  it("keeps profile methods capability-gated", async () => {
    const state = createFixtureReviewState();
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load", "profile.get"],
        invoke: async (command) =>
          command.type === "review.load"
            ? { ok: true, value: state }
            : { ok: true, value: canonicalCandidateProfileResult(state.workspaceId) },
      }),
    );

    await expect(port.getCanonicalCandidateProfile?.("profile-1")).resolves.toMatchObject({
      profileId: "profile-1",
    });
    expect(port.deriveCanonicalCandidateProfile).toBeUndefined();
    expect(port.listCanonicalCandidateProfileVersions).toBeUndefined();
    expect(port.editCanonicalCandidateProfile).toBeUndefined();
    expect(port.reviewCanonicalCandidateProfile).toBeUndefined();
    expect(port.listReviewedCanonicalCandidateProfiles).toBeUndefined();
    expect(port.listCanonicalCandidateProfileSummaries).toBeUndefined();
  });

  it("lists saved profile summaries through the catalog command with drafts included", async () => {
    const state = createFixtureReviewState();
    const summary = {
      profileId: "profile-1",
      latestVersion: 2,
      status: "draft",
      updatedAt: "2026-09-30T12:00:00Z",
      reviewedVersion: 1,
    };
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({
      ok: true,
      value: { workspaceId: state.workspaceId, profiles: [], summaries: [summary] },
    }));
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({ capabilities: ["review.load", "profile.catalog"], invoke }),
    );
    await expect(port.listCanonicalCandidateProfileSummaries?.(state.workspaceId)).resolves.toEqual(
      [summary],
    );
    expect(invoke).toHaveBeenCalledWith({
      type: "profile.catalog",
      input: { workspaceId: state.workspaceId, includeDrafts: true },
    });
  });

  it("binds candidate knowledge operations to native dialogs and one explicit workspace selection", async () => {
    const storeResult = {
      storeId: "store-1",
      knowledgeBases: [
        {
          id: "knowledge-1",
          displayName: "Candidate facts",
          description: "Reusable candidate knowledge",
          state: "active" as const,
          isDefault: true,
        },
      ],
    };
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "knowledge.select") {
        return {
          ok: true,
          value: {
            workspaceId: "workspace-1",
            entries: [{ storeId: "store-1", knowledgeBaseId: "knowledge-1" }],
          },
        };
      }
      return { ok: true, value: storeResult };
    });
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["knowledge.create", "knowledge.open", "knowledge.select"],
        invoke,
      }),
    );

    await expect(
      port.createCandidateKnowledgeStore?.({ name: "candidate-facts" }),
    ).resolves.toEqual(storeResult);
    await expect(port.openCandidateKnowledgeStore?.()).resolves.toEqual(storeResult);
    await expect(
      port.selectCandidateKnowledgeBase?.("workspace-1", {
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
      }),
    ).resolves.toEqual({
      workspaceId: "workspace-1",
      entries: [{ storeId: "store-1", knowledgeBaseId: "knowledge-1" }],
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      {
        type: "knowledge.create",
        input: { selection: "native-dialog", name: "candidate-facts" },
      },
      { type: "knowledge.open", input: { selection: "native-dialog" } },
      {
        type: "knowledge.select",
        input: {
          workspaceId: "workspace-1",
          entries: [{ storeId: "store-1", knowledgeBaseId: "knowledge-1" }],
        },
      },
    ]);
  });

  it("reads the workspace's saved knowledge store through knowledge.current", async () => {
    const value = { store: null, selectedKnowledgeBaseIds: [] };
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({ ok: true, value }));
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({ capabilities: ["knowledge.current"], invoke }),
    );
    await expect(port.getCurrentCandidateKnowledge?.("workspace-1")).resolves.toEqual(value);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      { type: "knowledge.current", input: { workspaceId: "workspace-1" } },
    ]);

    const without = createBridgeReviewPort(
      createNativeCapabilityPort({ capabilities: ["knowledge.open"], invoke }),
    );
    expect(without.getCurrentCandidateKnowledge).toBeUndefined();
  });

  it("gates each candidate knowledge method on its own host capability", () => {
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["knowledge.create", "knowledge.open"],
        invoke: async () => ({ ok: true, value: { storeId: "store-1", knowledgeBases: [] } }),
      }),
    );

    expect(port.createCandidateKnowledgeStore).toBeDefined();
    expect(port.openCandidateKnowledgeStore).toBeDefined();
    expect(port.selectCandidateKnowledgeBase).toBeUndefined();
  });

  it("uses native dialogs for local intake and returns readiness without paths", async () => {
    const fileResult = {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      sourceId: "source-1",
      kind: "file" as const,
      versionId: "version-1",
      version: 1,
      created: true,
      outcome: "added" as const,
    };
    const directoryResult = {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      status: "partial" as const,
      scannedEntryCount: 5,
      discoveredFileCount: 3,
      skippedEntryCount: 2,
      sourceCount: 3,
      sources: [],
      sourcesTruncated: true,
    };
    const readinessResult = {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      state: "active" as const,
      sourceCount: 3,
      readyCount: 2,
      blockedCount: 1,
      blockerReasons: ["source-retired"],
    };
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "knowledge.import-file") return { ok: true, value: fileResult };
      if (command.type === "knowledge.import-directory") {
        return { ok: true, value: directoryResult };
      }
      return { ok: true, value: readinessResult };
    });
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: [
          "knowledge.import-file",
          "knowledge.import-directory",
          "knowledge.readiness",
        ],
        invoke,
      }),
    );

    await expect(port.importCandidateKnowledgeFile?.("store-1", "knowledge-1")).resolves.toEqual(
      fileResult,
    );
    await expect(
      port.importCandidateKnowledgeDirectory?.("store-1", "knowledge-1"),
    ).resolves.toEqual(directoryResult);
    await expect(port.getCandidateKnowledgeReadiness?.("store-1", "knowledge-1")).resolves.toEqual(
      readinessResult,
    );
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      {
        type: "knowledge.import-file",
        input: { storeId: "store-1", knowledgeBaseId: "knowledge-1", selection: "native-dialog" },
      },
      {
        type: "knowledge.import-directory",
        input: { storeId: "store-1", knowledgeBaseId: "knowledge-1", selection: "native-dialog" },
      },
      {
        type: "knowledge.readiness",
        input: { storeId: "store-1", knowledgeBaseId: "knowledge-1" },
      },
    ]);
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/(?:[A-Z]:\\|\/home\/|file:\/\/)/u);
  });

  it("imports a URL into a base only with an approved request through the existing command", async () => {
    const urlResult = {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      sourceId: "source-1",
      kind: "url" as const,
      versionId: "version-1",
      version: 1,
      created: true,
    };
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({ ok: true, value: urlResult }));
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({ capabilities: ["knowledge.import-url"], invoke }),
    );

    await expect(
      port.importCandidateKnowledgeUrl?.("store-1", "knowledge-1", "https://example.com/cv"),
    ).resolves.toEqual(urlResult);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      {
        type: "knowledge.import-url",
        input: {
          storeId: "store-1",
          knowledgeBaseId: "knowledge-1",
          url: "https://example.com/cv",
          approved: true,
        },
      },
    ]);
    const withoutCapability = createBridgeReviewPort(
      createNativeCapabilityPort({ capabilities: [], invoke }),
    );
    expect(withoutCapability.importCandidateKnowledgeUrl).toBeUndefined();
  });

  it("returns native file-picker cancellation as an error rather than an import result", async () => {
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["knowledge.import-file"],
        invoke: async () => ({
          ok: false,
          error: { code: "operation-failed", message: "The local picker was canceled." },
        }),
      }),
    );

    await expect(
      port.importCandidateKnowledgeFile?.("store-1", "knowledge-1"),
    ).rejects.toMatchObject({ code: "operation-failed" });
  });

  it("binds workspace-source intake to an explicitly approved workspace and base", async () => {
    const directoryResult = {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      status: "partial" as const,
      scannedEntryCount: 2,
      discoveredFileCount: 1,
      skippedEntryCount: 1,
      sourceCount: 1,
      sources: [],
      sourcesTruncated: true,
    };
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({
      ok: true,
      value: directoryResult,
    }));
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["knowledge.import-workspace-sources"],
        invoke,
      }),
    );

    await expect(
      port.importWorkspaceCandidateSources?.({
        workspaceId: "workspace-1",
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        approved: true,
      }),
    ).resolves.toEqual(directoryResult);
    expect(invoke).toHaveBeenCalledWith({
      type: "knowledge.import-workspace-sources",
      input: {
        workspaceId: "workspace-1",
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        approved: true,
      },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/(?:[A-Z]:\\|\/home\/|file:\/\/)/u);
  });

  it("does not upgrade an unapproved workspace-source intake request", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({
      ok: true,
      value: {},
    }));
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["knowledge.import-workspace-sources"],
        invoke,
      }),
    );
    const unapproved = {
      workspaceId: "workspace-1",
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      approved: false,
    } as unknown as Parameters<NonNullable<typeof port.importWorkspaceCandidateSources>>[0];

    await expect(port.importWorkspaceCandidateSources?.(unapproved)).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("desktop recent workspace capabilities", () => {
  it("lists, opens, removes, and clears only path-free recent workspace commands", async () => {
    const state = createFixtureReviewState();
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const commands: string[] = [];
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: [
          "review.load",
          "workspace.recent-list",
          "workspace.recent-open",
          "workspace.recent-remove",
          "workspace.recent-clear",
        ],
        invoke: async (command) => {
          commands.push(command.type);
          if (command.type === "workspace.recent-list") {
            return {
              ok: true,
              value: {
                workspaces: [{ id, name: "Recent", lastOpenedAt: "2026-10-03T10:00:00.000Z" }],
              },
            };
          }
          if (command.type === "workspace.recent-open") {
            expect(command.input).toEqual({ id });
            return { ok: true, value: { workspace: { id: state.workspaceId, name: "Recent" } } };
          }
          if (command.type === "review.load") return { ok: true, value: state };
          if (command.type === "workspace.recent-remove") {
            expect(command.input).toEqual({ id });
            return { ok: true, value: { removed: true } };
          }
          if (command.type === "workspace.recent-clear")
            return { ok: true, value: { cleared: true } };
          throw new Error("Unexpected command");
        },
      }),
    );

    await expect(port.listRecentWorkspaces?.()).resolves.toEqual([
      { id, name: "Recent", lastOpenedAt: "2026-10-03T10:00:00.000Z" },
    ]);
    await expect(port.openRecentWorkspace?.(id)).resolves.toEqual(state);
    await expect(port.removeRecentWorkspace?.(id)).resolves.toBeUndefined();
    await expect(port.clearRecentWorkspaces?.()).resolves.toBeUndefined();
    expect(commands).toEqual([
      "workspace.recent-list",
      "workspace.recent-open",
      "review.load",
      "workspace.recent-remove",
      "workspace.recent-clear",
    ]);
    expect(port.listRecentWorkspaces).toBeDefined();
  });

  it("exposes renaming only when the host advertises workspace.rename", async () => {
    const withRename = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load", "workspace.rename"],
        invoke: async (command) => {
          expect(command).toEqual({
            type: "workspace.rename",
            input: { workspaceId: "workspace-1", name: "Mergify — Staff Engineer" },
          });
          return { ok: true, value: { name: "Mergify — Staff Engineer" } };
        },
      }),
    );
    await expect(
      withRename.renameWorkspace?.("workspace-1", "Mergify — Staff Engineer"),
    ).resolves.toBe("Mergify — Staff Engineer");
    const without = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load"],
        invoke: async () => ({ ok: true, value: {} }),
      }),
    );
    expect(without.renameWorkspace).toBeUndefined();
  });

  it("does not expose recent workspace actions when the host does not advertise them", () => {
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load"],
        invoke: async () => ({ ok: true, value: {} }),
      }),
    );
    expect(port.listRecentWorkspaces).toBeUndefined();
    expect(port.openRecentWorkspace).toBeUndefined();
    expect(port.clearRecentWorkspaces).toBeUndefined();
  });
});

describe("desktop workspace model settings capability", () => {
  it("configures the exact full pair and reloads the refreshed preflight", async () => {
    const state = createFixtureReviewState();
    const refreshed = {
      ...state,
      providerTransmissionPreflight: {
        ...state.providerTransmissionPreflight,
        acknowledged: false,
        acknowledgedAt: null,
        fingerprint: "c".repeat(64),
      },
    };
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "review.load") return { ok: true, value: refreshed };
      if (command.type === "workspace.configure-models") {
        return {
          ok: true,
          value: {
            workspaceId: state.workspaceId,
            authorCompany: "anthropic",
            authorModel: "claude-sonnet-4-5",
            criticCompany: "openai",
            criticModel: "gpt-5.6-luna",
            localEndpoint: null,
          },
        };
      }
      throw new Error("Unexpected command in native model-settings test.");
    });
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["workspace.configure-models", "review.load"],
        invoke,
      }),
    );

    await expect(
      port.configureModels?.(state.workspaceId, {
        authorCompany: "anthropic",
        authorModel: "claude-sonnet-4-5",
        criticCompany: "openai",
        criticModel: "gpt-5.6-luna",
      }),
    ).resolves.toMatchObject({
      workspaceId: state.workspaceId,
      providerTransmissionPreflight: { acknowledged: false, fingerprint: "c".repeat(64) },
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      {
        type: "workspace.configure-models",
        input: {
          workspaceId: state.workspaceId,
          authorCompany: "anthropic",
          authorModel: "claude-sonnet-4-5",
          criticCompany: "openai",
          criticModel: "gpt-5.6-luna",
        },
      },
      { type: "review.load", input: {} },
    ]);
  });

  it("omits configuration when the host lacks its capability", () => {
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load"],
        invoke: vi.fn<NativeBridge["invoke"]>(),
      }),
    );

    expect(port.configureModels).toBeUndefined();
  });
});

describe("desktop model profile support capability", () => {
  it("binds route support to the requested workspace without credentials or discovery calls", async () => {
    const support = projectModelProfileSupport("workspace-1", {
      anthropic: "api-key",
      openai: "user-session",
    });
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({ ok: true, value: support }));
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({ capabilities: ["models.profile-support"], invoke }),
    );

    await expect(port.getModelProfileSupport?.("workspace-1")).resolves.toEqual(support);
    expect(invoke).toHaveBeenCalledWith({
      type: "models.profile-support",
      input: { workspaceId: "workspace-1" },
    });
  });

  it("does not expose profile route support when the host lacks its capability", () => {
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load"],
        invoke: vi.fn<NativeBridge["invoke"]>(),
      }),
    );

    expect(port.getModelProfileSupport).toBeUndefined();
  });
});

describe("desktop saved model profiles capability", () => {
  const references = {
    author: { id: "standard-anthropic-author", version: 1 },
    critic: { id: "standard-openai-critic", version: 2 },
  };

  it("reads and saves the pair through the bridge commands", async () => {
    const result = {
      workspaceId: "workspace-1",
      modelProfiles: references,
      appliedAt: "2026-01-01T00:00:00.000Z",
      ignoredReason: null,
    };
    const invoke = vi.fn<NativeBridge["invoke"]>(async () => ({ ok: true, value: result }));
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["models.saved-profiles.read", "models.saved-profiles.save"],
        invoke,
      }),
    );

    await expect(port.readSavedModelProfiles?.("workspace-1")).resolves.toEqual(result);
    await expect(port.saveModelProfiles?.("workspace-1", references)).resolves.toEqual(result);
    expect(invoke).toHaveBeenNthCalledWith(1, {
      type: "models.saved-profiles.read",
      input: { workspaceId: "workspace-1" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, {
      type: "models.saved-profiles.save",
      input: { workspaceId: "workspace-1", modelProfiles: references },
    });
  });

  it("does not expose saved profiles when the host lacks the capabilities", () => {
    const port = createBridgeReviewPort(
      createNativeCapabilityPort({
        capabilities: ["review.load"],
        invoke: vi.fn<NativeBridge["invoke"]>(),
      }),
    );

    expect(port.readSavedModelProfiles).toBeUndefined();
    expect(port.saveModelProfiles).toBeUndefined();
  });
});
