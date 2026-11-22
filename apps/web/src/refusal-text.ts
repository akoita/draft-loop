/**
 * The screen's own words for the API's refusals (#2323). A refusal carries a stable code and the
 * names and numbers it needs; the screen words the codes it knows in the active locale and shows
 * the API's English message for any other.
 */
import { t } from "@lingui/core/macro";

export interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

function notFoundText(resource: string | number | undefined): string | undefined {
  switch (resource) {
    case "workspace":
      return t`No such workspace.`;
    case "run":
      return t`No such run.`;
    case "brief":
      return t`No such job brief.`;
    case "route":
      return t`No such route.`;
    default:
      return undefined;
  }
}

function knownText(refusal: Refusal): string | undefined {
  switch (refusal.code) {
    case "not_found":
      return notFoundText(refusal.params?.resource);
    case "unauthorized":
      return t`A credential is required.`;
    case "rate_limited":
      return t`Too many requests; retry later.`;
    case "model_call_cap_reached": {
      const limit = refusal.params?.limit;
      return typeof limit === "number"
        ? t`Your plan allows ${limit} interview turns, drafts and profile updates a day, and today's are used. They come back at midnight UTC.`
        : t`Your plan's interview turns, drafts and profile updates for today are used. They come back at midnight UTC.`;
    }
    case "prepare_fair_use_reached": {
      const limit = refusal.params?.limit;
      return typeof limit === "number"
        ? t`This application has used the ${limit} drafts, guides and research runs its credit covers.`
        : t`This application has used the drafts, guides and research runs its credit covers.`;
    }
    case "second_factor_required":
      return t`Your organisation has other members, so this needs a sign-in with a second factor. Set up a passkey or an authenticator app under Sign-in security in the account menu, sign in again and retry.`;
    case "feedback_cap_reached":
      return t`You have sent the most notes a member can send in 24 hours. Try again later.`;
    case "service_maintenance":
      return t`Changes are paused for planned maintenance. They come back on their own; reading and downloading still work.`;
    case "model_calls_paused":
      return t`AI features are paused for a short while. They come back on their own; your work is saved.`;
    case "not_ready":
      return t`The run is still being saved; retry in a moment.`;
    case "brief_version_stale":
      return t`The job brief has a newer version; reload it.`;
    case "bad_request":
    case "payload_too_large":
    case "unsupported_media_type":
      return t`The request could not be processed.`;
    case "unreadable-error": {
      const status = refusal.params?.status;
      if (status === undefined) return undefined;
      // A bare 504 is Cloud Run ending a request that ran past its time limit: waiting does not
      // fix it, but the next try often finishes, since model calls vary in length.
      if (status === 504)
        return t`The server stopped waiting before this finished (error 504). It does not recover on its own: try again. Nothing you saved is lost.`;
      // Any other bare 5xx is Cloud Run's answer while the server restarts or starts: it passes.
      if (typeof status === "number" && status >= 500)
        return t`Redakloop's server did not answer (error ${status}). It recovers on its own within a minute; try again then. Nothing you saved is lost.`;
      return t`The API answered ${status}.`;
    }
    default:
      return undefined;
  }
}

/** The refusal in the screen's language when its code is known, else the API's message. */
export function refusalText(refusal: Refusal): string {
  return knownText(refusal) ?? refusal.message;
}
