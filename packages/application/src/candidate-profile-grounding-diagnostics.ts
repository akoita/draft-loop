import type {
  CanonicalCandidateProfileExtractionProposal,
  CanonicalCandidateProfileProvenanceReference,
} from "@draft-loop/schemas";

export type CandidateProfileGroundingDiagnosticCode =
  | "unknown_source"
  | "quote_not_in_source"
  | "value_not_in_quote";

export interface CandidateProfileGroundingDiagnosticCount {
  readonly code: CandidateProfileGroundingDiagnosticCode;
  readonly count: number;
}

export class CandidateProfileGroundingError extends Error {
  readonly diagnosticCounts: readonly CandidateProfileGroundingDiagnosticCount[];

  constructor(diagnosticCounts: readonly CandidateProfileGroundingDiagnosticCount[]) {
    super("Candidate profile evidence failed local grounding checks.");
    this.name = "CandidateProfileGroundingError";
    this.diagnosticCounts = Object.freeze(
      diagnosticCounts.map((entry) => Object.freeze({ ...entry })),
    );
  }
}

function normalizedSemantic(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function addCount(
  counts: Map<CandidateProfileGroundingDiagnosticCode, number>,
  code: CandidateProfileGroundingDiagnosticCode,
) {
  counts.set(code, (counts.get(code) ?? 0) + 1);
}

/** Reject the whole proposal while retaining only fixed evidence-failure counts. */
export function assertCanonicalProfileEvidenceGrounded(
  proposal: CanonicalCandidateProfileExtractionProposal,
  referencesByRepresentativeId: ReadonlyMap<
    string,
    readonly CanonicalCandidateProfileProvenanceReference[]
  >,
  sourceTexts: ReadonlyMap<string, string>,
): void {
  const counts = new Map<CandidateProfileGroundingDiagnosticCode, number>();
  const normalizedSourceTexts = new Map(
    [...sourceTexts].map(([sourceId, text]) => [sourceId, normalizedSemantic(text)]),
  );

  const checkSource = (sourceId: string): boolean => {
    const references = referencesByRepresentativeId.get(sourceId);
    if (references !== undefined && references.length > 0 && normalizedSourceTexts.has(sourceId)) {
      return true;
    }
    addCount(counts, "unknown_source");
    return false;
  };

  for (const fact of proposal.facts) {
    const value = normalizedSemantic(fact.value);
    for (const evidence of fact.evidence) {
      if (!checkSource(evidence.sourceId)) continue;
      const quote = normalizedSemantic(evidence.quote);
      const sourceText = normalizedSourceTexts.get(evidence.sourceId) ?? "";
      if (quote.length === 0 || !sourceText.includes(quote)) {
        addCount(counts, "quote_not_in_source");
      }
      if (value.length === 0 || quote.length === 0 || !quote.includes(value)) {
        addCount(counts, "value_not_in_quote");
      }
    }
  }

  for (const issue of proposal.issues) {
    for (const sourceId of issue.sourceIds) checkSource(sourceId);
  }

  if (counts.size > 0) {
    throw new CandidateProfileGroundingError([...counts].map(([code, count]) => ({ code, count })));
  }
}
