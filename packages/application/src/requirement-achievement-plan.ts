import type { ScoredEvidenceChunk } from "@draft-loop/domain";

export type RequirementAchievementPlanStatus = "ready" | "no-evidence";

export interface PlannedRequirementCoverage {
  readonly requirementId: string;
  readonly evidenceChunkId: string | null;
}

export interface PlannedAchievement {
  readonly evidenceChunkId: string;
  readonly sourceId: string;
  readonly requirementIds: readonly string[];
}

export interface RequirementAchievementPlan {
  readonly status: RequirementAchievementPlanStatus;
  readonly coverage: readonly PlannedRequirementCoverage[];
  readonly achievements: readonly PlannedAchievement[];
  readonly uncoveredRequirementIds: readonly string[];
}

export interface PlanningRequirement {
  readonly id: string;
  readonly text: string;
}

const ignoredTerms = new Set(["and", "for", "from", "into", "the", "that", "this", "with", "your"]);

function terms(value: string): ReadonlySet<string> {
  return new Set(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((term) => term.length >= 3 && !ignoredTerms.has(term)) ?? [],
  );
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;
  for (const term of left) if (right.has(term)) count += 1;
  return count;
}

/** Build the single-workflow MVP plan without inventing or duplicating evidence. */
export function createRequirementAchievementPlan(
  requirements: readonly PlanningRequirement[],
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): RequirementAchievementPlan {
  const seenEvidenceIds = new Set<string>();
  const evidence = retrievedEvidence
    .filter((chunk) => {
      if (seenEvidenceIds.has(chunk.id)) return false;
      seenEvidenceIds.add(chunk.id);
      return true;
    })
    .filter((chunk) => chunk.text.trim() !== "")
    .map((chunk) => ({ chunk, terms: terms(chunk.text) }));
  const claimed = new Set<string>();
  const coverage: PlannedRequirementCoverage[] = [];
  const achievements: PlannedAchievement[] = [];
  const uncoveredRequirementIds: string[] = [];

  for (const requirement of requirements) {
    const requirementTerms = terms(requirement.text);
    const selected = evidence
      .filter(({ chunk }) => !claimed.has(chunk.id))
      .map((candidate) => ({ ...candidate, overlap: overlap(requirementTerms, candidate.terms) }))
      .filter(({ overlap: matchedTerms }) => matchedTerms > 0)
      .sort(
        (left, right) =>
          right.overlap - left.overlap ||
          left.chunk.rank - right.chunk.rank ||
          left.chunk.id.localeCompare(right.chunk.id, "en-US"),
      )[0];

    if (selected === undefined) {
      coverage.push({ requirementId: requirement.id, evidenceChunkId: null });
      uncoveredRequirementIds.push(requirement.id);
      continue;
    }
    claimed.add(selected.chunk.id);
    coverage.push({ requirementId: requirement.id, evidenceChunkId: selected.chunk.id });
    achievements.push({
      evidenceChunkId: selected.chunk.id,
      sourceId: selected.chunk.sourceId,
      requirementIds: [requirement.id],
    });
  }

  return Object.freeze({
    status: achievements.length === 0 ? "no-evidence" : "ready",
    coverage: Object.freeze(coverage.map((item) => Object.freeze(item))),
    achievements: Object.freeze(
      achievements.map((item) =>
        Object.freeze({ ...item, requirementIds: Object.freeze([...item.requirementIds]) }),
      ),
    ),
    uncoveredRequirementIds: Object.freeze(uncoveredRequirementIds),
  });
}
