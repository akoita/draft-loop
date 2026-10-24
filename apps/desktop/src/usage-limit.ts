import type { UsageLimitView } from "@draft-loop/ui/model";

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
  const resetMs = usageLimit.resetsAt === null ? Number.NaN : Date.parse(usageLimit.resetsAt);
  const when = Number.isFinite(resetMs)
    ? new Date(resetMs).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        ...(timeZone === undefined ? {} : { timeZone }),
      })
    : "later";
  return `Usage limit reached on ${providerName(usageLimit.provider)} · try again after ${when}`;
}
