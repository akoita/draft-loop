import { validateDraftArtifact } from "@draft-loop/validation";
import { describe, expect, it } from "vitest";

import { buildAuthorArtifact } from "./author-output.js";

// A fictional candidate. The proposal has the shape cli-author-v7 asks for: a
// headline block opening the summary, a "Core areas" alignment section, and
// job-relevant bullets first in a role.
const evidence = [
  "Senior Software Engineer at Example Ledger, 2021 to 2024.",
  "Wrote Solidity contracts and Foundry invariant tests for a token vault.",
  "Prepared the vault contracts for an external security audit and fixed its findings.",
  "Organised the team's quarterly offsite.",
].map((text, ordinal) => ({
  id: `chunk-${ordinal + 1}`,
  workspaceId: "workspace-1",
  sourceId: "source-1",
  ordinal,
  lineStart: ordinal + 1,
  lineEnd: ordinal + 1,
  checksum: String(ordinal + 1).repeat(64),
  text,
  rank: ordinal,
}));

const context = {
  language: "en",
  evidenceManifest: [{ id: "source-1", path: "/local/career.md", checksum: "a".repeat(64) }],
} as const;

const claim = (text: string, ...chunks: number[]) => ({
  text,
  substantive: true,
  evidenceChunkIds: chunks.map((chunk) => `chunk-${chunk}`),
});

const proposal = {
  sections: [
    {
      title: "Summary",
      kind: "summary",
      blocks: [
        {
          type: "paragraph",
          text: "Senior Software Engineer | Solidity",
          claims: [claim("Senior Software Engineer", 1), claim("Solidity", 2)],
        },
        {
          type: "paragraph",
          text: "Wrote Solidity contracts and Foundry invariant tests for a token vault.",
          claims: [
            claim("Wrote Solidity contracts and Foundry invariant tests for a token vault.", 2),
          ],
        },
      ],
    },
    {
      title: "Core areas",
      kind: "alignment",
      blocks: [
        {
          type: "bullet",
          text: "Security audit: prepared the vault contracts for an external security audit.",
          claims: [
            claim("Security audit", 3),
            claim("prepared the vault contracts for an external security audit", 3),
          ],
        },
      ],
    },
    {
      title: "Experience",
      kind: "experience",
      blocks: [
        {
          type: "paragraph",
          text: "Senior Software Engineer, Example Ledger, 2021 to 2024",
          claims: [
            claim("Senior Software Engineer", 1),
            claim("Example Ledger", 1),
            claim("2021 to 2024", 1),
          ],
        },
        {
          type: "bullet",
          text: "Fixed the findings of an external security audit of the vault contracts.",
          claims: [claim("Fixed the findings of an external security audit", 3)],
        },
        {
          type: "bullet",
          text: "Organised the team's quarterly offsite.",
          claims: [claim("Organised the team's quarterly offsite.", 4)],
        },
      ],
    },
  ],
};

describe("job-tailored CV layout", () => {
  it("rejects a Core areas label whose words no evidence supports", () => {
    const unsupportedLabel = structuredClone(proposal);
    const block = unsupportedLabel.sections[1]?.blocks[0];
    if (block === undefined) throw new Error("Missing Core areas bullet");
    block.text = "Audit readiness: prepared the vault contracts for an external security audit.";
    block.claims = [claim("prepared the vault contracts for an external security audit", 3)];
    expect(() =>
      buildAuthorArtifact({
        proposal: unsupportedLabel,
        executionId: "tailored-layout-label",
        context,
        retrievedEvidence: evidence,
        createdAt: "2026-10-11T08:00:00.000Z",
      }),
    ).toThrow(/substantive_text_uncovered/u);
  });

  it("passes grounding and deterministic checks with a headline and a Core areas section", () => {
    const artifact = buildAuthorArtifact({
      proposal,
      executionId: "tailored-layout",
      context,
      retrievedEvidence: evidence,
      requiredSections: ["summary", "experience"],
      createdAt: "2026-10-11T08:00:00.000Z",
    });

    expect(artifact.sections.map(({ kind, title }) => [kind, title])).toEqual([
      ["summary", "Summary"],
      ["alignment", "Core areas"],
      ["experience", "Experience"],
    ]);
    const result = validateDraftArtifact(artifact, {
      requirements: [{ id: "audit", text: "External audit preparation", priority: "medium" }],
      outputConstraints: { requiredSections: ["summary", "experience"] },
    });
    expect(result.issues.filter(({ severity }) => severity === "error")).toEqual([]);
    // The headline repeats the role title from the experience heading. Short title-like
    // claims may repeat, so that is not a duplicate-content warning.
    expect(result.issues.filter(({ code }) => code === "duplicate-content")).toEqual([]);
  });
});
