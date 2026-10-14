import type { DraftArtifact } from "@draft-loop/schemas";
import type { ValidationIssue } from "@draft-loop/validation";

import type { RevisionRequirementCoverage } from "./revision-coverage.js";

export const COVERAGE_BLOCK_DROPPED_CODE = "coverage-block-dropped";

const droppedCoverageMessage =
  "A block that covered this requirement in the previous version was removed or rewritten; check that the requirement is still shown.";

function normalizedText(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function blocksOf(artifact: DraftArtifact) {
  return artifact.sections.flatMap((section) => section.blocks);
}

/**
 * Content-free warnings for requirements the critic judged covered in the
 * previous version whose cited blocks are all gone from the revision. A cited
 * block is kept when the revision has a block with the same id, or a block
 * whose whitespace-normalized text equals the cited block's text: author
 * output assigns new block ids on every execution, so text is the identity
 * that survives an unchanged block.
 */
export function droppedCoverageFindings(input: {
  readonly previousCoverage: readonly RevisionRequirementCoverage[];
  readonly previousArtifact: DraftArtifact;
  readonly revisedArtifact: DraftArtifact;
}): readonly ValidationIssue[] {
  const previousText = new Map(
    blocksOf(input.previousArtifact).map((block) => [block.id, normalizedText(block.text)]),
  );
  const revisedBlocks = blocksOf(input.revisedArtifact);
  const revisedIds = new Set(revisedBlocks.map((block) => block.id));
  const revisedTexts = new Set(revisedBlocks.map((block) => normalizedText(block.text)));
  const kept = (blockId: string) => {
    if (revisedIds.has(blockId)) return true;
    const text = previousText.get(blockId);
    return text !== undefined && revisedTexts.has(text);
  };

  const reported = new Set<string>();
  const findings: ValidationIssue[] = [];
  for (const coverage of input.previousCoverage) {
    if (coverage.verdict !== "covered" || coverage.citedBlockIds.length === 0) continue;
    if (reported.has(coverage.requirementId) || coverage.citedBlockIds.some(kept)) continue;
    reported.add(coverage.requirementId);
    findings.push(
      Object.freeze({
        code: COVERAGE_BLOCK_DROPPED_CODE,
        category: "coverage",
        severity: "warning",
        message: droppedCoverageMessage,
        requirementId: coverage.requirementId,
      }),
    );
  }
  return Object.freeze(findings);
}
