export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly message: string;
}

export interface ValidationResult {
  readonly issues: readonly ValidationIssue[];
  readonly valid: boolean;
}
