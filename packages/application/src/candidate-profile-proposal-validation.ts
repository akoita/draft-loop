import {
  type CanonicalCandidateProfileExtractionProposal,
  canonicalCandidateProfileExtractionProposalSchema,
} from "@draft-loop/schemas";
import { recoverUnreferencedDuplicateFactKeys } from "./candidate-profile-fact-key-recovery.js";

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
  | "profile_too_many_facts"
  | "profile_too_many_issues"
  | "profile_fact_value_too_long"
  | "profile_evidence_quote_too_long"
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
  "fact keys must be unique",
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

interface ProposalIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: readonly PropertyKey[];
}

/** Name the oversized part from the issue path shape only; values and indexes are never kept. */
function oversizedDiagnosticCode(
  path: readonly PropertyKey[] | undefined,
): CandidateProfileProposalDiagnosticCode {
  const shape = (path ?? []).map((segment) =>
    typeof segment === "number" ? "#" : typeof segment === "string" ? segment : "?",
  );
  switch (shape.join(".")) {
    case "facts":
      return "profile_too_many_facts";
    case "issues":
      return "profile_too_many_issues";
    case "facts.#.value":
      return "profile_fact_value_too_long";
    case "facts.#.evidence.#.quote":
      return "profile_evidence_quote_too_long";
    default:
      return candidateProfileProposalDiagnosticCodes.too_big;
  }
}

function diagnosticCode(issue: ProposalIssue): CandidateProfileProposalDiagnosticCode {
  if (issue.code === "custom") {
    return customDiagnosticCodes.get(issue.message) ?? "profile_output_constraint";
  }
  if (issue.code === "too_big") return oversizedDiagnosticCode(issue.path);
  return Object.hasOwn(candidateProfileProposalDiagnosticCodes, issue.code)
    ? candidateProfileProposalDiagnosticCodes[
        issue.code as keyof typeof candidateProfileProposalDiagnosticCodes
      ]
    : "profile_output_constraint";
}

/** Summarize only fixed Zod/custom codes from top-level issues. */
export function summarizeCandidateProfileProposalIssues(
  issues: readonly ProposalIssue[],
): readonly CandidateProfileProposalDiagnosticCount[] {
  const counts = new Map<CandidateProfileProposalDiagnosticCode, number>();
  for (const issue of issues) {
    const code = diagnosticCode(issue);
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

function proposalWithRepairableReferencesRemoved(
  proposal: CanonicalCandidateProfileExtractionProposal,
  danglingOmissionFactKeys: ReadonlyMap<number, ReadonlySet<number>> = new Map(),
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
    issues: proposal.issues.map((issue, issueIndex) => ({
      ...issue,
      factKeys: uniqueByTrimmedIdentity(
        issue.factKeys.filter(
          (_key, factKeyIndex) => !danglingOmissionFactKeys.get(issueIndex)?.has(factKeyIndex),
        ),
        (key) => key.trim(),
      ),
      sourceIds: uniqueByTrimmedIdentity(issue.sourceIds, (sourceId) => sourceId.trim()),
    })),
  };
}

function omissionFactKeyReferenceToRemove(
  issue: { readonly code: string; readonly path: readonly PropertyKey[] },
  output: unknown,
): { readonly issueIndex: number; readonly factKeyIndex: number } | null {
  if (
    issue.code !== "custom" ||
    !("message" in issue) ||
    issue.message !== "factKeys must reference proposal facts" ||
    issue.path.length !== 4
  ) {
    return null;
  }

  const [issuesKey, issueIndex, factKeysKey, factKeyIndex] = issue.path;
  if (
    issuesKey !== "issues" ||
    typeof issueIndex !== "number" ||
    !Number.isSafeInteger(issueIndex) ||
    issueIndex < 0 ||
    factKeysKey !== "factKeys" ||
    typeof factKeyIndex !== "number" ||
    !Number.isSafeInteger(factKeyIndex) ||
    factKeyIndex < 0
  ) {
    return null;
  }

  const proposalIssues =
    typeof output === "object" && output !== null && !Array.isArray(output)
      ? (output as { readonly issues?: unknown }).issues
      : undefined;
  if (!Array.isArray(proposalIssues)) return null;
  const candidate = proposalIssues[issueIndex];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const candidateIssue = candidate as {
    readonly code?: unknown;
    readonly sourceIds?: unknown;
    readonly factKeys?: unknown;
  };
  if (
    candidateIssue.code !== "omission" ||
    !Array.isArray(candidateIssue.sourceIds) ||
    candidateIssue.sourceIds.length === 0 ||
    !Array.isArray(candidateIssue.factKeys) ||
    factKeyIndex >= candidateIssue.factKeys.length
  ) {
    return null;
  }
  return { issueIndex, factKeyIndex };
}

function validationError(
  issues: readonly ProposalIssue[],
): CandidateProfileProposalValidationError {
  return new CandidateProfileProposalValidationError(
    summarizeCandidateProfileProposalIssues(issues),
  );
}

/** Normalize safe duplicate keys and references, then revalidate strictly. */
export function parseCanonicalCandidateProfileExtractionProposal(
  output: unknown,
): CanonicalCandidateProfileExtractionProposal {
  const parsed = canonicalCandidateProfileExtractionProposalSchema.safeParse(output);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues;
  const danglingOmissionFactKeys = new Map<number, Set<number>>();
  const canRepair =
    issues.length > 0 &&
    issues.every((issue) => {
      if (issue.code === "custom" && repairableMessages.has(issue.message)) return true;
      const dangling = omissionFactKeyReferenceToRemove(issue, output);
      if (dangling === null) return false;
      const indexes = danglingOmissionFactKeys.get(dangling.issueIndex) ?? new Set<number>();
      indexes.add(dangling.factKeyIndex);
      danglingOmissionFactKeys.set(dangling.issueIndex, indexes);
      return true;
    });
  if (!canRepair) {
    throw validationError(issues);
  }

  let proposal = output as CanonicalCandidateProfileExtractionProposal;
  if (
    issues.some((issue) => issue.code === "custom" && issue.message === "fact keys must be unique")
  ) {
    const recovered = recoverUnreferencedDuplicateFactKeys(proposal);
    if (recovered === undefined) throw validationError(issues);
    proposal = recovered;
  }

  const repaired = proposalWithRepairableReferencesRemoved(proposal, danglingOmissionFactKeys);
  const revalidated = canonicalCandidateProfileExtractionProposalSchema.safeParse(repaired);
  if (!revalidated.success) throw validationError(revalidated.error.issues);
  return revalidated.data;
}
