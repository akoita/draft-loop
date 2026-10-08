import { describe, expect, it } from "vitest";

import {
  canonicalCandidateProfileSchema,
  parseCanonicalCandidateProfile,
  serializeCanonicalCandidateProfile,
} from "./index.js";

const timestamp = "2026-08-27T10:00:00.000Z";

function profilePayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "profile-1",
    version: 1,
    parentVersion: null,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    candidateKnowledgeSelection: {
      capturedAt: timestamp,
      entries: [
        {
          storeId: "store-1",
          knowledgeBaseId: "knowledge-1",
          sources: [
            {
              sourceId: "source-1",
              versionId: "version-1",
              lifecycleRevision: {
                knowledgeBaseState: "active",
                knowledgeBaseArchivedAt: null,
                versionId: "version-1",
                version: 1,
                createdAt: timestamp,
                managed: true,
                originBoundAt: timestamp,
                observation: null,
                retirement: null,
                provenanceFetchedAt: null,
                directory: null,
              },
            },
          ],
        },
      ],
    },
    facts: [
      {
        id: "fact-1",
        category: "role",
        field: "title",
        value: "Platform Engineer",
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
    ...extra,
  };
}

const identity = {
  company: "mistral",
  modelId: "synthetic-model",
  promptTemplateVersion: "synthetic-extraction-v1",
  extractionProfile: { id: "synthetic-extraction-profile", version: 2 },
};

describe("canonical profile extraction identity", () => {
  it("parses a payload persisted before the identity existed, without adding one", () => {
    const parsed = canonicalCandidateProfileSchema.parse(profilePayload());

    expect(parsed).not.toHaveProperty("extraction");
    expect(parseCanonicalCandidateProfile(serializeCanonicalCandidateProfile(parsed))).toEqual(
      parsed,
    );
  });

  it("round-trips the identity with and without an extraction profile", () => {
    const withProfile = canonicalCandidateProfileSchema.parse(
      profilePayload({ extraction: identity }),
    );
    const { extractionProfile: _extractionProfile, ...withoutProfileIdentity } = identity;
    const withoutProfile = canonicalCandidateProfileSchema.parse(
      profilePayload({ extraction: { ...withoutProfileIdentity, modelId: " padded-model " } }),
    );

    expect(withProfile.extraction).toEqual(identity);
    expect(parseCanonicalCandidateProfile(serializeCanonicalCandidateProfile(withProfile))).toEqual(
      withProfile,
    );
    expect(withoutProfile.extraction).toEqual({
      ...withoutProfileIdentity,
      modelId: "padded-model",
    });
    expect(Object.isFrozen(withProfile.extraction)).toBe(true);
    expect(Object.isFrozen(withProfile.extraction?.extractionProfile)).toBe(true);
  });

  it("rejects unknown, empty, and malformed identity fields", () => {
    for (const extraction of [
      { ...identity, apiKey: "secret" },
      { ...identity, modelId: " " },
      { ...identity, promptTemplateVersion: undefined },
      { ...identity, extractionProfile: { id: "profile", version: 0 } },
      { ...identity, extractionProfile: { id: "profile", version: 1, path: "/x" } },
      "synthetic-model",
    ]) {
      expect(() => canonicalCandidateProfileSchema.parse(profilePayload({ extraction }))).toThrow();
    }
  });
});
