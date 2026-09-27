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

export function WorkspaceRecovery({
  busy,
  errorMessage,
  onOpen,
}: {
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly onOpen?: () => void;
}) {
  return (
    <main className="boot-shell">
      <section className="panel boot-panel">
        <p className="eyebrow">Workspace unavailable</p>
        <h1>Open a workspace to continue</h1>
        <p>The current workspace could not be found. Open a workspace to resume local review.</p>
        {errorMessage === null ? null : <p role="alert">{errorMessage}</p>}
        {onOpen === undefined ? (
          <p>Opening a workspace is unavailable in this host.</p>
        ) : (
          <button className="button" type="button" disabled={busy} onClick={onOpen}>
            {busy ? "Opening workspace…" : "Open workspace"}
          </button>
        )}
      </section>
    </main>
  );
}
