import type {
  CanonicalCandidateProfileReference,
  CanonicalCandidateProfileReferenceInput,
  ContextSnapshot,
  ContextSnapshotInput,
  OpportunityBriefReference,
  OpportunityBriefReferenceInput,
} from "./index.js";

/**
 * The optional fields a context snapshot binds to its run: the reviewed opportunity brief, the
 * reviewed candidate profile, and which requirements the relevance score counts.
 */
export type ContextSnapshotReferences = Pick<
  ContextSnapshot,
  "opportunityBriefReference" | "candidateProfileReference" | "scoredRequirementIds"
>;

function normalizeOpportunityBriefReference(
  reference: OpportunityBriefReferenceInput,
): OpportunityBriefReference {
  return {
    briefId: reference.briefId.trim(),
    version: reference.version,
    checksum: reference.checksum.toLowerCase(),
  };
}

function normalizeCanonicalCandidateProfileReference(
  reference: CanonicalCandidateProfileReferenceInput,
): CanonicalCandidateProfileReference {
  return {
    profileId: reference.profileId.trim(),
    version: reference.version,
    checksum: reference.checksum.toLowerCase(),
  };
}

/** The snapshot's reference fields, normalized; absent inputs stay absent. */
export function contextSnapshotReferences(input: ContextSnapshotInput): ContextSnapshotReferences {
  return {
    ...(input.opportunityBriefReference === undefined
      ? {}
      : {
          opportunityBriefReference: normalizeOpportunityBriefReference(
            input.opportunityBriefReference,
          ),
        }),
    ...(input.candidateProfileReference === undefined
      ? {}
      : {
          candidateProfileReference: normalizeCanonicalCandidateProfileReference(
            input.candidateProfileReference,
          ),
        }),
    ...(input.scoredRequirementIds === undefined
      ? {}
      : { scoredRequirementIds: input.scoredRequirementIds.map((id) => id.trim()) }),
  };
}
