import { t } from "@lingui/core/macro";

/** The public route the landing page's form posts to (#2566). */
export const waitlistUrl = "/v1/waitlist";

/** The public route a confirmation link's token goes to. */
export const waitlistConfirmUrl = "/v1/waitlist/confirm";

/** `check_inbox`: the server emailed a confirmation link, and the place counts once it is opened. */
export type WaitlistOutcome = "listed" | "check_inbox" | "invalid" | "rate_limited" | "failed";

/**
 * Joins the beta waitlist without a credential. A new and an already-listed email answer alike:
 * the API does not say which.
 */
export async function joinWaitlist(
  email: string,
  fetchImpl: typeof fetch = fetch,
  locale?: "en" | "fr",
): Promise<WaitlistOutcome> {
  try {
    const response = await fetchImpl(waitlistUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        consent: true,
        ...(locale === undefined ? {} : { locale }),
      }),
    });
    if (response.status === 202) {
      const body = (await response.json().catch(() => ({}))) as { confirm?: unknown };
      return body.confirm === true ? "check_inbox" : "listed";
    }
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
      return t`Thanks. You are on the waitlist. Places open in small groups and access opens soon: we will email you an invite when your place is ready.`;
    case "check_inbox":
      return t`Almost done: check your inbox. We sent you a link to confirm your address, and your place counts once you open it. The link works for 48 hours. Nothing arrived? Look in your spam folder, or join again in 10 minutes.`;
    case "invalid":
      return t`That does not look like an email address. Check it and try again.`;
    case "rate_limited":
      return t`Too many attempts from this connection. Wait an hour, then try again.`;
    case "failed":
      return t`The waitlist could not be reached. Try again in a few minutes.`;
  }
}

export type WaitlistConfirmOutcome = "confirmed" | "expired" | "rate_limited" | "failed";

/** Confirms a sign-up with the token from the email's link. */
export async function confirmWaitlist(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WaitlistConfirmOutcome> {
  try {
    const response = await fetchImpl(waitlistConfirmUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.status === 200) return "confirmed";
    if (response.status === 404 || response.status === 400) return "expired";
    if (response.status === 429) return "rate_limited";
    return "failed";
  } catch {
    return "failed";
  }
}

/** What the landing page says after a confirmation link is opened. */
export function waitlistConfirmNotice(outcome: WaitlistConfirmOutcome | "confirming"): string {
  switch (outcome) {
    case "confirming":
      return t`Confirming your email address…`;
    case "confirmed":
      return t`Your email address is confirmed and you are on the waitlist. We will email you an invite when your place is ready.`;
    case "expired":
      return t`That confirmation link has expired or is unknown. Join the waitlist again below to get a new one.`;
    case "rate_limited":
      return t`Too many attempts from this connection. Wait an hour, then open the link again.`;
    case "failed":
      return t`Your email address could not be confirmed just now. Open the link again in a few minutes.`;
  }
}
