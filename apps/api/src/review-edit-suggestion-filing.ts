import type { ApplicationService, RunReview } from "@draft-loop/application";
import {
  type EditedReviewBlock,
  fileReviewEditSuggestions,
  reviewEditSuggestions,
} from "@draft-loop/application/review-edit-suggestions";
import type { FactSuggestionStore } from "@draft-loop/storage/fact-suggestions";
import type { FastifyBaseLogger } from "fastify";

/** The blocks of a review whose recorded edit replaces the author's text. */
export function editedReviewBlocks(review: RunReview | undefined): readonly EditedReviewBlock[] {
  const blocks: EditedReviewBlock[] = [];
  for (const section of review?.draft?.sections ?? []) {
    for (const block of section.blocks) {
      if (block.draftedText !== undefined && block.draftedText !== block.text) {
        blocks.push({ blockId: block.id, draftedText: block.draftedText, editedText: block.text });
      }
    }
  }
  return blocks;
}

/**
 * Files profile suggestions for the facts an approved run's edits changed (#3167), against the
 * profile version the run was pinned to. It never fails the approval: a problem is logged by ids
 * only, and the count of new suggestions is answered.
 */
export async function fileApprovalEditSuggestions(input: {
  readonly service: ApplicationService;
  readonly store: Pick<FactSuggestionStore, "insert">;
  readonly root: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly round: number;
  readonly blocks: readonly EditedReviewBlock[];
  readonly log: Pick<FastifyBaseLogger, "info" | "warn">;
  readonly now?: () => Date;
}): Promise<number> {
  const { service, root, workspaceId, runId, blocks, log } = input;
  if (blocks.length === 0) return 0;
  try {
    const pinned = (await service.readRunInputs?.({ root, runId }))?.profile;
    if (pinned === undefined || pinned === null) return 0;
    const record = await service.getCanonicalCandidateProfile({
      root,
      profileId: pinned.profileId,
      version: pinned.version,
    });
    if (record === undefined) return 0;
    const suggestions = reviewEditSuggestions({
      blocks,
      profile: record.profile,
      runId,
      round: input.round,
      createdAt: (input.now ?? (() => new Date()))().toISOString(),
    });
    const filed = await fileReviewEditSuggestions(input.store, workspaceId, suggestions);
    if (filed > 0) {
      log.info(
        { workspaceId, runId, profileId: pinned.profileId, filed },
        "fact suggestions filed from approval edits",
      );
    }
    return filed;
  } catch (error) {
    log.warn(
      { workspaceId, runId, errorName: error instanceof Error ? error.name : "unknown" },
      "fact suggestions from approval edits were not filed",
    );
    return 0;
  }
}
