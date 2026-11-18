import { t } from "@lingui/core/macro";
import { type ApiClient, ApiRequestError } from "./api-client.js";

/** What the sign-up screen says for each refusal, and whether trying again can help. */
export interface SignUpRefusal {
  readonly message: string;
  /** False when another code, a wait or the right account is needed, not a retry. */
  readonly retry: boolean;
}

/** The person's words for a refused sign-up; `undefined` for an error that is not a refusal. */
export function signUpRefusal(error: unknown): SignUpRefusal | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;
  switch (error.code) {
    case "invite_unknown":
      return {
        message: t`No invite has that code. Check it for typos, or ask for a new invite.`,
        retry: true,
      };
    case "invite_used":
      return {
        message: t`That invite has already been used. Each code opens one account; ask for a new invite if it was not you.`,
        retry: false,
      };
    case "invite_revoked":
      return { message: t`That invite was withdrawn. Ask for a new invite.`, retry: false };
    case "invite_email_mismatch": {
      const email = error.params?.email;
      return {
        message:
          typeof email === "string"
            ? t`That invite is for another email address than ${email}, the one you are signed in with. Sign out and sign in with the address the invite was sent to.`
            : t`That invite is for another email address. Sign out and sign in with the address the invite was sent to.`,
        retry: false,
      };
    }
    case "beta_full":
      return {
        message: t`The beta is full for now. Your code stays valid: try again when places open.`,
        retry: false,
      };
    case "email_unverified":
      return {
        message: t`Verify your email address with the sign-in provider, then try again.`,
        retry: true,
      };
    case "rate_limited":
      return {
        message: t`Too many attempts. Wait 15 minutes, then try again.`,
        retry: false,
      };
    case "terms_not_accepted":
      return {
        message: t`The terms of use have changed. Reload the page, read the new version and accept it.`,
        retry: false,
      };
    case "already_member":
      return { message: t`This account already exists. Reload the page.`, retry: false };
    default:
      return undefined;
  }
}

/**
 * The terms and privacy policy version the sign-up accepts: the date on the legal pages, which
 * must match the API's `legalVersion` (apps/api/src/legal-pages.ts). An outdated one is refused
 * with `terms_not_accepted`.
 */
export const acceptedTermsVersion = "2026-11-18";

/** Redeems a code with the accepted terms; resolves when the account exists. */
export async function redeemInvite(client: ApiClient, code: string): Promise<void> {
  await client.call("POST /v1/sign-up", {
    body: { code: code.trim(), accepted_terms: acceptedTermsVersion },
  });
}
