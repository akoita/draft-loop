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
  return Object.freeze({ ...request, groundingRecovery });
}

/** Extract, strictly validate, and make one bounded full replacement after grounding failure. */
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
    const output = await port.extract(attemptRequest);
    throwIfAborted(attemptRequest.signal);
    setStage("response-schema");
    const proposal = repairCanonicalProfileEvidenceQuotes(
      parseCanonicalCandidateProfileExtractionProposal(output),
      sourceTexts,
    );
    return proposal;
  };

  const initialProposal = await extractProposal(request);
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
    if (!(error instanceof CandidateProfileGroundingError)) throw error;
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
