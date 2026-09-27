import type { ContextSnapshot } from "@draft-loop/domain";
import { type DraftArtifact, draftArtifactSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  evidenceReferenceTableInstructions,
  modelFacingArtifactWithEvidenceTable,
} from "./provider-artifact-input.js";
import { modelFacingArtifact } from "./provider-context.js";

type EvidenceReference = DraftArtifact["claims"][number]["evidence"][number];

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a fixture value.");
  return value;
}

function contextWithManifest(
  entries: readonly { readonly path: string; readonly checksum: string }[],
): ContextSnapshot {
  return {
    id: "context-fictional",
    evidenceManifest: entries.map(({ path, checksum }, index) => ({
      id: `source-${index + 1}`,
      path,
      checksum,
    })),
  } as unknown as ContextSnapshot;
}

function fixtureArtifact(
  evidenceByClaim: readonly (readonly EvidenceReference[])[],
): DraftArtifact {
  const claimIds = evidenceByClaim.map((_, index) => `claim-${index + 1}`);
  return draftArtifactSchema.parse({
    schemaVersion: 1,
    id: "artifact-fictional",
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
            text: "A fictional, source-supported accomplishment.",
            claimIds,
          },
        ],
      },
    ],
    claims: evidenceByClaim.map((evidence, index) => ({
      id: claimIds[index],
      text: "A fictional, source-supported accomplishment.",
      sectionId: "section-1",
      blockId: "block-1",
      substantive: true,
      status: "unverified",
      evidence,
    })),
    decisions: [],
  });
}

function largeReferences(): EvidenceReference[] {
  return Array.from({ length: 19 }, (_, index) => ({
    sourcePath: `/fictional/local/source-${index + 1}.md`,
    sourceChecksum: `${(index + 1).toString(16).repeat(64)}`,
    locator: `line:${index + 1}`,
    excerpt: `${String.fromCharCode(65 + index)}${"x".repeat(3_999)}`,
  }));
}

describe("provider artifact evidence reference table", () => {
  it("keeps a large complete request under the transport cap and resolves every claim link", () => {
    const references = largeReferences();
    const artifact = fixtureArtifact(
      Array.from({ length: 373 }, (_, index) => [required(references[index % references.length])]),
    );
    const context = contextWithManifest(
      references.map(({ sourcePath, sourceChecksum }) => ({
        path: sourcePath,
        checksum: sourceChecksum ?? "",
      })),
    );
    const promptContext = {
      evidenceManifest: context.evidenceManifest.map((source, index) => ({
        ...source,
        path: `evidence-source-${index + 1}`,
      })),
    };
    const originalJson = JSON.stringify(artifact);
    const pathProjected = modelFacingArtifact(artifact, context);
    const projected = modelFacingArtifactWithEvidenceTable(artifact, context);
    const wholeRequest = JSON.stringify({
      systemPrompt: evidenceReferenceTableInstructions,
      input: {
        executionId: "execution-fictional",
        runId: "run-fictional",
        round: 1,
        context: promptContext,
        retrievedEvidence: [],
        achievementPlan: { status: "ready", items: [] },
        currentArtifact: projected,
        findings: [],
      },
    });
    const expandedRequest = JSON.stringify({
      input: { currentArtifact: pathProjected },
    });

    expect(expandedRequest.length).toBeGreaterThan(1_048_576);
    expect(wholeRequest.length).toBeLessThan(1_048_576);
    expect(wholeRequest.length).toBeLessThan(250_000);
    expect(projected.evidenceEncoding).toBe("reference-table-v1");
    expect(Object.keys(projected.evidenceReferences)).toHaveLength(19);
    expect(projected.claims).toHaveLength(373);

    const reconstructedClaims = projected.claims.map(({ evidenceReferenceIds, ...claim }) => ({
      ...claim,
      evidence: evidenceReferenceIds.map((id) => required(projected.evidenceReferences[id])),
    }));
    expect(reconstructedClaims).toEqual(pathProjected.claims);
    const { claims: _projectedClaims, ...projectedFields } = projected;
    const { claims: _pathProjectedClaims, ...pathProjectedFields } = pathProjected;
    expect(projectedFields).toMatchObject({
      ...pathProjectedFields,
      evidenceEncoding: "reference-table-v1",
    });
    expect(projected.sections).toEqual(artifact.sections);
    expect(projected.decisions).toEqual(artifact.decisions);
    expect(projected.claims[0]).not.toHaveProperty("evidence");
    expect(JSON.stringify(projected)).not.toContain("/fictional/local/");
    expect(wholeRequest).not.toContain("/fictional/local/");
    expect(JSON.stringify(artifact)).toBe(originalJson);
  });

  it("deduplicates only complete identical references and preserves repeated link order", () => {
    const base: EvidenceReference = {
      sourcePath: "/fictional/local/source.md",
      sourceChecksum: "a".repeat(64),
      locator: "line:1",
      excerpt: "A fictional excerpt.",
    };
    const variants: EvidenceReference[] = [
      base,
      base,
      { ...base, locator: "line:2" },
      { ...base, sourceChecksum: "b".repeat(64) },
      { ...base, excerpt: "A different fictional excerpt." },
      { ...base, sourcePath: "/fictional/local/other.md" },
    ];
    const artifact = fixtureArtifact([variants]);
    const context = contextWithManifest([
      { path: base.sourcePath, checksum: required(base.sourceChecksum) },
    ]);
    const projected = modelFacingArtifactWithEvidenceTable(artifact, context);
    const ids = projected.claims[0]?.evidenceReferenceIds;

    expect(ids).toHaveLength(6);
    expect(ids?.[0]).toBe(ids?.[1]);
    expect(new Set(ids).size).toBe(5);
    expect(ids?.slice(2).every((id) => id !== ids[0])).toBe(true);
    expect(ids?.map((id) => required(projected.evidenceReferences[id]))).toEqual(
      modelFacingArtifact(artifact, context).claims[0]?.evidence,
    );
    expect(Object.keys(projected.evidenceReferences)).toEqual(
      Array.from({ length: 5 }, (_, index) => `evidence-reference-${index + 1}`),
    );
    expect(JSON.stringify(projected)).not.toContain("/fictional/local/");
  });
});
