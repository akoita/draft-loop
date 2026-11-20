import { t } from "@lingui/core/macro";
import { HostBridgeError } from "./native.js";

/** The host's refusal of `review.load` when no workspace is open yet. */
const noWorkspaceRefusalMessage = () => t`Open a workspace first.`;

/**
 * True when the startup load failed only because no workspace is open, as on a fresh install.
 * That is the start page's normal state, not an error to show.
 */
export function isNoWorkspaceRefusal(reason: unknown): boolean {
  return (
    reason instanceof HostBridgeError &&
    reason.code === "not-found" &&
    reason.message === noWorkspaceRefusalMessage()
  );
}

/** The start page when the workspace did not load: what failed, and what to try. */
export function WorkspaceStartIntro({ error }: { readonly error: string | null }) {
  return (
    <>
      <h1>{t`The review workspace could not load.`}</h1>
      <p>{t`Reload the page to try again.`}</p>
      {error === null ? null : (
        <p className="setup-blocker" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
