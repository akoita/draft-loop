import { DesktopBridgeError } from "./native.js";

/** The host's refusal of `review.load` when no workspace is open yet (electron/host.ts). */
const noWorkspaceRefusalMessage = "Open a workspace first.";

/**
 * True when the startup load failed only because no workspace is open, as on a fresh install.
 * That is the start page's normal state, not an error to show.
 */
export function isNoWorkspaceRefusal(reason: unknown): boolean {
  return (
    reason instanceof DesktopBridgeError &&
    reason.code === "not-found" &&
    reason.message === noWorkspaceRefusalMessage
  );
}

export const workspaceStartGuidance =
  "To begin, create a workspace for your job search, open a recent one, or try the demo with sample material.";

/**
 * The start page heading: guidance on what to do first, then the refusal of an action that
 * failed, if any.
 */
export function WorkspaceStartIntro({
  navigation,
  error,
}: {
  /** True when the person left an open workspace to switch or create another. */
  readonly navigation: boolean;
  readonly error: string | null;
}) {
  return (
    <>
      <p className="eyebrow">{navigation ? "Workspace navigation" : "First run"}</p>
      <h1>{navigation ? "Open or create a review workspace" : "Set up a review workspace"}</h1>
      <p>{workspaceStartGuidance}</p>
      {error === null ? null : (
        <p className="setup-blocker" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
