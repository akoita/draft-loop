import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";

import { extractProtectedValues } from "./author-grounding.js";

export interface CompleteCvProposalIssue {
  readonly path: PropertyKey[];
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
 * credentials, links, employers, and multi-word titles.
 */
export function completeCvProposalIssues(
  proposal: AuthorArtifactProposal,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): readonly CompleteCvProposalIssue[] {
  const evidenceById = new Map(retrievedEvidence.map((chunk) => [chunk.id, chunk.text] as const));
  const issues: CompleteCvProposalIssue[] = [];

  for (const [sectionIndex, section] of proposal.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      for (const [claimIndex, claim] of block.claims.entries()) {
        if (!claim.substantive) continue;
        const path = ["sections", sectionIndex, "blocks", blockIndex, "claims", claimIndex];
        if (claim.evidenceChunkIds.length === 0) {
          issues.push({
            path: [...path, "evidenceChunkIds"],
            message: "substantive CV claims require candidate evidence",
          });
          continue;
        }
        const evidence = normalized(
          claim.evidenceChunkIds.map((id) => evidenceById.get(id) ?? "").join("\n"),
        );
        const related = meaningfulTokens(claim.text).some((token) => evidence.includes(token));
        if (!related) {
          issues.push({
            path: [...path, "evidenceChunkIds"],
            message: "cited evidence does not support the CV claim",
          });
        }
        for (const value of extractProtectedValues(claim.text)) {
          if (!evidence.includes(normalized(value))) {
            issues.push({
              path: [...path, "text"],
              message: "CV claim changes a factual invariant absent from cited evidence",
            });
            break;
          }
        }
      }
    }
  }
  return issues;
}
