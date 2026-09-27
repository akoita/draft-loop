import type { ContextSnapshot } from "@draft-loop/domain";
import { type DraftArtifact, draftArtifactSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import { modelFacingArtifact, modelFacingContext } from "./provider-context.js";

function freezeTree<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeTree(child);
  return value;
}

function contextWithPaths(paths: readonly string[]): ContextSnapshot {
  const context = {
    schemaVersion: 1,
    id: "context-1",
    workspaceId: "workspace-1",
    createdAt: "2026-09-27T00:00:00.000Z",
    jobDescription: "Fictional systems role.",
    requirements: [],
    candidateInstructions: "Use sourced facts only.",
    language: "en",
    outputConstraints: { format: "markdown", requiredSections: ["Experience"] },
    truthfulnessPolicy: "Do not invent facts.",
    readinessRubric: {
      relevance: 0.8,
      evidence: 0.8,
      accuracy: 0.8,
      differentiation: 0.8,
      clarity: 0.8,
      format: 0.8,
      credibility: 0.8,
    },
    evidenceManifest: paths.map((path, index) => ({
      id: `source-${index + 1}`,
      path,
      mediaType: index % 2 === 0 ? "text/markdown" : "application/pdf",
      checksum: `${(index + 1).toString(16).repeat(64)}`,
      profileId: "profile-1",
    })),
    modelConfiguration: {
      author: {
        company: "anthropic",
        modelId: "fictional-author",
        role: "author",
        promptTemplateVersion: "v1",
        lineage: "private-author-lineage",
      },
      critic: {
        company: "openai",
        modelId: "fictional-critic",
        role: "critic",
        promptTemplateVersion: "v1",
        lineage: "private-critic-lineage",
      },
      requireProviderDiversity: true,
    },
    candidateKnowledgeSelection: {
      entries: [{ storeRoot: "/private/local-only", knowledgeBaseId: "knowledge-1" }],
    },
  };
  return freezeTree(context) as unknown as ContextSnapshot;
}

describe("model-facing context", () => {
  it("replaces every filesystem path with a deterministic opaque source label", () => {
    const paths = [
      "/home/fictional/private/resume.md",
      "C:\\Users\\Fictional\\resume.pdf",
      "\\\\fileserver\\candidate-data\\resume.docx",
      "file:///home/fictional/private/cover%20letter.md",
      "../private/references/resume.md",
      "/another/private/resume.md",
      "D:\\archive\\resume.md",
    ];
    const input = contextWithPaths(paths);

    const projected = modelFacingContext(input);
    const repeated = modelFacingContext(input);

    expect(projected.evidenceManifest.map(({ path }) => path)).toEqual(
      paths.map((_, index) => `evidence-source-${index + 1}`),
    );
    expect(new Set(projected.evidenceManifest.map(({ path }) => path)).size).toBe(paths.length);
    expect(projected.evidenceManifest).not.toBe(input.evidenceManifest);
    projected.evidenceManifest.forEach((source, index) => {
      const original = input.evidenceManifest[index];
      expect(source).not.toBe(original);
      expect(source).toMatchObject({
        id: original?.id,
        mediaType: original?.mediaType,
        checksum: original?.checksum,
        profileId: original?.profileId,
      });
      expect(source.path).not.toBe(paths[index]);
    });
    expect(repeated.evidenceManifest.map(({ path }) => path)).toEqual(
      projected.evidenceManifest.map(({ path }) => path),
    );
    expect(JSON.stringify(projected.evidenceManifest)).not.toContain("/home/fictional");
    expect(JSON.stringify(projected.evidenceManifest)).not.toContain("fileserver");
  });

  it("projects known and virtual artifact citations without mutating the frozen artifact", () => {
    const context = contextWithPaths(["/private/source.md"]);
    const artifact = freezeTree(
      draftArtifactSchema.parse({
        schemaVersion: 1,
        id: "artifact-1",
        version: 1,
        parentVersionId: null,
        createdAt: "2026-09-27T00:00:00.000Z",
        language: "en",
        sections: [
          {
            id: "section-1",
            title: "Experience",
            kind: "experience",
            order: 0,
            blocks: [
              {
                id: "block-1",
                type: "bullet",
                text: "A fictional supported accomplishment.",
                claimIds: ["claim-1"],
              },
              {
                id: "block-2",
                type: "bullet",
                text: "A virtual evidence reference.",
                claimIds: ["claim-2"],
              },
            ],
          },
        ],
        claims: [
          {
            id: "claim-1",
            text: "A fictional supported accomplishment.",
            sectionId: "section-1",
            blockId: "block-1",
            substantive: true,
            status: "unverified",
            evidence: [
              {
                sourcePath: "/private/source.md",
                sourceChecksum: "1".repeat(64),
                locator: "line:1-2",
                excerpt: "A fictional source excerpt.",
              },
            ],
          },
          {
            id: "claim-2",
            text: "A virtual evidence reference.",
            sectionId: "section-1",
            blockId: "block-2",
            substantive: true,
            status: "unverified",
            evidence: [
              {
                sourcePath: "virtual://runtime/evidence",
                sourceChecksum: "2".repeat(64),
                locator: "record:4",
                excerpt: "Virtual source excerpt.",
              },
              {
                sourcePath: "virtual://runtime/evidence",
                sourceChecksum: "2".repeat(64),
                locator: "record:5",
                excerpt: "Another excerpt from the same source.",
              },
              {
                sourcePath: "virtual://runtime/other",
                sourceChecksum: "3".repeat(64),
                locator: "record:1",
                excerpt: "A separate virtual source excerpt.",
              },
            ],
          },
        ],
        decisions: [],
      }) as DraftArtifact,
    );

    const projected = modelFacingArtifact(artifact, context);

    expect(projected).not.toBe(artifact);
    expect(projected.claims).not.toBe(artifact.claims);
    expect(projected.claims[0]?.evidence).not.toBe(artifact.claims[0]?.evidence);
    expect(projected.claims.map(({ id, text }) => ({ id, text }))).toEqual(
      artifact.claims.map(({ id, text }) => ({ id, text })),
    );
    expect(projected.claims[0]?.evidence[0]).toEqual({
      sourcePath: "evidence-source-1",
      sourceChecksum: "1".repeat(64),
      locator: "line:1-2",
      excerpt: "A fictional source excerpt.",
    });
    expect(projected.claims[1]?.evidence.map(({ sourcePath }) => sourcePath)).toEqual([
      "artifact-evidence-source-1",
      "artifact-evidence-source-1",
      "artifact-evidence-source-2",
    ]);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(projected.claims[1]?.evidence[0]?.sourceChecksum).toBe("2".repeat(64));
    expect(projected.claims[1]?.evidence[0]?.locator).toBe("record:4");
    expect(JSON.stringify(projected)).not.toContain("/private/source.md");
    expect(JSON.stringify(projected)).not.toContain("virtual://runtime/evidence");
    expect(artifact.claims[0]?.evidence[0]?.sourcePath).toBe("/private/source.md");
  });

  it("does not mutate frozen input and still strips local selection and model lineage", () => {
    const input = contextWithPaths(["/private/input.md"]);
    const originalPath = input.evidenceManifest[0]?.path;
    const projected = modelFacingContext(input);

    expect(Object.isFrozen(input)).toBe(true);
    expect(input.evidenceManifest[0]?.path).toBe(originalPath);
    expect(projected).not.toHaveProperty("candidateKnowledgeSelection");
    expect(projected.modelConfiguration.author).not.toHaveProperty("lineage");
    expect(projected.modelConfiguration.critic).not.toHaveProperty("lineage");
  });
});
