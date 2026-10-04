import type {
  CanonicalCandidateProfileExtractionProposal,
  CanonicalCandidateProfileProvenanceReference,
} from "@draft-loop/schemas";
import type {
  CanonicalCandidateProfileExtractionPort,
  CanonicalCandidateProfileExtractionRequest,
} from "./candidate-profile-extraction.js";
import type { CandidateProfileExtractionStage } from "./candidate-profile-extraction-errors.js";
import {
  assertCanonicalProfileEvidenceGrounded,
  type CandidateProfileGroundingDiagnosticCount,
  CandidateProfileGroundingError,
} from "./candidate-profile-grounding-diagnostics.js";
import { parseCanonicalCandidateProfileExtractionProposal } from "./candidate-profile-proposal-validation.js";
import { repairCanonicalProfileEvidenceQuotes } from "./canonical-profile-evidence-quotes.js";
import { planCanonicalProfileExtractionCalls } from "./canonical-profile-extraction-plan.js";
import { filterGroundedCanonicalProfileProposal } from "./canonical-profile-grounded-filter.js";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) signal.throwIfAborted();
}

function recoveryRequest(
  request: CanonicalCandidateProfileExtractionRequest,
  error: CandidateProfileGroundingError,
): CanonicalCandidateProfileExtractionRequest {
  const groundingRecovery: readonly CandidateProfileGroundingDiagnosticCount[] = Object.freeze(
    error.diagnosticCounts.map(({ code, count }) => Object.freeze({ code, count })),
  );
  const {
    groundProposal: _groundProposal,
    filterGroundedProposal: _filterGroundedProposal,
    ...replacement
  } = request;
  return Object.freeze({ ...replacement, groundingRecovery });
}

export interface GroundedCanonicalCandidateProfileProposal {
  readonly proposal: CanonicalCandidateProfileExtractionProposal;
  /** Facts removed because their evidence was still ungrounded after the replacement attempt. */
  readonly droppedFacts: number;
}

/**
 * Extract and strictly validate. Planned (large) extractions ground and replace each bounded
 * call locally and never make a full-corpus replacement; other requests make one full replacement.
 * A replacement that still fails grounding keeps its grounded facts and reports the dropped count.
 */
export async function extractGroundedCanonicalCandidateProfileProposal(
  port: CanonicalCandidateProfileExtractionPort,
  request: CanonicalCandidateProfileExtractionRequest,
  referencesByRepresentativeId: ReadonlyMap<
    string,
    readonly CanonicalCandidateProfileProvenanceReference[]
  >,
  sourceTexts: ReadonlyMap<string, string>,
  setStage: (stage: CandidateProfileExtractionStage) => void,
): Promise<GroundedCanonicalCandidateProfileProposal> {
  let droppedFacts = 0;
  const extractProposal = async (
    attemptRequest: CanonicalCandidateProfileExtractionRequest,
  ): Promise<CanonicalCandidateProfileExtractionProposal> => {
    throwIfAborted(attemptRequest.signal);
    setStage("provider");
    let output: unknown;
    try {
      output = await port.extract(attemptRequest);
    } catch (error) {
      if (error instanceof CandidateProfileGroundingError) setStage("grounding");
      throw error;
    }
    throwIfAborted(attemptRequest.signal);
    setStage("response-schema");
    const proposal = repairCanonicalProfileEvidenceQuotes(
      parseCanonicalCandidateProfileExtractionProposal(output),
      sourceTexts,
    );
    return proposal;
  };

  const groundProposal = (
    proposal: CanonicalCandidateProfileExtractionProposal,
  ): CanonicalCandidateProfileExtractionProposal => {
    const repaired = repairCanonicalProfileEvidenceQuotes(proposal, sourceTexts);
    assertCanonicalProfileEvidenceGrounded(repaired, referencesByRepresentativeId, sourceTexts);
    return repaired;
  };
  const filterProposal = (
    proposal: CanonicalCandidateProfileExtractionProposal,
  ): CanonicalCandidateProfileExtractionProposal => {
    const filtered = filterGroundedCanonicalProfileProposal(
      repairCanonicalProfileEvidenceQuotes(proposal, sourceTexts),
      referencesByRepresentativeId,
      sourceTexts,
    );
    droppedFacts += filtered.droppedFacts;
    return filtered.proposal;
  };
  const planned = planCanonicalProfileExtractionCalls(request.sources) !== null;
  const initialProposal = await extractProposal(
    Object.freeze({ ...request, groundProposal, filterGroundedProposal: filterProposal }),
  );
  setStage("grounding");
  try {
    assertCanonicalProfileEvidenceGrounded(
      initialProposal,
      referencesByRepresentativeId,
      sourceTexts,
    );
    return { proposal: initialProposal, droppedFacts };
  } catch (error) {
    throwIfAborted(request.signal);
    if (!(error instanceof CandidateProfileGroundingError) || planned) throw error;
    const replacementRequest = recoveryRequest(request, error);
    const replacementProposal = await extractProposal(replacementRequest);
    setStage("grounding");
    try {
      assertCanonicalProfileEvidenceGrounded(
        replacementProposal,
        referencesByRepresentativeId,
        sourceTexts,
      );
      return { proposal: replacementProposal, droppedFacts };
    } catch (replacementError) {
      throwIfAborted(request.signal);
      if (!(replacementError instanceof CandidateProfileGroundingError)) throw replacementError;
      return { proposal: filterProposal(replacementProposal), droppedFacts };
    }
  }
}
