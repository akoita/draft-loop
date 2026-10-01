import type { CanonicalCandidateProfileFact } from "@draft-loop/domain";

/** Skills are collection values; only unscoped certifications are collections. */
export function isCandidateProfileCollectionFact(
  fact: Pick<CanonicalCandidateProfileFact, "category"> & {
    readonly subjectId?: string | undefined;
  },
): boolean {
  return (
    fact.category === "skill" || (fact.category === "certification" && fact.subjectId === undefined)
  );
}
