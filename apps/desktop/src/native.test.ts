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
});
