import { ProviderAdapterError, type ProviderValidationDiagnostic } from "./index.js";

/**
 * A subscription usage limit is distinct from API-credit `quota-exhausted`: the person's
 * Claude or ChatGPT plan has no allowance left until a window resets, so the run waits
 * instead of failing. The CLIs report it in free text, so recognition is deliberately
 * conservative and matches only these indicators (lowercase):
 *
 * - `usage limit` (Claude "usage limit reached", Codex "hit your usage limit")
 * - `weekly limit`
 * - `5-hour limit` / `five-hour limit` (Claude "5-hour limit reached")
 * - `hit your limit` (Claude "You've hit your limit")
 *
 * API-credit wording (`insufficient_quota`, `quota exceeded`, `quota exhausted`) is never a
 * usage limit.
 */
const usageLimitIndicators = [
  "usage limit",
  "weekly limit",
  "5-hour limit",
  "five-hour limit",
  "hit your limit",
] as const;

const apiCreditIndicators = ["insufficient_quota", "quota exceeded", "quota exhausted"] as const;

/** The furthest-ahead reset time accepted; anything later is not a plan window. */
const maxResetHorizonMs = 31 * 24 * 60 * 60 * 1000;

export const usageLimitDiagnosticCode = "usage_limit_reached" as const;

export const usageLimitMessage = "The subscription usage limit was reached.";

/** Whether failure text from a user-session CLI reports a subscription usage limit. */
export function isUsageLimitText(text: string): boolean {
  const details = text.toLowerCase();
  if (apiCreditIndicators.some((indicator) => details.includes(indicator))) return false;
  return usageLimitIndicators.some((indicator) => details.includes(indicator));
}

/**
 * The reset time a CLI reports, as an ISO timestamp, or `undefined`.
 *
 * Only the Claude CLI's structured `limit reached|<epoch seconds>` suffix is read. The value
 * must be ten digits and fall after `nowMs` and within 31 days; free-text times such as
 * "resets 3pm" or "try again at ..." carry no zone or date and are never parsed.
 */
export function usageLimitResetsAt(text: string, nowMs = Date.now()): string | undefined {
  const match = /limit reached\|(\d{10})(?!\d)/iu.exec(text);
  if (match?.[1] === undefined) return undefined;
  const resetMs = Number(match[1]) * 1000;
  if (!Number.isSafeInteger(resetMs) || resetMs <= nowMs || resetMs > nowMs + maxResetHorizonMs) {
    return undefined;
  }
  return new Date(resetMs).toISOString();
}

/** The provider error for a recognised usage limit; the CLI text never reaches the message. */
export function usageLimitError(
  provider: "anthropic" | "openai",
  text: string,
  extra: {
    readonly status?: number;
    readonly diagnostics?: readonly ProviderValidationDiagnostic[];
  } = {},
): ProviderAdapterError {
  const resetsAt = usageLimitResetsAt(text);
  return new ProviderAdapterError(provider, "usage-limit", usageLimitMessage, {
    retryable: false,
    ...(extra.status === undefined ? {} : { status: extra.status }),
    diagnostics: [...(extra.diagnostics ?? []), { code: usageLimitDiagnosticCode, path: "output" }],
    ...(resetsAt === undefined ? {} : { usageLimitResetsAt: resetsAt }),
  });
}
