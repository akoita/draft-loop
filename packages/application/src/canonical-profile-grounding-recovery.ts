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
  const { groundProposal: _groundProposal, ...replacement } = request;
  return Object.freeze({ ...replacement, groundingRecovery });
}

/**
 * Extract and strictly validate. Planned (large) extractions ground and replace each bounded
 * call locally and never make a full-corpus replacement; other requests make one full replacement.
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
): Promise<CanonicalCandidateProfileExtractionProposal> {
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
  const planned = planCanonicalProfileExtractionCalls(request.sources) !== null;
  const initialProposal = await extractProposal(Object.freeze({ ...request, groundProposal }));
  setStage("grounding");
  try {
    assertCanonicalProfileEvidenceGrounded(
      initialProposal,
      referencesByRepresentativeId,
      sourceTexts,
    );
    return initialProposal;
  } catch (error) {
    throwIfAborted(request.signal);
    if (!(error instanceof CandidateProfileGroundingError) || planned) throw error;
    const replacementRequest = recoveryRequest(request, error);
    const replacementProposal = await extractProposal(replacementRequest);
    setStage("grounding");
    assertCanonicalProfileEvidenceGrounded(
      replacementProposal,
      referencesByRepresentativeId,
      sourceTexts,
    );
    return replacementProposal;
  }
}
