import type { CanonicalCandidateProfileInput } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  buildCanonicalCandidateProfile,
  canonicalCandidateProfileChecksum,
} from "./candidate-profile.js";

const createdAt = "2026-08-27T10:00:00.000Z";

function selection() {
  return {
    capturedAt: createdAt,
    entries: [
      {
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        sources: [
          {
            sourceId: "source-1",
            versionId: "version-1",
            lifecycleRevision: {
              knowledgeBaseState: "active" as const,
              knowledgeBaseArchivedAt: null,
              versionId: "version-1",
              version: 1,
              createdAt: "2026-08-27T09:00:00.000Z",
              managed: true,
              originBoundAt: "2026-08-27T09:00:00.000Z",
              observation: null,
              retirement: null,
              provenanceFetchedAt: null,
              directory: null,
            },
          },
        ],
      },
    ],
  };
}

function profileInput(
  overrides: Partial<CanonicalCandidateProfileInput> = {},
): CanonicalCandidateProfileInput {
  return {
    id: "profile-1",
    version: 1,
    parentVersion: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    candidateKnowledgeSelection: selection(),
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
    ...overrides,
  };
}

describe("buildCanonicalCandidateProfile", () => {
  it("builds a strict, deeply immutable profile without retaining input pointers", () => {
    const input = profileInput();
    const profile = buildCanonicalCandidateProfile(input);

    expect(profile).toMatchObject({
      schemaVersion: 1,
      id: "profile-1",
      version: 1,
      parentVersion: null,
      status: "draft",
    });
    expect(profile.facts[0]?.value).toBe("Platform Engineer");
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.facts)).toBe(true);
    expect(Object.isFrozen(profile.facts[0])).toBe(true);
    expect(Object.isFrozen(profile.facts[0]?.provenance)).toBe(true);
    expect(Object.isFrozen(profile.candidateKnowledgeSelection)).toBe(true);
    expect(Object.isFrozen(profile.candidateKnowledgeSelection?.entries[0])).toBe(true);
    expect(Object.isFrozen(profile.candidateKnowledgeSelection?.entries[0]?.sources[0])).toBe(true);

    (input.facts[0] as { value: string }).value = "changed outside the profile";
    (input.candidateKnowledgeSelection?.entries[0] as { storeId: string }).storeId =
      "changed-store";
    expect(profile.facts[0]?.value).toBe("Platform Engineer");
    expect(profile.candidateKnowledgeSelection?.entries[0]?.storeId).toBe("store-1");
    expect(() => {
      (profile.facts[0] as { value: string }).value = "mutated";
    }).toThrow(TypeError);
  });

  it("rejects unknown and content/path-bearing fields at the strict schema boundary", () => {
    const input = profileInput();
    const selectedEntry = input.candidateKnowledgeSelection?.entries[0];
    if (selectedEntry === undefined) throw new Error("the selection fixture is incomplete");

    expect(() => buildCanonicalCandidateProfile({ ...input, unknown: true })).toThrow(
      /unknown|unrecognized/i,
    );
    expect(() =>
      buildCanonicalCandidateProfile({
        ...input,
        candidateKnowledgeSelection: {
          ...input.candidateKnowledgeSelection,
          entries: [
            {
              ...selectedEntry,
              rootPath: "/private/candidate",
            },
          ],
        },
      }),
    ).toThrow(/unknown|unrecognized|rootPath/i);
  });

  it("produces a deterministic lowercase storage-compatible checksum", () => {
    const input = profileInput();
    const reordered = {
      issues: [],
      facts: input.facts.map((fact) => ({
        provenance: fact.provenance,
        value: fact.value,
        field: fact.field,
        category: fact.category,
        id: fact.id,
      })),
      candidateKnowledgeSelection: input.candidateKnowledgeSelection,
      updatedAt: input.updatedAt,
      createdAt: input.createdAt,
      status: input.status,
      parentVersion: input.parentVersion,
      version: input.version,
      id: input.id,
    };

    const checksum = canonicalCandidateProfileChecksum(input);
    expect(checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(canonicalCandidateProfileChecksum(reordered)).toBe(checksum);
  });
});
