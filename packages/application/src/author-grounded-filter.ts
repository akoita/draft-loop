import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AgentExecution } from "@draft-loop/orchestrator";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";

import { type CompleteCvProposalIssue, completeCvProposalIssues } from "./complete-cv.js";

type ProposalSection = AuthorArtifactProposal["sections"][number];
type ProposalBlock = ProposalSection["blocks"][number];

/** An author proposal reduced to the blocks that pass every grounding check. */
export interface GroundedAuthorProposal {
  readonly proposal: AuthorArtifactProposal;
  /** Blocks removed because a claim or the block text failed grounding. */
  readonly removedBlocks: number;
  /** Blocks whose text was reduced to their own grounded substantive claims. */
  readonly shortenedBlocks: number;
}

type BlockRepair = "remove" | "shorten";

const claimIssueCodes = new Set<string>([
  "missing_evidence",
  "unsupported_claim",
  "factual_invariant_violation",
]);

function blockKey(sectionIndex: number, blockIndex: number): string {
  return `${sectionIndex}:${blockIndex}`;
}

/**
 * Decide one repair per affected block, or return undefined when any issue is
 * not confined to a single block (for example an omitted required section).
 * A claim failure removes the whole block. Ungrounded text outside otherwise
 * grounded claims shortens the block once; a second failure removes it.
 */
function blockRepairs(
  proposal: AuthorArtifactProposal,
  issues: readonly CompleteCvProposalIssue[],
  shortened: ReadonlySet<ProposalBlock>,
): ReadonlyMap<string, BlockRepair> | undefined {
  const repairs = new Map<string, BlockRepair>();
  for (const { code, path } of issues) {
    const [sections, sectionIndex, blocks, blockIndex, field] = path;
    if (
      sections !== "sections" ||
      blocks !== "blocks" ||
      typeof sectionIndex !== "number" ||
      typeof blockIndex !== "number"
    ) {
      return undefined;
    }
    const block = proposal.sections[sectionIndex]?.blocks[blockIndex];
    if (block === undefined) return undefined;
    const key = blockKey(sectionIndex, blockIndex);
    if (field === "claims" && claimIssueCodes.has(code)) {
      repairs.set(key, "remove");
    } else if (field === "text" && code === "substantive_text_uncovered") {
      const canShorten = !shortened.has(block) && block.claims.some((claim) => claim.substantive);
      if (repairs.get(key) !== "remove") repairs.set(key, canShorten ? "shorten" : "remove");
    } else if (field === "text" && code === "factual_invariant_violation") {
      repairs.set(key, "remove");
    } else {
      return undefined;
    }
  }
  return repairs;
}

/** Rebuild block text from its substantive claims, which already passed grounding. */
function shortenedBlock(block: ProposalBlock): ProposalBlock {
  const claims = block.claims.filter((claim) => claim.substantive);
  let text = "";
  for (const claim of claims) {
    const claimText = claim.text.trim();
    if (text === "") text = claimText;
    else text += /[.!?;:,]$/u.test(text) ? ` ${claimText}` : `; ${claimText}`;
  }
  return { ...block, text, claims };
}

/**
 * Keep the grounded part of a rejected author proposal.
 *
 * Grounding stays exactly as strict: the result is re-checked with the same
 * `completeCvProposalIssues` rules until it passes. Only block-scoped failures
 * are repaired, by removing or shortening the affected blocks; nothing is
 * rewritten with new wording. Sections left without blocks are removed.
 * Returns undefined when an issue cannot be confined to a block or when no
 * section would remain, so the caller keeps failing closed.
 */
export function filterGroundedAuthorProposal(
  proposal: AuthorArtifactProposal,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
  requiredSections: readonly string[] = [],
): GroundedAuthorProposal | undefined {
  let current = proposal;
  let removedBlocks = 0;
  const shortened = new Set<ProposalBlock>();
  for (;;) {
    const issues = completeCvProposalIssues(current, retrievedEvidence, requiredSections);
    if (issues.length === 0) {
      return { proposal: current, removedBlocks, shortenedBlocks: shortened.size };
    }
    const repairs = blockRepairs(current, issues, shortened);
    if (repairs === undefined) return undefined;
    const sections: ProposalSection[] = [];
    for (const [sectionIndex, section] of current.sections.entries()) {
      const blocks: ProposalBlock[] = [];
      for (const [blockIndex, block] of section.blocks.entries()) {
        const repair = repairs.get(blockKey(sectionIndex, blockIndex));
        if (repair === "remove") {
          removedBlocks += 1;
          shortened.delete(block);
        } else if (repair === "shorten") {
          const replacement = shortenedBlock(block);
          shortened.add(replacement);
          blocks.push(replacement);
        } else {
          blocks.push(block);
        }
      }
      if (blocks.length > 0) sections.push({ ...section, blocks });
    }
    if (sections.length === 0) return undefined;
    current = { sections };
  }
}

type OutputFinding = NonNullable<AgentExecution<unknown>["outputFindings"]>[number];

function blocksPhrase(count: number): string {
  return count === 1 ? "1 draft block was" : `${count} draft blocks were`;
}

/**
 * The content-free warning shown when ungrounded author content was left out
 * of the draft, or no findings when nothing was left out.
 */
export function ungroundedAuthorContentFindings({
  removedBlocks,
  shortenedBlocks,
}: Pick<GroundedAuthorProposal, "removedBlocks" | "shortenedBlocks">): readonly OutputFinding[] {
  const changes = [
    ...(removedBlocks > 0 ? [`${blocksPhrase(removedBlocks)} removed`] : []),
    ...(shortenedBlocks > 0 ? [`${blocksPhrase(shortenedBlocks)} shortened`] : []),
  ];
  if (changes.length === 0) return [];
  return [
    {
      code: "ungrounded-author-content-dropped",
      category: "evidence",
      severity: "warning",
      message: `${changes.join(" and ")} because the author's wording could not be matched to the cited evidence. Check the draft for missing content.`,
    },
  ];
}
