import type {
  CanonicalCandidateProfileExtractionProposal,
  CanonicalCandidateProfileProvenanceReference,
} from "@draft-loop/schemas";

import { createEvidenceSourceIndex, valueOccursInQuote } from "./evidence-text-normalization.js";

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

function addCount(
  counts: Map<CandidateProfileGroundingDiagnosticCode, number>,
  code: CandidateProfileGroundingDiagnosticCode,
) {
  counts.set(code, (counts.get(code) ?? 0) + 1);
}

type ProfileReferences = ReadonlyMap<
  string,
  readonly CanonicalCandidateProfileProvenanceReference[]
>;

/**
 * The single definition of evidence grounding, shared by the whole-proposal assertion and the
 * ungrounded-fact filter so the two cannot drift: a known source with references, a quote found in
 * that source's text, and a fact value found in its quote. Quote and value comparison tolerates
 * Markdown formatting and typographic punctuation but never paraphrase (see
 * `evidence-text-normalization.ts`).
 */
export function createCanonicalProfileEvidenceChecker(
  referencesByRepresentativeId: ProfileReferences,
  sourceTexts: ReadonlyMap<string, string>,
) {
  const sourceIndex = createEvidenceSourceIndex(sourceTexts);

  const sourceFailures = (sourceId: string): readonly CandidateProfileGroundingDiagnosticCode[] => {
    const references = referencesByRepresentativeId.get(sourceId);
    return references !== undefined && references.length > 0 && sourceTexts.has(sourceId)
      ? []
      : ["unknown_source"];
  };

  const evidenceFailures = (
    factValue: string,
    evidence: { readonly sourceId: string; readonly quote: string },
  ): readonly CandidateProfileGroundingDiagnosticCode[] => {
    const unknown = sourceFailures(evidence.sourceId);
    if (unknown.length > 0) return unknown;
    const failures: CandidateProfileGroundingDiagnosticCode[] = [];
    if (!sourceIndex.containsQuote(evidence.sourceId, evidence.quote)) {
      failures.push("quote_not_in_source");
    }
    if (!valueOccursInQuote(factValue, evidence.quote)) failures.push("value_not_in_quote");
    return failures;
  };

  return Object.freeze({ sourceFailures, evidenceFailures });
}

/** Reject the whole proposal while retaining only fixed evidence-failure counts. */
export function assertCanonicalProfileEvidenceGrounded(
  proposal: CanonicalCandidateProfileExtractionProposal,
  referencesByRepresentativeId: ProfileReferences,
  sourceTexts: ReadonlyMap<string, string>,
): void {
  const counts = new Map<CandidateProfileGroundingDiagnosticCode, number>();
  const checker = createCanonicalProfileEvidenceChecker(referencesByRepresentativeId, sourceTexts);

  for (const fact of proposal.facts) {
    for (const evidence of fact.evidence) {
      for (const code of checker.evidenceFailures(fact.value, evidence)) addCount(counts, code);
    }
  }

  for (const issue of proposal.issues) {
    for (const sourceId of issue.sourceIds) {
      for (const code of checker.sourceFailures(sourceId)) addCount(counts, code);
    }
  }

  if (counts.size > 0) {
    throw new CandidateProfileGroundingError([...counts].map(([code, count]) => ({ code, count })));
  }
}
