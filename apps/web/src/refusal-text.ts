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
      return status === undefined ? undefined : t`The API answered ${status}.`;
    }
    default:
      return undefined;
  }
}

/** The refusal in the screen's language when its code is known, else the API's message. */
export function refusalText(refusal: Refusal): string {
  return knownText(refusal) ?? refusal.message;
}
