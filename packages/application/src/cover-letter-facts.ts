import {
  type ApplicationMaterialFact,
  type ApplicationMaterialRequirement,
  applicationMaterialFactScorer,
  applicationMaterialFactText,
} from "./application-material.js";

/**
 * The facts a free-form cover letter is written from (#2584): a short list the writer can tell as
 * one story, not the whole record. Pure and local, so it costs nothing and is tested without a
 * model. The claim checker (#2585) later holds every sentence to these facts.
 */

export const coverLetterFactBounds = { minimum: 8, maximum: 12, perGroup: 4 } as const;

export interface PickedCoverLetterFact {
  readonly id: string;
  /** The fact as one line, its category named once, for the writer to put in its own words. */
  readonly brief: string;
  /** The role or project it belongs to; facts that share one may be told together. */
  readonly group?: string;
  /** How well it matches the job's requirements; 0 when it shares no word with them. */
  readonly score: number;
}

/**
 * Up to twelve of the facts the caller already allowed to reach a model, best match to the job
 * first. A fact inside a role or project outranks a loose note of the same score, and no role
 * fills more than four places, so one long role cannot crowd out the rest. Facts that match no requirement only fill the list up to eight, roles and
 * projects first, in the record's order.
 */
export function pickCoverLetterFacts(
  facts: readonly ApplicationMaterialFact[],
  requirements: readonly Pick<ApplicationMaterialRequirement, "text" | "priority">[],
  bounds: {
    readonly minimum: number;
    readonly maximum: number;
    readonly perGroup: number;
  } = coverLetterFactBounds,
): PickedCoverLetterFact[] {
  const score = applicationMaterialFactScorer(requirements);
  const grouped = (fact: ApplicationMaterialFact) =>
    fact.subjectId !== undefined && fact.subjectId !== "";
  const ranked = facts
    .map((fact, index) => ({ fact, index, score: score(fact) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(grouped(right.fact)) - Number(grouped(left.fact)) ||
        left.index - right.index,
    );
  const perGroup = new Map<string, number>();
  const picked: (typeof ranked)[number][] = [];
  const take = (entry: (typeof ranked)[number]) => {
    const group = entry.fact.subjectId;
    if (group !== undefined && group !== "") {
      const count = perGroup.get(group) ?? 0;
      if (count >= bounds.perGroup) return;
      perGroup.set(group, count + 1);
    }
    picked.push(entry);
  };
  for (const entry of ranked) {
    if (picked.length >= bounds.maximum) break;
    if (entry.score > 0) take(entry);
  }
  for (const entry of ranked) {
    if (picked.length >= bounds.minimum) break;
    if (entry.score === 0) take(entry);
  }
  return picked.map(({ fact, score: matched }) => ({
    id: fact.id,
    brief: applicationMaterialFactText(fact),
    ...(grouped(fact) ? { group: fact.subjectId as string } : {}),
    score: matched,
  }));
}
