import {
  type ApplicationMaterialFact,
  type ApplicationMaterialRequirement,
  applicationMaterialFactScorer,
  applicationMaterialFactText,
} from "./application-material.js";
import { careerFrameCategories, grouped } from "./career-frame-facts.js";

/**
 * The facts a free-form cover letter is written from (#2584): a short list the writer can tell as
 * one story, not the whole record. Pure and local, so it costs nothing and is tested without a
 * model. The claim checker (#2585) later holds every sentence to these facts.
 */

export const coverLetterFactBounds = {
  minimum: 8,
  maximum: 12,
  perGroup: 4,
  career: 3,
  frame: 6,
} as const;

/** The groups that are a role in the career: they hold a title, an employer or dates. */
function careerGroups(facts: readonly ApplicationMaterialFact[]): Set<string> {
  return new Set(
    facts
      .filter((fact) => grouped(fact) && careerFrameCategories.has(fact.category))
      .map((fact) => fact.subjectId as string),
  );
}

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
 * fills more than four places, so one long role cannot crowd out the rest. Facts that match no
 * requirement only fill the list up to eight, roles and projects first, in the record's order.
 *
 * A letter built only on loose notes cannot say where the work was done (#2638). So at least three
 * places go to facts from career roles, groups with a title, an employer or dates, when the record
 * has them; and each picked role's title, employer and dates are added, up to six more facts.
 */
export function pickCoverLetterFacts(
  facts: readonly ApplicationMaterialFact[],
  requirements: readonly Pick<ApplicationMaterialRequirement, "text" | "priority">[],
  bounds: {
    readonly minimum: number;
    readonly maximum: number;
    readonly perGroup: number;
    readonly career?: number;
    readonly frame?: number;
  } = coverLetterFactBounds,
): PickedCoverLetterFact[] {
  const score = applicationMaterialFactScorer(requirements);
  const roles = careerGroups(facts);
  const inRole = (fact: ApplicationMaterialFact) =>
    grouped(fact) && roles.has(fact.subjectId as string);
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
  const roomIn = (entry: (typeof ranked)[number]) =>
    !grouped(entry.fact) || (perGroup.get(entry.fact.subjectId as string) ?? 0) < bounds.perGroup;
  const take = (entry: (typeof ranked)[number]) => {
    if (!roomIn(entry)) return;
    const group = entry.fact.subjectId;
    if (group !== undefined && group !== "") perGroup.set(group, (perGroup.get(group) ?? 0) + 1);
    picked.push(entry);
  };
  for (const entry of ranked) {
    if (picked.length >= bounds.maximum) break;
    if (entry.score > 0) take(entry);
  }
  // Places for the career: the best facts from roles take the lowest-ranked loose places.
  for (const entry of ranked) {
    if (picked.filter((each) => inRole(each.fact)).length >= (bounds.career ?? 0)) break;
    if (!inRole(entry.fact) || picked.includes(entry) || !roomIn(entry)) continue;
    if (careerFrameCategories.has(entry.fact.category)) continue;
    if (picked.length >= bounds.maximum) {
      const loose = picked.findLastIndex((each) => !inRole(each.fact));
      if (loose === -1) break;
      picked.splice(loose, 1);
    }
    take(entry);
  }
  for (const entry of ranked) {
    if (picked.length >= bounds.minimum) break;
    if (entry.score === 0) take(entry);
  }
  // Where and when: the title, employer and dates of each picked role.
  const pickedRoles = new Set(
    picked.filter((each) => inRole(each.fact)).map((each) => each.fact.subjectId as string),
  );
  let framed = 0;
  for (const entry of [...ranked].sort((left, right) => left.index - right.index)) {
    if (framed >= (bounds.frame ?? 0)) break;
    if (picked.includes(entry) || !careerFrameCategories.has(entry.fact.category)) continue;
    if (!grouped(entry.fact) || !pickedRoles.has(entry.fact.subjectId as string)) continue;
    picked.push(entry);
    framed += 1;
  }
  return picked.map(({ fact, score: matched }) => ({
    id: fact.id,
    brief: applicationMaterialFactText(fact),
    ...(grouped(fact) ? { group: fact.subjectId as string } : {}),
    score: matched,
  }));
}
