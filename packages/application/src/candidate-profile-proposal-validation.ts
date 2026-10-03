import {
  type CanonicalCandidateProfileExtractionProposal,
  canonicalCandidateProfileExtractionProposalSchema,
} from "@draft-loop/schemas";

export const candidateProfileProposalDiagnosticCodes = {
  invalid_type: "profile_output_invalid_type",
  too_big: "profile_output_too_big",
  too_small: "profile_output_too_small",
  invalid_value: "profile_output_invalid_value",
  unrecognized_keys: "profile_output_unrecognized_keys",
  invalid_format: "profile_output_invalid_format",
  invalid_union: "profile_output_invalid_union",
} as const;

export type CandidateProfileProposalDiagnosticCode =
  | (typeof candidateProfileProposalDiagnosticCodes)[keyof typeof candidateProfileProposalDiagnosticCodes]
  | "profile_output_constraint"
  | "profile_duplicate_evidence"
  | "profile_duplicate_fact_keys"
  | "profile_duplicate_issue_facts"
  | "profile_unknown_issue_facts"
  | "profile_duplicate_issue_sources"
  | "profile_unpaired_conflicts";

export interface CandidateProfileProposalDiagnosticCount {
  readonly code: CandidateProfileProposalDiagnosticCode;
  readonly count: number;
}

const repairableMessages = new Set([
  "evidence must contain unique sourceId/quote tuples",
  "factKeys must contain unique fact keys",
  "sourceIds must contain unique source ids",
]);

const customDiagnosticCodes = new Map<string, CandidateProfileProposalDiagnosticCode>([
  ["evidence must contain unique sourceId/quote tuples", "profile_duplicate_evidence"],
  ["fact keys must be unique", "profile_duplicate_fact_keys"],
  ["factKeys must contain unique fact keys", "profile_duplicate_issue_facts"],
  ["factKeys must reference proposal facts", "profile_unknown_issue_facts"],
  ["sourceIds must contain unique source ids", "profile_duplicate_issue_sources"],
  ["conflict and duplicate issues require at least two fact keys", "profile_unpaired_conflicts"],
]);

export class CandidateProfileProposalValidationError extends Error {
  readonly diagnosticCounts: readonly CandidateProfileProposalDiagnosticCount[];

  constructor(diagnosticCounts: readonly CandidateProfileProposalDiagnosticCount[]) {
    super("The canonical profile proposal failed local validation.");
    this.name = "CandidateProfileProposalValidationError";
    this.diagnosticCounts = Object.freeze(
      diagnosticCounts.map((count) => Object.freeze({ ...count })),
    );
  }
}

/** Summarize only fixed Zod/custom codes from top-level issues. */
export function summarizeCandidateProfileProposalIssues(
  issues: readonly { readonly code: string; readonly message: string }[],
): readonly CandidateProfileProposalDiagnosticCount[] {
  const counts = new Map<CandidateProfileProposalDiagnosticCode, number>();
  for (const issue of issues) {
    const code =
      issue.code === "custom"
        ? (customDiagnosticCodes.get(issue.message) ?? "profile_output_constraint")
        : Object.hasOwn(candidateProfileProposalDiagnosticCodes, issue.code)
          ? candidateProfileProposalDiagnosticCodes[
              issue.code as keyof typeof candidateProfileProposalDiagnosticCodes
            ]
          : "profile_output_constraint";
    const count = counts.get(code) ?? 0;
    counts.set(code, count < Number.MAX_SAFE_INTEGER ? count + 1 : count);
  }
  return [...counts].map(([code, count]) => ({ code, count }));
}

function uniqueByTrimmedIdentity<T>(values: readonly T[], identity: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = identity(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function proposalWithRedundantListsRemoved(
  proposal: CanonicalCandidateProfileExtractionProposal,
): CanonicalCandidateProfileExtractionProposal {
  return {
    ...proposal,
    facts: proposal.facts.map((fact) => ({
      ...fact,
      evidence: uniqueByTrimmedIdentity(
        fact.evidence.map((evidence) => ({ ...evidence })),
        (evidence) => JSON.stringify([evidence.sourceId.trim(), evidence.quote.trim()]),
      ),
    })),
    issues: proposal.issues.map((issue) => ({
      ...issue,
      factKeys: uniqueByTrimmedIdentity(issue.factKeys, (key) => key.trim()),
      sourceIds: uniqueByTrimmedIdentity(issue.sourceIds, (sourceId) => sourceId.trim()),
    })),
  };
}

function validationError(
  issues: readonly { readonly code: string; readonly message: string }[],
): CandidateProfileProposalValidationError {
  return new CandidateProfileProposalValidationError(
    summarizeCandidateProfileProposalIssues(issues),
  );
}

/** Normalize only provably redundant citation references, then revalidate strictly. */
export function parseCanonicalCandidateProfileExtractionProposal(
  output: unknown,
): CanonicalCandidateProfileExtractionProposal {
  const parsed = canonicalCandidateProfileExtractionProposalSchema.safeParse(output);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues;
  if (
    issues.length === 0 ||
    issues.some((issue) => issue.code !== "custom" || !repairableMessages.has(issue.message))
  ) {
    throw validationError(issues);
  }

  const repaired = proposalWithRedundantListsRemoved(
    output as CanonicalCandidateProfileExtractionProposal,
  );
  const revalidated = canonicalCandidateProfileExtractionProposalSchema.safeParse(repaired);
  if (!revalidated.success) throw validationError(revalidated.error.issues);
  return revalidated.data;
}
