import { t } from "@lingui/core/macro";

/** The public route the landing page's form posts to (#2566). */
export const waitlistUrl = "/v1/waitlist";

export type WaitlistOutcome = "listed" | "invalid" | "rate_limited" | "failed";

/**
 * Joins the beta waitlist without a credential. A new and an already-listed email both answer
 * `listed`: the API does not say which.
 */
export async function joinWaitlist(
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WaitlistOutcome> {
  try {
    const response = await fetchImpl(waitlistUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), consent: true }),
    });
    if (response.status === 202) return "listed";
    if (response.status === 400) return "invalid";
    if (response.status === 429) return "rate_limited";
    return "failed";
  } catch {
    return "failed";
  }
}

/** What the form says after an attempt. */
export function waitlistNotice(outcome: WaitlistOutcome): string {
  switch (outcome) {
    case "listed":
      return t`Thanks. You are on the waitlist, and we will email you an invite when a place opens.`;
    case "invalid":
      return t`That does not look like an email address. Check it and try again.`;
    case "rate_limited":
      return t`Too many attempts from this connection. Wait an hour, then try again.`;
    case "failed":
      return t`The waitlist could not be reached. Try again in a few minutes.`;
  }
}
