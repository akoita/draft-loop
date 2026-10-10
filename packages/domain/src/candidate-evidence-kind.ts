/**
 * Evidence kinds name the shape of a normalized career source so extraction can
 * be guided by what the material is, not by its file format. This module is
 * pure and provider independent; detection and persistence live elsewhere.
 */

export const candidateEvidenceKinds = [
  /** A curriculum vitae or resume written by the candidate. */
  "cv",
  /** A profile exported from LinkedIn, typically its PDF layout. */
  "linkedin-export",
  /** A performance review, self-assessment, or manager feedback document. */
  "performance-review",
  /** Informal, fragmentary notes written by or for the candidate. */
  "notes",
  /** A speaker-labelled or timestamped transcript of a conversation. */
  "transcript",
  /** Anything else, including material that cannot be named with confidence. */
  "other",
] as const;

export type CandidateEvidenceKind = (typeof candidateEvidenceKinds)[number];

export function isCandidateEvidenceKind(value: unknown): value is CandidateEvidenceKind {
  return typeof value === "string" && (candidateEvidenceKinds as readonly string[]).includes(value);
}
