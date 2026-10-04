import type {
  CanonicalCandidateProfileExtractionProposal,
  CanonicalCandidateProfileProvenanceReference,
} from "@draft-loop/schemas";
import { createCanonicalProfileEvidenceChecker } from "./candidate-profile-grounding-diagnostics.js";
import { parseCanonicalCandidateProfileExtractionProposal } from "./candidate-profile-proposal-validation.js";

export interface GroundedCanonicalProfileProposal {
  readonly proposal: CanonicalCandidateProfileExtractionProposal;
  /** Number of facts removed because at least one evidence item failed grounding. */
  readonly droppedFacts: number;
}

/**
 * Keep only facts whose every evidence item passes the same grounding rules the assertion uses.
 * Issues that cite a dropped fact or an unknown source are removed with them, so the result still
 * satisfies the proposal schema (an issue naming a dropped fact is never left with fewer fact keys).
 */
export function filterGroundedCanonicalProfileProposal(
  proposal: CanonicalCandidateProfileExtractionProposal,
  referencesByRepresentativeId: ReadonlyMap<
    string,
    readonly CanonicalCandidateProfileProvenanceReference[]
  >,
  sourceTexts: ReadonlyMap<string, string>,
): GroundedCanonicalProfileProposal {
  const checker = createCanonicalProfileEvidenceChecker(referencesByRepresentativeId, sourceTexts);
  const facts = proposal.facts.filter((fact) =>
    fact.evidence.every((evidence) => checker.evidenceFailures(fact.value, evidence).length === 0),
  );
  const keptKeys = new Set(facts.map((fact) => fact.key));
  const issues = proposal.issues.filter(
    (issue) =>
      issue.factKeys.every((key) => keptKeys.has(key)) &&
      issue.sourceIds.every((sourceId) => checker.sourceFailures(sourceId).length === 0),
  );
  const droppedFacts = proposal.facts.length - facts.length;
  if (droppedFacts === 0 && issues.length === proposal.issues.length) {
    return Object.freeze({ proposal, droppedFacts });
  }
  return Object.freeze({
    proposal: parseCanonicalCandidateProfileExtractionProposal({ ...proposal, facts, issues }),
    droppedFacts,
  });
}
