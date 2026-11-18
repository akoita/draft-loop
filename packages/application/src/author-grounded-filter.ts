import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AgentExecution } from "@draft-loop/orchestrator";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";

import { type CompleteCvProposalIssue, completeCvProposalIssues } from "./complete-cv.js";

type ProposalSection = AuthorArtifactProposal["sections"][number];
type ProposalBlock = ProposalSection["blocks"][number];

/** An author proposal reduced to the blocks that pass every grounding check. */
export interface GroundedAuthorProposal {
  readonly proposal: AuthorArtifactProposal;
  /** Blocks removed because the block text or every substantive claim failed grounding. */
  readonly removedBlocks: number;
  /** Blocks whose text was reduced to their own grounded substantive claims, less failing ones. */
  readonly shortenedBlocks: number;
}

/**
 * One repair per block: remove it, or rebuild its text from its substantive claims less the
 * claims in `drop`, which failed grounding.
 */
type BlockRepair =
  | { readonly kind: "remove" }
  | { readonly kind: "shorten"; readonly drop: ReadonlySet<number> };

const removeBlock: BlockRepair = { kind: "remove" };

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
 * A failing claim is dropped and the block rebuilt from its other substantive
 * claims; a block left with none is removed. Ungrounded text outside otherwise
 * grounded claims shortens the block once; a second failure removes it.
 */
function blockRepairs(
  proposal: AuthorArtifactProposal,
  issues: readonly CompleteCvProposalIssue[],
  shortened: ReadonlySet<ProposalBlock>,
): ReadonlyMap<string, BlockRepair> | { readonly unconfined: string } {
  const removed = new Set<string>();
  const shorten = new Set<string>();
  const drops = new Map<string, Set<number>>();
  const blocksByKey = new Map<string, ProposalBlock>();
  for (const { code, path } of issues) {
    const [sections, sectionIndex, blocks, blockIndex, field, claimIndex] = path;
    if (
      sections !== "sections" ||
      blocks !== "blocks" ||
      typeof sectionIndex !== "number" ||
      typeof blockIndex !== "number"
    ) {
      return { unconfined: code };
    }
    const block = proposal.sections[sectionIndex]?.blocks[blockIndex];
    if (block === undefined) return { unconfined: code };
    const key = blockKey(sectionIndex, blockIndex);
    blocksByKey.set(key, block);
    if (field === "claims" && claimIssueCodes.has(code) && typeof claimIndex === "number") {
      const drop = drops.get(key) ?? new Set<number>();
      drop.add(claimIndex);
      drops.set(key, drop);
    } else if (field === "text" && code === "substantive_text_uncovered") {
      if (shortened.has(block)) removed.add(key);
      else shorten.add(key);
    } else if (field === "text" && code === "factual_invariant_violation") {
      removed.add(key);
    } else {
      return { unconfined: code };
    }
  }
  const repairs = new Map<string, BlockRepair>();
  for (const [key, block] of blocksByKey) {
    const drop = drops.get(key) ?? new Set<number>();
    const keepsClaim = block.claims.some(
      (claim, claimIndex) => claim.substantive && !drop.has(claimIndex),
    );
    repairs.set(key, removed.has(key) || !keepsClaim ? removeBlock : { kind: "shorten", drop });
  }
  return repairs;
}

/**
 * Rebuild block text from its substantive claims less the dropped ones; the result is checked
 * again with the same rules, so nothing it keeps escapes grounding.
 */
function shortenedBlock(block: ProposalBlock, drop: ReadonlySet<number>): ProposalBlock {
  const claims = block.claims.filter(
    (claim, claimIndex) => claim.substantive && !drop.has(claimIndex),
  );
  let text = "";
  for (const claim of claims) {
    const claimText = claim.text.trim();
    if (text === "") text = claimText;
    else text += /[.!?;:,]$/u.test(text) ? ` ${claimText}` : `; ${claimText}`;
  }
  return { ...block, text, claims };
}

/**
 * Why a rejected proposal could not be reduced to its grounded part, content-free: the code of
 * the first issue that no block repair can fix (such as an emptied required section), or
 * `no_section_left` when every section lost all its blocks.
 */
export interface GroundedFilterFailure {
  readonly failed: true;
  readonly reason: string;
}

/**
 * Keep the grounded part of a rejected author proposal.
 *
 * Grounding stays exactly as strict: the result is re-checked with the same
 * `completeCvProposalIssues` rules until it passes. Only block-scoped failures
 * are repaired, by dropping failing claims, shortening or removing the affected
 * blocks; nothing is rewritten with new wording. Sections left without blocks
 * are removed. Returns a failure with its reason when an issue cannot be
 * confined to a block or when no section would remain, so the caller keeps
 * failing closed and can say why.
 */
export function groundAuthorProposal(
  proposal: AuthorArtifactProposal,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
  requiredSections: readonly string[] = [],
): GroundedAuthorProposal | GroundedFilterFailure {
  let current = proposal;
  let removedBlocks = 0;
  const shortened = new Set<ProposalBlock>();
  for (;;) {
    const issues = completeCvProposalIssues(current, retrievedEvidence, requiredSections);
    if (issues.length === 0) {
      return { proposal: current, removedBlocks, shortenedBlocks: shortened.size };
    }
    const repairs = blockRepairs(current, issues, shortened);
    if ("unconfined" in repairs) return { failed: true, reason: repairs.unconfined };
    const sections: ProposalSection[] = [];
    for (const [sectionIndex, section] of current.sections.entries()) {
      const blocks: ProposalBlock[] = [];
      for (const [blockIndex, block] of section.blocks.entries()) {
        const repair = repairs.get(blockKey(sectionIndex, blockIndex));
        if (repair?.kind === "remove") {
          removedBlocks += 1;
          shortened.delete(block);
        } else if (repair?.kind === "shorten") {
          const replacement = shortenedBlock(block, repair.drop);
          shortened.delete(block);
          shortened.add(replacement);
          blocks.push(replacement);
        } else {
          blocks.push(block);
        }
      }
      if (blocks.length > 0) sections.push({ ...section, blocks });
    }
    if (sections.length === 0) return { failed: true, reason: "no_section_left" };
    current = { sections };
  }
}

/** `groundAuthorProposal` without the failure reason: undefined when it fails closed. */
export function filterGroundedAuthorProposal(
  proposal: AuthorArtifactProposal,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
  requiredSections: readonly string[] = [],
): GroundedAuthorProposal | undefined {
  const result = groundAuthorProposal(proposal, retrievedEvidence, requiredSections);
  return "failed" in result ? undefined : result;
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
