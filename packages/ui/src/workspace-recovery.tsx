import { t } from "@lingui/core/macro";
import { DesktopBridgeError } from "./native.js";

export function isWorkspaceContextLost(
  reason: unknown,
  requestedWorkspaceId: string | null,
  requestedGeneration: number,
  activeWorkspaceId: string | null,
  activeGeneration: number,
): boolean {
  return (
    isWorkspaceContextCurrent(
      requestedWorkspaceId,
      requestedGeneration,
      activeWorkspaceId,
      activeGeneration,
    ) &&
    reason instanceof DesktopBridgeError &&
    reason.code === "not-found"
  );
}

export function isWorkspaceContextCurrent(
  requestedWorkspaceId: string | null,
  requestedGeneration: number,
  activeWorkspaceId: string | null,
  activeGeneration: number,
): boolean {
  return (
    requestedWorkspaceId !== null &&
    requestedWorkspaceId === activeWorkspaceId &&
    requestedGeneration === activeGeneration
  );
}

export function WorkspaceRecovery({ errorMessage }: { readonly errorMessage: string | null }) {
  return (
    <main className="boot-shell">
      <section className="panel boot-panel">
        <p className="eyebrow">{t`Workspace unavailable`}</p>
        <h1>{t`This workspace could not be found`}</h1>
        <p>{t`Reload the page to try again.`}</p>
        {errorMessage === null ? null : <p role="alert">{errorMessage}</p>}
      </section>
    </main>
  );
}
