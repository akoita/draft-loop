export const deepInfraOutputDiagnosticCodes = {
  invalid_type: "profile_output_invalid_type",
  too_big: "profile_output_too_big",
  too_small: "profile_output_too_small",
  invalid_value: "profile_output_invalid_value",
  unrecognized_keys: "profile_output_unrecognized_keys",
  invalid_format: "profile_output_invalid_format",
  invalid_union: "profile_output_invalid_union",
  custom: "profile_output_constraint",
} as const;

export type DeepInfraOutputDiagnosticCode =
  | (typeof deepInfraOutputDiagnosticCodes)[keyof typeof deepInfraOutputDiagnosticCodes]
  | "profile_output_constraint";

export interface DeepInfraOutputDiagnosticCount {
  readonly code: DeepInfraOutputDiagnosticCode;
  readonly count: number;
}

/** Summarize only top-level issue codes; never copy provider values or issue paths. */
export function summarizeDeepInfraOutputIssues(
  issues: readonly { readonly code: string }[],
): readonly DeepInfraOutputDiagnosticCount[] {
  const counts = new Map<DeepInfraOutputDiagnosticCode, number>();
  for (const issue of issues) {
    const code = Object.hasOwn(deepInfraOutputDiagnosticCodes, issue.code)
      ? deepInfraOutputDiagnosticCodes[issue.code as keyof typeof deepInfraOutputDiagnosticCodes]
      : "profile_output_constraint";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => ({ code, count }));
}
