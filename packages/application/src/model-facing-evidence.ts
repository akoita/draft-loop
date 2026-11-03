import type { ScoredEvidenceChunk } from "@draft-loop/domain";

import type { RequirementAchievementPlan } from "./requirement-achievement-plan.js";

/** A retrieved chunk as the author and critic models receive it. */
export interface ModelFacingEvidenceChunk {
  readonly id: string;
  /** The run-local source alias (`S1`, `S2`, …), or the source id when one already looks like an alias. */
  readonly sourceId: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly text: string;
}

export interface ModelFacingRunEvidence {
  readonly retrievedEvidence: readonly ModelFacingEvidenceChunk[];
  readonly achievementPlan: RequirementAchievementPlan;
}

const aliasPattern = /^S\d+$/u;

/**
 * The retrieved evidence and the achievement plan as every model call of a run sends them.
 *
 * A retrieved chunk carries a 64-character checksum, a hashed source id, a workspace id, a rank and
 * an ordinal that no prompt names and no output cites; on a full-source run they were about a
 * sixth of the cached prefix each call pays to write. The models get each chunk's id, its source as
 * a short run-local alias assigned in order of first appearance, its line numbers (the author's
 * locators and the critic's evidence table resolve against them) and its text. The plan's
 * achievements name their source by the same alias. Everything local keeps the full chunks.
 */
export function modelFacingRunEvidence(
  retrievedEvidence: readonly ScoredEvidenceChunk[],
  achievementPlan: RequirementAchievementPlan,
): ModelFacingRunEvidence {
  const aliasBySourceId = new Map<string, string>();
  // A source id that already looks like an alias could be confused with one, so keep real ids then.
  const usable = !retrievedEvidence.some(({ sourceId }) => aliasPattern.test(sourceId));
  const alias = (sourceId: string): string => {
    if (!usable) return sourceId;
    const known = aliasBySourceId.get(sourceId);
    if (known !== undefined) return known;
    const next = `S${aliasBySourceId.size + 1}`;
    aliasBySourceId.set(sourceId, next);
    return next;
  };
  return {
    retrievedEvidence: retrievedEvidence.map(({ id, sourceId, lineStart, lineEnd, text }) => ({
      id,
      sourceId: alias(sourceId),
      lineStart,
      lineEnd,
      text,
    })),
    achievementPlan: {
      ...achievementPlan,
      achievements: achievementPlan.achievements.map((achievement) => ({
        ...achievement,
        sourceId: alias(achievement.sourceId),
      })),
    },
  };
}
