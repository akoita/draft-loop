/**
 * Content-free cause classification for status-less Claude `api_error` results.
 *
 * Only fixed diagnostic codes are ever returned; no text from the provider
 * result is copied into the output.
 */

export interface ClaudeApiErrorCauseDiagnostic {
  readonly code: string;
  readonly path: string;
}

const maximumScannedCharacters = 4_096;
const maximumCauseDiagnostics = 4;

const statusPattern = /\bAPI Error:\s*([1-5]\d{2})\b/u;

const allowlistedErrorTypes = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "request_too_large",
  "rate_limit_error",
  "overloaded_error",
  "api_error",
  "timeout_error",
] as const;

const errorTypePatterns = allowlistedErrorTypes.map(
  (token) => [token, new RegExp(`(?<![A-Za-z0-9_])${token}(?![A-Za-z0-9_])`, "u")] as const,
);

export function claudeApiErrorCauseDiagnostics(
  result: unknown,
): readonly ClaudeApiErrorCauseDiagnostic[] {
  if (typeof result !== "string") return [];
  const text = result.slice(0, maximumScannedCharacters);
  const codes: string[] = [];

  const status = statusPattern.exec(text)?.[1];
  if (status !== undefined) codes.push(`claude_api_error_status_${status}`);

  for (const [token, pattern] of errorTypePatterns) {
    if (pattern.test(text)) codes.push(`claude_api_error_type_${token}`);
  }

  return [...new Set(codes)]
    .slice(0, maximumCauseDiagnostics)
    .map((code) => ({ code, path: "result" }));
}
