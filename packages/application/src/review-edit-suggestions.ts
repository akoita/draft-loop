/**
 * Profile suggestions from approval edits (#3167): when a person's edit of a drafted block
 * changes a number, date or name of a fact in the run's pinned profile, approving the run files
 * one pending `correct` suggestion for that fact. The match is a word diff, with no model call
 * (`@draft-loop/domain/fact-suggestion-edit`). Filing never decides anything: the person accepts
 * or rejects each suggestion on the Career profile page.
 */

import type { CanonicalCandidateProfile } from "@draft-loop/domain";
import {
  type FactSuggestion,
  factSuggestionDedupeKey,
  factSuggestionSchemaVersion,
  factSuggestionTarget,
} from "@draft-loop/domain/fact-suggestion";
import { editedFactChanges } from "@draft-loop/domain/fact-suggestion-edit";
import {
  type FactSuggestionStore,
  FactSuggestionStoreError,
} from "@draft-loop/storage/fact-suggestions";

/** A block the person edited, with the text the author drafted. */
export interface EditedReviewBlock {
  readonly blockId: string;
  readonly draftedText: string;
  readonly editedText: string;
}

export interface ReviewEditSuggestionInput {
  readonly blocks: readonly EditedReviewBlock[];
  /** The profile version the run was pinned to. */
  readonly profile: CanonicalCandidateProfile;
  readonly runId: string;
  readonly applicationId?: string | undefined;
  /** The review round, from 1. */
  readonly round?: number | undefined;
  readonly createdAt: string;
  readonly generateId?: () => string;
}

function randomSuggestionId(): string {
  return `fsg_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

/** The base version id a suggestion names: the pinned profile version. */
export function profileVersionId(profile: Pick<CanonicalCandidateProfile, "version">): string {
  return `version-${profile.version}`;
}

/** One suggestion per fact the edits changed; the first edit that changes a fact wins. */
export function reviewEditSuggestions(input: ReviewEditSuggestionInput): readonly FactSuggestion[] {
  const generateId = input.generateId ?? randomSuggestionId;
  const facts = input.profile.facts;
  const filed = new Set<string>();
  const suggestions: FactSuggestion[] = [];
  for (const block of input.blocks) {
    const changes = editedFactChanges({
      draftedText: block.draftedText,
      editedText: block.editedText,
      facts,
    });
    for (const change of changes) {
      if (filed.has(change.fact.id)) continue;
      filed.add(change.fact.id);
      const target = factSuggestionTarget(change.fact);
      const proposed = { kind: "correct" as const, value: change.value };
      suggestions.push({
        schemaVersion: factSuggestionSchemaVersion,
        id: generateId(),
        profileId: input.profile.id,
        baseVersionId: profileVersionId(input.profile),
        change: proposed,
        target,
        quote: change.quote,
        speaker: "candidate",
        origin: {
          kind: "review-edit",
          runId: input.runId,
          blockId: block.blockId,
          ...(input.applicationId === undefined ? {} : { applicationId: input.applicationId }),
          ...(input.round === undefined ? {} : { round: input.round }),
        },
        dedupeKey: factSuggestionDedupeKey(proposed, target),
        status: "pending",
        createdAt: input.createdAt,
      });
    }
  }
  return suggestions;
}

/**
 * Saves the suggestions and answers how many were new. One already pending, decided or rejected
 * with the same key is skipped, so approving again never offers a change twice.
 */
export async function fileReviewEditSuggestions(
  store: Pick<FactSuggestionStore, "insert">,
  workspaceId: string,
  suggestions: readonly FactSuggestion[],
): Promise<number> {
  let filed = 0;
  for (const suggestion of suggestions) {
    try {
      await store.insert(workspaceId, suggestion);
      filed += 1;
    } catch (error) {
      if (error instanceof FactSuggestionStoreError && error.code === "duplicate_suggestion") {
        continue;
      }
      throw error;
    }
  }
  return filed;
}
