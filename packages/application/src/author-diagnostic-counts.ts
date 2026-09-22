import type { ProviderDiagnosticCount } from "@draft-loop/providers";

const diagnosticCodePattern = /^[A-Za-z0-9_-]{1,64}$/u;

/** Maximum number of distinct diagnostic codes recorded for one rejection. */
export const maxDiagnosticCountCodes = 32;

/** Largest count recorded for one code; larger counts are clamped. */
export const maxDiagnosticCount = 100_000;

/** Return the validation issues carried by a proposal error, or an empty list. */
export function proposalIssues(error: unknown): readonly unknown[] {
  if (typeof error !== "object" || error === null || !("issues" in error)) return [];
  const issues = (error as { readonly issues?: unknown }).issues;
  return Array.isArray(issues) ? issues : [];
}

/**
 * Derive the content-free code of one proposal issue: the factual invariant
 * code when present, otherwise the schema issue code, truncated to 64 characters.
 */
export function proposalIssueCode(issue: unknown): string | undefined {
  if (typeof issue !== "object" || issue === null) return undefined;
  const candidate = issue as {
    readonly code?: unknown;
    readonly params?: { readonly invariantCode?: unknown };
  };
  const issueCode =
    typeof candidate.params?.invariantCode === "string"
      ? candidate.params.invariantCode
      : typeof candidate.code === "string"
        ? candidate.code
        : undefined;
  return issueCode?.slice(0, 64);
}

/**
 * Count every issue of a rejected proposal by code. Unlike the capped
 * diagnostics list, this walks all issues so the true size of a rejection is
 * known. Only safe codes are counted, each count is clamped at 100,000, and at
 * most 32 entries are kept: highest counts first, ties broken by code order.
 * Codes are entry values, never object keys, so storage key filters never apply.
 */
export function proposalDiagnosticCounts(error: unknown): readonly ProviderDiagnosticCount[] {
  const counts = new Map<string, number>();
  for (const issue of proposalIssues(error)) {
    const code = proposalIssueCode(issue);
    if (code === undefined || !diagnosticCodePattern.test(code)) continue;
    counts.set(code, Math.min(maxDiagnosticCount, (counts.get(code) ?? 0) + 1));
  }
  return Object.freeze(
    [...counts.entries()]
      .map(([code, count]) => Object.freeze({ code, count }))
      .sort((left, right) =>
        left.count !== right.count
          ? right.count - left.count
          : left.code < right.code
            ? -1
            : left.code > right.code
              ? 1
              : 0,
      )
      .slice(0, maxDiagnosticCountCodes),
  );
}
