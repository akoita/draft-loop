import type { ApplicationMaterialFact } from "./application-material.js";

/** The facts that say where and when work was done: a role's title, its employer and its dates. */
export const careerFrameCategories: ReadonlySet<string> = new Set(["role", "employer", "date"]);

export const grouped = (fact: Pick<ApplicationMaterialFact, "subjectId">) =>
  fact.subjectId !== undefined && fact.subjectId !== "";

/**
 * `ranked` cut to `maximum`, keeping the title, employer and dates of the roles among its first
 * `leading` facts (#2638): a framing fact shares few words with a job post, so ranking alone drops
 * it from a large record and the letter cannot say where the work was done. Each one kept takes
 * the place of the lowest-ranked other fact.
 */
export function keepCareerFrame<T extends ApplicationMaterialFact>(
  ranked: readonly T[],
  maximum: number,
  leading = 20,
): T[] {
  const kept = ranked.slice(0, maximum);
  const roles = new Set(
    kept
      .slice(0, leading)
      .filter(grouped)
      .map((fact) => fact.subjectId as string),
  );
  const isFrame = (fact: T) =>
    grouped(fact) &&
    careerFrameCategories.has(fact.category) &&
    roles.has(fact.subjectId as string);
  for (const fact of ranked.slice(maximum)) {
    if (!isFrame(fact)) continue;
    const last = kept.findLastIndex((other, index) => index >= leading && !isFrame(other));
    if (last === -1) break;
    kept.splice(last, 1);
    kept.push(fact);
  }
  return kept;
}

export const careerRecordGaps = ["employer", "dates"] as const;
export type CareerRecordGap = (typeof careerRecordGaps)[number];

/**
 * What a letter cannot say because the record does not hold it (#2725): a record built only from
 * work notes has achievements and skills but no employer and no dates. Named to the candidate with
 * the draft, so a letter with no employer in it is explained rather than taken for a fault.
 */
export function careerRecordGapsOf(
  facts: readonly Pick<ApplicationMaterialFact, "category">[],
): CareerRecordGap[] {
  const has = (category: string) => facts.some((fact) => fact.category === category);
  return [
    ...(has("employer") ? [] : (["employer"] as const)),
    ...(has("date") ? [] : (["dates"] as const)),
  ];
}
