import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { ModelPricing, ProviderValidationDiagnostic } from "./index.js";

/**
 * The beta that makes a refusal carry a fallback credit token. Sent on the refused request and on
 * its retry, it lets the retry read the refused request's prompt cache at cache-read rates instead
 * of writing it again on the fallback model.
 */
export const fallbackCreditBeta = "fallback-credit-2026-07-01";

/**
 * The model a refused Claude call retries on once (#3120). The deployment names it, with its own
 * rates, so the retry is priced and counted against the same caps as the refused call. `allowed`
 * is read before the retry, so the model-call kill switch or a spent cap stops it.
 */
export interface AnthropicRefusalFallback {
  readonly modelId: string;
  readonly pricing: ModelPricing;
  readonly allowed?: () => boolean | Promise<boolean>;
}

/** A refusal a fallback model answered, recorded with the response so the switch is never silent. */
export interface RefusalFallbackRecord {
  readonly fromModel: string;
  /** The provider's refusal category, such as `cyber`; null when it named none. */
  readonly category: string | null;
  /** Whether the retry presented a fallback credit, so the cached prefix was not billed twice. */
  readonly credit: boolean;
}

export interface AnthropicRefusal {
  readonly category: string | null;
  readonly creditToken: string | null;
}

const categoryPattern = /^[a-z_]{1,40}$/u;

/** The refusal a Claude response reports, or undefined when it did not refuse. */
export function anthropicRefusal(value: unknown): AnthropicRefusal | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const response = value as { readonly stop_reason?: unknown; readonly stop_details?: unknown };
  if (response.stop_reason !== "refusal") return undefined;
  const details =
    typeof response.stop_details === "object" && response.stop_details !== null
      ? (response.stop_details as {
          readonly category?: unknown;
          readonly fallback_credit_token?: unknown;
        })
      : {};
  return {
    category:
      typeof details.category === "string" && categoryPattern.test(details.category)
        ? details.category
        : null,
    creditToken:
      typeof details.fallback_credit_token === "string" && details.fallback_credit_token !== ""
        ? details.fallback_credit_token
        : null,
  };
}

/**
 * The retry: the refused body unchanged but for the model, so the credit matches, with the credit
 * in best-effort mode so an expired or unmatched token still lets the fallback answer at full price.
 */
export function refusalFallbackParameters(
  parameters: MessageCreateParamsNonStreaming,
  fallbackModelId: string,
  refusal: AnthropicRefusal,
): MessageCreateParamsNonStreaming {
  return {
    ...parameters,
    model: fallbackModelId,
    ...(refusal.creditToken === null
      ? {}
      : { fallback_credit_token: { token: refusal.creditToken, mode: "best_effort" } }),
  } as MessageCreateParamsNonStreaming;
}

/** Content-free diagnostics for a refusal: its category, and whether a fallback also refused. */
export function refusalDiagnostics(
  refusal: AnthropicRefusal | undefined,
  fallbackRefused: boolean,
): readonly ProviderValidationDiagnostic[] {
  return [
    ...(refusal?.category == null
      ? []
      : [{ code: `refusal_category_${refusal.category}`, path: "stop_details.category" }]),
    ...(fallbackRefused ? [{ code: "refusal_fallback_refused", path: "stop_reason" }] : []),
  ];
}
