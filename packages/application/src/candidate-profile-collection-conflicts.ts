import type { CanonicalCandidateProfileFact } from "@draft-loop/domain";

/** Skills and certifications may be multiple valid values unless explicitly grouped. */
export function isUnscopedCandidateProfileCollectionFact(
  fact: Pick<CanonicalCandidateProfileFact, "category"> & {
    readonly subjectId?: string | undefined;
  },
): boolean {
  return (
    fact.subjectId === undefined && (fact.category === "skill" || fact.category === "certification")
  );
}
