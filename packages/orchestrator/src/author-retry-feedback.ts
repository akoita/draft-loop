export const authorRetryCorrectionKinds = [
  "factual-claim-text",
  "invalid-evidence-reference",
  "uncovered-substantive-text",
] as const;

export type AuthorRetryCorrectionKind = (typeof authorRetryCorrectionKinds)[number];

export interface AuthorRetryCorrection {
  readonly kind: AuthorRetryCorrectionKind;
  readonly path: string;
  readonly instruction: string;
}

interface RetryDiagnostic {
  readonly code: string;
  readonly path: string;
}

const safePathPattern = /^[A-Za-z0-9_.-]{0,160}$/u;

function correction(diagnostic: RetryDiagnostic): AuthorRetryCorrection | undefined {
  if (!safePathPattern.test(diagnostic.path)) return undefined;
  if (
    diagnostic.code === "factual_invariant_violation" &&
    /^sections\.\d+\.blocks\.\d+\.claims\.\d+\.text$/u.test(diagnostic.path)
  ) {
    return {
      kind: "factual-claim-text",
      path: diagnostic.path,
      instruction:
        "Use only factual text supported by cited evidence at this claim path, or omit it.",
    };
  }
  if (
    diagnostic.code === "custom" &&
    /^sections\.\d+\.blocks\.\d+\.claims\.\d+\.evidenceChunkIds\.\d+$/u.test(diagnostic.path)
  ) {
    return {
      kind: "invalid-evidence-reference",
      path: diagnostic.path,
      instruction:
        "Replace this reference with an approved retrievedEvidence ID that supports the claim, or omit the claim.",
    };
  }
  if (
    diagnostic.code === "substantive_text_uncovered" &&
    /^sections\.\d+\.blocks\.\d+\.text$/u.test(diagnostic.path)
  ) {
    return {
      kind: "uncovered-substantive-text",
      path: diagnostic.path,
      instruction:
        "Cover supported block text with contiguous substantive claims, or remove unsupported text.",
    };
  }
  return undefined;
}

/** Convert allowlisted content-free diagnostics into fixed, path-scoped retry instructions. */
export function buildAuthorRetryCorrections(
  diagnostics: readonly RetryDiagnostic[],
): readonly AuthorRetryCorrection[] {
  return diagnostics.slice(0, 8).flatMap((diagnostic) => {
    const value = correction(diagnostic);
    return value === undefined ? [] : [value];
  });
}
