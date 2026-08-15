import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { type DeterministicValidationContext, validateDraftArtifact } from "./index.js";

const evidence = (excerpt: string) => ({
  sourcePath: "/local/evidence.txt",
  excerpt,
});

function artifactWithClaim(
  claimText: string,
  claimEvidence: readonly ReturnType<typeof evidence>[],
): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt: "2026-08-12T10:00:00.000Z",
    language: "en",
    sections: [
      {
        id: "section-summary",
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          {
            id: "block-summary",
            type: "paragraph",
            text: claimText,
            claimIds: ["claim-1"],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: claimText,
        sectionId: "section-summary",
        blockId: "block-summary",
        substantive: true,
        status: "verified",
        evidence: [...claimEvidence],
      },
    ],
    decisions: [],
  };
}

function context(
  overrides: Partial<DeterministicValidationContext> = {},
): DeterministicValidationContext {
  return {
    requirements: [],
    outputConstraints: { requiredSections: [] },
    ...overrides,
  };
}

describe("deterministic artifact validation", () => {
  it("blocks a missing required section and a claim not linked to candidate-provided materials", () => {
    const result = validateDraftArtifact(
      artifactWithClaim("Built reliable systems.", []),
      context({
        outputConstraints: { requiredSections: ["  Work   Experience  "] },
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "missing-required-section",
        category: "format",
        severity: "error",
      }),
      expect.objectContaining({
        code: "unsupported-claim",
        category: "evidence",
        severity: "error",
        message: "substantive claim is not linked to candidate-provided materials",
        claimId: "claim-1",
        sectionId: "section-summary",
      }),
    ]);
    const claimIssue = result.issues.find((issue) => issue.code === "unsupported-claim");
    expect(claimIssue?.message).not.toMatch(
      /\b(?:evidence|proof|verification|unproven|objectively unsupported)\b/iu,
    );
  });

  it("treats section title case and whitespace differences as equivalent", () => {
    const result = validateDraftArtifact(
      artifactWithClaim("Built reliable systems.", [evidence("Built reliable systems.")]),
      context({
        outputConstraints: { requiredSections: [" sUmMaRy "] },
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports character, word, and legacy character limits", () => {
    const artifact = artifactWithClaim("Built reliable systems with TypeScript.", [
      evidence("Built reliable systems with TypeScript."),
    ]);
    const result = validateDraftArtifact(
      artifact,
      context({
        outputConstraints: {
          requiredSections: [],
          maxWords: 2,
          maxCharacters: 5,
          maxLength: 5,
        },
      }),
    );

    expect(result.issues.map((issue) => issue.code)).toEqual([
      "max-words-exceeded",
      "max-characters-exceeded",
      "max-length-exceeded",
    ]);
  });

  it("warns for duplicate blocks and claims plus non-critical uncovered requirements", () => {
    const artifact = artifactWithClaim("Built reliable systems.", [
      evidence("Built reliable systems."),
    ]);
    artifact.sections[0]?.blocks.push({
      id: "block-duplicate",
      type: "paragraph",
      text: "Built   reliable systems.",
      claimIds: ["claim-2"],
    });
    const firstClaim = artifact.claims[0];
    if (firstClaim === undefined) {
      throw new Error("the fixture must contain a claim");
    }
    artifact.claims.push({
      ...firstClaim,
      id: "claim-2",
      text: "Built   reliable systems.",
    });

    const result = validateDraftArtifact(
      artifact,
      context({
        requirements: [{ id: "requirement-docker", text: "Docker", priority: "low" }],
        outputConstraints: { requiredSections: [] },
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "duplicate-content",
      "duplicate-content",
      "uncovered-requirement",
    ]);
    expect(result.issues[1]).toMatchObject({ claimId: "claim-2", sectionId: "section-summary" });
    expect(result.issues[2]).toMatchObject({ requirementId: "requirement-docker" });
  });

  it("emits an explicit critical gap as a warning instead of an uncovered error", () => {
    const result = validateDraftArtifact(
      artifactWithClaim("Built reliable systems.", [evidence("Built reliable systems.")]),
      context({
        requirements: [
          { id: "requirement-critical", text: "Kubernetes leadership", priority: "critical" },
        ],
        outputConstraints: { requiredSections: [] },
      }),
      ["requirement-critical"],
    );

    expect(result).toMatchObject({ valid: true });
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "explicit-gap",
        category: "coverage",
        severity: "warning",
        requirementId: "requirement-critical",
      }),
    ]);
  });

  it("flags unsupported quantification and non-overlapping explicit years", () => {
    const claim = "Improved revenue by 25% in 2023.";
    const result = validateDraftArtifact(
      artifactWithClaim(claim, [evidence("Improved revenue by 20% in 2022.")]),
      context(),
    );

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "unsupported-quantification",
        category: "factuality",
        claimId: "claim-1",
        sectionId: "section-summary",
        message: "substantive claim contains a metric not linked to candidate-provided materials",
      }),
      expect.objectContaining({
        code: "inconsistent-date",
        category: "factuality",
        claimId: "claim-1",
        sectionId: "section-summary",
        message: "claim and candidate-provided materials contain non-overlapping years",
      }),
    ]);
    for (const issue of result.issues) {
      expect(issue.message).toContain("candidate-provided materials");
      expect(issue.message).not.toMatch(
        /\b(?:evidence|proof|verification|unproven|objectively unsupported)\b/iu,
      );
    }

    const matchingDate = validateDraftArtifact(
      artifactWithClaim("Worked there in 2023.", [evidence("Worked there in 2023.")]),
      context(),
    );
    expect(matchingDate.issues).toEqual([]);
  });

  it("orders and freezes identical results deterministically", () => {
    const artifact = artifactWithClaim("Built reliable systems.", []);
    const validationContext = context({
      requirements: [{ id: "requirement-critical", text: "Kubernetes", priority: "critical" }],
      outputConstraints: { requiredSections: ["Experience"] },
    });
    const first = validateDraftArtifact(artifact, validationContext);
    const second = validateDraftArtifact(artifact, validationContext);

    expect(first).toEqual(second);
    expect(first.issues.map((issue) => issue.code)).toEqual([
      "missing-required-section",
      "unsupported-claim",
      "uncovered-requirement",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.issues)).toBe(true);
  });
});
