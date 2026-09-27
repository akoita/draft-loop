import { describe, expect, it, vi } from "vitest";

import type { NativeBridge } from "./bridge.js";
import { createFixtureReviewState } from "./model.js";
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
    ]);
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
});
