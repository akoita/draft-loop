import { t } from "@lingui/core/macro";
import { formatDateTime } from "./locale-format.js";
import type { UsageLimitView } from "./model.js";

const providerNames: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

/** The provider as a person reads it: the known companies by name, anything else as given. */
function providerName(provider: string): string {
  return providerNames[provider.toLowerCase()] ?? provider;
}

/**
 * The paused-run line for a subscription usage limit. The reset time is shown only when the
 * provider reported a valid one; otherwise the person is told to try again "later".
 */
export function usageLimitText(
  usageLimit: Pick<UsageLimitView, "provider" | "resetsAt">,
  timeZone?: string,
): string {
  const when =
    (usageLimit.resetsAt === null
      ? undefined
      : formatDateTime(usageLimit.resetsAt, timeZone === undefined ? {} : { timeZone })) ?? "later";
  return t`Usage limit reached on ${providerName(usageLimit.provider)} · try again after ${when}`;
}
