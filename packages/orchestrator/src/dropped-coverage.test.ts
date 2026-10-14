import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { droppedCoverageFindings } from "./dropped-coverage.js";
import type { RevisionRequirementCoverage } from "./revision-coverage.js";

const timestamp = "2026-08-12T10:00:00.000Z";

function artifact(version: number, blocks: readonly { id: string; text: string }[]): DraftArtifact {
  return {
    schemaVersion: 1,
    id: `artifact-${version}`,
    version,
    parentVersionId: version === 1 ? null : `artifact-${version - 1}`,
    createdAt: timestamp,
    language: "en",
    sections: [
      {
        id: `section-${version}`,
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: blocks.map((block) => ({ ...block, type: "bullet" as const, claimIds: [] })),
      },
    ],
    claims: [],
    decisions: [],
  };
}

const previous = artifact(1, [
  { id: "block-a", text: "Core areas: token standards and tokenisation." },
  { id: "block-b", text: "Led a platform migration." },
]);

function covered(
  citedBlockIds: readonly string[],
  requirementId = "requirement-1",
): RevisionRequirementCoverage {
  return { requirementId, verdict: "covered", rationale: "Stated.", citedBlockIds };
}

describe("droppedCoverageFindings", () => {
  it("keeps a cited block that survives with the same id", () => {
    const revised = artifact(2, [{ id: "block-a", text: "Rewritten core areas." }]);

    expect(
      droppedCoverageFindings({
        previousCoverage: [covered(["block-a"])],
        previousArtifact: previous,
        revisedArtifact: revised,
      }),
    ).toEqual([]);
  });

  it("keeps a cited block whose text survives under a new id", () => {
    const revised = artifact(2, [
      { id: "block-x", text: "  Core areas:  token standards\nand tokenisation. " },
    ]);

    expect(
      droppedCoverageFindings({
        previousCoverage: [covered(["block-a"])],
        previousArtifact: previous,
        revisedArtifact: revised,
      }),
    ).toEqual([]);
  });

  it("warns, without content, when every cited block is gone", () => {
    const revised = artifact(2, [{ id: "block-x", text: "Led a platform migration." }]);

    const findings = droppedCoverageFindings({
      previousCoverage: [covered(["block-a"])],
      previousArtifact: previous,
      revisedArtifact: revised,
    });

    expect(findings).toEqual([
      {
        code: "coverage-block-dropped",
        category: "coverage",
        severity: "warning",
        message:
          "A block that covered this requirement in the previous version was removed or rewritten; check that the requirement is still shown.",
        requirementId: "requirement-1",
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain("tokenisation");
  });

  it("does not warn while one of several cited blocks is kept", () => {
    const revised = artifact(2, [{ id: "block-x", text: "Led a platform migration." }]);

    expect(
      droppedCoverageFindings({
        previousCoverage: [covered(["block-a", "block-b"])],
        previousArtifact: previous,
        revisedArtifact: revised,
      }),
    ).toEqual([]);
  });

  it("ignores requirements judged uncovered", () => {
    const revised = artifact(2, [{ id: "block-x", text: "Something else." }]);

    expect(
      droppedCoverageFindings({
        previousCoverage: [
          {
            requirementId: "requirement-2",
            verdict: "uncovered",
            rationale: "Not stated.",
            citedBlockIds: [],
          },
        ],
        previousArtifact: previous,
        revisedArtifact: revised,
      }),
    ).toEqual([]);
  });

  it("reports each dropped requirement once", () => {
    const revised = artifact(2, [{ id: "block-x", text: "Something else." }]);

    const findings = droppedCoverageFindings({
      previousCoverage: [
        covered(["block-a"]),
        covered(["block-b"], "requirement-2"),
        covered(["block-a"]),
      ],
      previousArtifact: previous,
      revisedArtifact: revised,
    });

    expect(findings.map((finding) => finding.requirementId)).toEqual([
      "requirement-1",
      "requirement-2",
    ]);
  });
});
