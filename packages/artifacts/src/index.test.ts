import { describe, expect, it } from "vitest";

import {
  createArtifact,
  createArtifactVersion,
  type DraftArtifact,
  diffArtifacts,
  getUnbackedClaims,
  hasRequiredArtifactSection,
  stableSerializeArtifact,
  validateArtifactReferences,
} from "./index.js";

const evidence = {
  sourcePath: "/local/candidate/resume.md",
  sourceChecksum: "a".repeat(64),
  locator: "line:4-5",
  excerpt: "Built reliable systems.",
};

function artifactInput() {
  return {
    id: "artifact-1",
    createdAt: "2026-08-12T10:00:00.000Z",
    language: "en",
    sections: [
      {
        id: "section-summary",
        title: "Summary",
        kind: "summary" as const,
        order: 0,
        blocks: [
          {
            id: "block-summary-1",
            type: "paragraph" as const,
            text: "Engineer building reliable systems.",
            claimIds: ["claim-summary-1"],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-summary-1",
        text: "Engineer building reliable systems.",
        sectionId: "section-summary",
        blockId: "block-summary-1",
        substantive: true,
        status: "verified" as const,
        evidence: [evidence],
      },
    ],
    decisions: [],
  };
}

function artifactParts() {
  const input = artifactInput();
  const claim = input.claims[0];
  const section = input.sections[0];
  const block = section?.blocks[0];
  if (claim === undefined || section === undefined || block === undefined) {
    throw new Error("artifact fixture is incomplete");
  }
  return { input, claim, section, block };
}

describe("structured CV artifacts", () => {
  it("matches required sections by display title or semantic kind", () => {
    const artifact = createArtifact({
      ...artifactInput(),
      sections: artifactInput().sections.map((section) => ({
        ...section,
        title: "Professional Summary",
      })),
    });

    expect(hasRequiredArtifactSection(artifact, "Professional Summary")).toBe(true);
    expect(hasRequiredArtifactSection(artifact, " summary ")).toBe(true);
    expect(hasRequiredArtifactSection(artifact, "Experience")).toBe(false);
  });

  it("creates a frozen version-one artifact and identifies unsupported claims", () => {
    const { input, claim, section } = artifactParts();
    const artifact = createArtifact({
      ...input,
      claims: [
        ...input.claims,
        {
          ...claim,
          id: "claim-unverified",
          text: "Led a team of 20.",
          substantive: true,
          status: "unverified" as const,
          evidence: [],
        },
      ],
      sections: [
        {
          ...section,
          blocks: [
            ...section.blocks,
            {
              id: "block-summary-2",
              type: "bullet" as const,
              text: "Led a team of 20.",
              claimIds: ["claim-unverified"],
            },
          ],
        },
      ],
    });

    expect(artifact.version).toBe(1);
    expect(artifact.parentVersionId).toBeNull();
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(getUnbackedClaims(artifact).map((claim) => claim.id)).toEqual(["claim-unverified"]);
    expect(validateArtifactReferences(artifact)).toMatchObject([
      { code: "unbacked-claim", claimId: "claim-unverified" },
    ]);
  });

  it("creates an immutable child version without mutating the parent", () => {
    const { input } = artifactParts();
    const parent = createArtifact(input);
    const child = createArtifactVersion(parent, {
      ...input,
      id: "artifact-2",
      decisions: [
        {
          id: "decision-1",
          type: "edit",
          rationale: "User refined the summary.",
          createdAt: "2026-08-12T10:01:00.000Z",
        },
      ],
    });

    expect(child.version).toBe(2);
    expect(child.parentVersionId).toBe(parent.id);
    expect(parent.version).toBe(1);
    expect(parent.decisions).toEqual([]);
    expect(Object.isFrozen(child.sections[0]?.blocks[0])).toBe(true);
  });

  it("serializes equivalent artifacts deterministically and excludes runtime fields", () => {
    const { input } = artifactParts();
    const first = createArtifact(input);
    const second = createArtifact({
      ...input,
      sections: input.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({ ...block })),
      })),
    });

    expect(stableSerializeArtifact(first)).toBe(stableSerializeArtifact(second));
    expect(stableSerializeArtifact(first)).not.toContain("runtime");
  });

  it("reports missing references and claim/evidence changes in a diff", () => {
    const { input, claim, section, block } = artifactParts();
    const before = createArtifact(input);
    const after = createArtifactVersion(before, {
      ...input,
      id: "artifact-2",
      claims: [
        {
          ...claim,
          text: "Engineer building dependable systems.",
          status: "disputed" as const,
          evidence: [{ ...evidence, locator: "line:6-7" }],
        },
        {
          id: "claim-added",
          text: "Delivered measurable improvements.",
          sectionId: "section-summary",
          blockId: "block-summary-1",
          substantive: true,
          status: "unverified" as const,
          evidence: [],
        },
      ],
      sections: [
        {
          ...section,
          blocks: [
            {
              ...block,
              claimIds: ["claim-summary-1", "claim-added"],
            },
          ],
        },
      ],
    });

    expect(diffArtifacts(before, after)).toEqual({
      addedClaimIds: ["claim-added"],
      removedClaimIds: [],
      changedClaimIds: ["claim-summary-1"],
      changedEvidenceClaimIds: ["claim-summary-1"],
      changedSectionIds: ["section-summary"],
    });

    const broken = {
      ...after,
      claims: [{ ...after.claims[0], blockId: "missing-block" }],
    } as DraftArtifact;
    expect(validateArtifactReferences(broken)).toContainEqual({
      code: "missing-block-reference",
      claimId: "claim-summary-1",
      message: "claim claim-summary-1 references a missing block",
      path: "claims.0.blockId",
    });
  });
});
