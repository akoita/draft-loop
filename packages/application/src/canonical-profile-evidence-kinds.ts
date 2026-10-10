import type { CanonicalCandidateProfileSourceEvidenceKind } from "@draft-loop/domain";
import type { CandidateEvidenceKind } from "@draft-loop/domain/candidate-evidence-kind";
import { detectCandidateEvidenceKind } from "@draft-loop/ingestion";
import type { CanonicalCandidateProfileProvenanceReference } from "@draft-loop/schemas";

import { referenceKey } from "./canonical-profile-fact-keys.js";

/**
 * Evidence kinds guide canonical profile extraction per source. A source's effective kind is the
 * user's override when one is set, otherwise the kind detected locally from its normalized text,
 * so extraction uses the same kind the CLI and desktop show for the source.
 */

/** Kind-specific extraction guidance; the never-invent and exact-quote rules stay unchanged. */
export const canonicalProfileEvidenceKindInstructions = [
  "Each supplied source carries evidenceKind, the kind of career material it is, detected locally or chosen by the candidate. Use it only to interpret that source; it is not source text, so never quote it or take a fact value from it.",
  "For a performance-review source, outcomes judged by others belong to the reviewer's assessment: keep the reviewer's attribution in the fact's quote and value, and never restate the judgement as the candidate's own claim.",
  "For a notes source, the text is fragmentary: extract only explicit statements, and never complete a fragment or infer what it implies.",
  "For a linkedin-export source, the layout is fixed: map its experience, education, licenses and certifications, skills, and languages sections to role, employer, date, education, certification, skill, and language entries, and ignore page headers, footers, and page numbers.",
  "For a transcript source, only the candidate's own turns are evidence: never extract facts from an interviewer's or another speaker's turns.",
  "For a cv or other source, apply the general rules.",
  "Every kind keeps the same rules: never invent facts, and every evidence quote is exact contiguous source text.",
].join(" ");

export interface EffectiveEvidenceKindInput {
  readonly text: string;
  readonly mediaType: string;
  readonly displayName?: string;
  readonly override?: CandidateEvidenceKind;
}

/** The kind extraction is guided by: the user's override, else local detection. */
export function effectiveCandidateEvidenceKind(
  input: EffectiveEvidenceKindInput,
): CandidateEvidenceKind {
  if (input.override !== undefined) return input.override;
  return detectCandidateEvidenceKind({
    text: input.text,
    mediaType: input.mediaType,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
  }).kind;
}

interface KindedMaterial {
  readonly reference: CanonicalCandidateProfileProvenanceReference;
  readonly evidenceKind?: CandidateEvidenceKind;
}

/** The per-version kinds a profile version records, in reference order. */
export function recordedCanonicalProfileEvidenceKinds(
  materials: readonly KindedMaterial[],
): CanonicalCandidateProfileSourceEvidenceKind[] {
  const byKey = new Map<string, CanonicalCandidateProfileSourceEvidenceKind>();
  for (const { reference, evidenceKind } of materials) {
    if (evidenceKind === undefined) continue;
    byKey.set(referenceKey(reference), {
      storeId: reference.storeId,
      knowledgeBaseId: reference.knowledgeBaseId,
      sourceId: reference.sourceId,
      versionId: reference.versionId,
      kind: evidenceKind,
    });
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, entry]) => entry);
}

/**
 * Whether a material was extracted under a different kind than it has now. A version recorded
 * without kinds cannot vouch for any material that has one.
 */
export function evidenceKindChangedSince(
  previous: readonly CanonicalCandidateProfileSourceEvidenceKind[] | undefined,
): (material: KindedMaterial) => boolean {
  const recorded = new Map(
    (previous ?? []).map((entry) => [
      referenceKey({ ...entry, kind: "candidate-provided" }),
      entry.kind,
    ]),
  );
  return (material) =>
    material.evidenceKind !== undefined &&
    recorded.get(referenceKey(material.reference)) !== material.evidenceKind;
}
