import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";

import { extractProtectedValues, supportsProtectedValueInChunks } from "./author-grounding.js";
import { claimCoverageIssues } from "./claim-coverage.js";
import { requiredSectionProposalIssues } from "./required-section-evidence.js";
import { shortNamesRelated } from "./short-name-relation.js";
import { unsupportedSingleWordNames } from "./single-word-name-grounding.js";
import {
  blockCitedChunks,
  hasUnsupportedDateRange,
  uncoveredTextIntroducesUnsupportedFact,
} from "./uncovered-text-grounding.js";

export const factualInvariantIssueCodes = [
  "missing_evidence",
  "unsupported_claim",
  "factual_invariant_violation",
  "required_section_evidence_omitted",
  "substantive_text_uncovered",
] as const;

export type FactualInvariantIssueCode = (typeof factualInvariantIssueCodes)[number];

export interface CompleteCvProposalIssue {
  readonly path: PropertyKey[];
  readonly code: FactualInvariantIssueCode;
  readonly message: string;
}

const meaningfulTokenPattern = /[\p{L}\p{N}]+/gu;

const ignoredTokens = new Set(["and", "for", "from", "into", "the", "that", "this", "with"]);

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function meaningfulTokens(value: string): readonly string[] {
  return (normalized(value).match(meaningfulTokenPattern) ?? []).filter(
    (token) => token.length >= 3 && !ignoredTokens.has(token),
  );
}

/**
 * Fail closed when a live CV proposal cites no evidence, unrelated evidence,
 * or evidence that changes exact factual invariants such as dates, metrics,
 * credentials, links, employers, multi-word titles, and single-word names.
 * Block text outside substantive claims fails only when it introduces a word,
 * value, or name the evidence does not support.
 */
export function completeCvProposalIssues(
  proposal: AuthorArtifactProposal,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
  requiredSections: readonly string[] = [],
): readonly CompleteCvProposalIssue[] {
  const evidenceById = new Map(retrievedEvidence.map((chunk) => [chunk.id, chunk.text] as const));
  const issues: CompleteCvProposalIssue[] = [];
  const coverageIssues = claimCoverageIssues(proposal);

  for (const [sectionIndex, section] of proposal.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      const blockClaimIssuesStart = issues.length;
      for (const [claimIndex, claim] of block.claims.entries()) {
        if (!claim.substantive) continue;
        const path = ["sections", sectionIndex, "blocks", blockIndex, "claims", claimIndex];
        if (claim.evidenceChunkIds.length === 0) {
          issues.push({
            code: "missing_evidence",
            path: [...path, "evidenceChunkIds"],
            message: "substantive CV claims require candidate evidence",
          });
          continue;
        }
        const evidenceChunks = claim.evidenceChunkIds.map((id) => evidenceById.get(id) ?? "");
        const evidence = normalized(evidenceChunks.join("\n"));
        const tokens = meaningfulTokens(claim.text);
        const related =
          tokens.length > 0
            ? tokens.some((token) => evidence.includes(token))
            : shortNamesRelated(claim.text, evidenceChunks);
        if (!related) {
          issues.push({
            code: "unsupported_claim",
            path: [...path, "evidenceChunkIds"],
            message: "cited evidence does not support the CV claim",
          });
        }
        const changesFactualInvariant =
          extractProtectedValues(claim.text).some(
            (value) => !supportsProtectedValueInChunks(evidenceChunks, value),
          ) ||
          hasUnsupportedDateRange(claim.text, evidenceChunks) ||
          unsupportedSingleWordNames(claim.text, evidenceChunks).length > 0;
        if (changesFactualInvariant) {
          issues.push({
            code: "factual_invariant_violation",
            path: [...path, "text"],
            message: "CV claim changes a factual invariant absent from cited evidence",
          });
        }
      }
      const blockPathHasUncoveredText = coverageIssues.some(
        ({ path }) => path[1] === sectionIndex && path[3] === blockIndex,
      );
      const blockHasUnsupportedRange = hasUnsupportedDateRange(
        block.text,
        blockCitedChunks(block, retrievedEvidence),
      );
      if (
        issues.length === blockClaimIssuesStart &&
        !blockPathHasUncoveredText &&
        blockHasUnsupportedRange
      ) {
        issues.push({
          code: "factual_invariant_violation",
          path: ["sections", sectionIndex, "blocks", blockIndex, "text"],
          message: "CV block date range is not present in a cited evidence chunk",
        });
      }
    }
  }
  const uncoveredFactIssues = coverageIssues
    .filter((issue) => {
      const [, sectionIndex, , blockIndex] = issue.path;
      const section =
        typeof sectionIndex === "number" ? proposal.sections[sectionIndex] : undefined;
      const block = typeof blockIndex === "number" ? section?.blocks[blockIndex] : undefined;
      return (
        section === undefined ||
        block === undefined ||
        uncoveredTextIntroducesUnsupportedFact(section, block, retrievedEvidence)
      );
    })
    .map((issue) => ({
      ...issue,
      message: "text outside substantive claims introduces a fact absent from evidence",
    }));
  return [
    ...issues,
    ...uncoveredFactIssues,
    ...requiredSectionProposalIssues(proposal, requiredSections, retrievedEvidence),
  ];
}
