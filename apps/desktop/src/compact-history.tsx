import type { WorkspaceCompactHistoryResult } from "@draft-loop/ui/bridge";
import { type RefObject, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocusTrap } from "./review.js";

/** Sizes the way a person reads a file: megabytes below a gigabyte, gigabytes above. */
export function formatHistorySize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes.toFixed(1)} MB`;
}

export function compactHistoryResultText(result: WorkspaceCompactHistoryResult): string {
  return `Run history compacted: ${formatHistorySize(result.beforeBytes)} before, ${formatHistorySize(result.afterBytes)} after. The previous history is kept as ${result.backupFileName}. ${result.runsVerified} runs were checked to read back the same.`;
}

export const compactHistoryFailureFallback =
  "The run history could not be compacted. It was not changed.";

export interface CompactHistoryConfirmationProps {
  readonly working: boolean;
  readonly errorMessage: string | null;
  readonly dialogRef?: RefObject<HTMLDivElement | null>;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** The confirmation: what compaction does, that a backup is kept, and what the backup costs. */
export function CompactHistoryConfirmation({
  working,
  errorMessage,
  dialogRef,
  onConfirm,
  onCancel,
}: CompactHistoryConfirmationProps) {
  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compact-history-title"
        aria-describedby="compact-history-copy"
        ref={dialogRef}
      >
        <h2 id="compact-history-title">Compact run history?</h2>
        <div id="compact-history-copy">
          <p className="modal-copy">
            This rewrites the run history stored with this workspace so it takes less space. Each
            draft and step is stored once instead of being copied again for every step of a run.
            Your runs, drafts and audit trail read back the same, and the audit chain is rebuilt and
            checked.
          </p>
          <p className="modal-copy">
            A full backup of the current history is kept beside it, so the old history is not lost.
            The backup needs as much disk space as the history does now; delete it once you are
            satisfied. Compacting can take a minute on a large history and refuses while a run is
            working. Nothing is sent anywhere.
          </p>
        </div>
        {errorMessage === null ? null : (
          <p className="setup-blocker" role="alert">
            {errorMessage}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="button button-quiet"
            type="button"
            disabled={working}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button className="button" type="button" disabled={working} onClick={onConfirm}>
            {working ? "Compacting…" : "Compact run history"}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface CompactHistoryActionProps {
  readonly workspaceId: string;
  readonly compactHistory: (workspaceId: string) => Promise<WorkspaceCompactHistoryResult>;
  readonly disabled?: boolean;
  readonly disabledReason?: string | null;
}

/** Workspace settings' Compact run history: asks first, then shows the before and after sizes. */
export function CompactHistoryAction({
  workspaceId,
  compactHistory,
  disabled = false,
  disabledReason = null,
}: CompactHistoryActionProps) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<WorkspaceCompactHistoryResult | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    if (!working) setOpen(false);
  }, [working]);
  useModalFocusTrap(open, dialogRef, close);

  const confirm = (): void => {
    setWorking(true);
    setErrorMessage(null);
    compactHistory(workspaceId)
      .then((compacted) => {
        setResult(compacted);
        setOpen(false);
      })
      .catch((reason: unknown) => {
        setErrorMessage(
          reason instanceof Error && reason.message !== ""
            ? reason.message
            : compactHistoryFailureFallback,
        );
      })
      .finally(() => setWorking(false));
  };

  return (
    <>
      <button
        className="button button-outline"
        type="button"
        disabled={disabled}
        {...(disabled && disabledReason !== null ? { title: disabledReason } : {})}
        onClick={() => {
          setErrorMessage(null);
          setOpen(true);
        }}
      >
        Compact run history
      </button>
      {result === null ? null : (
        <p className="home-card-copy" role="status">
          {compactHistoryResultText(result)}
        </p>
      )}
      {open && typeof document !== "undefined"
        ? createPortal(
            <CompactHistoryConfirmation
              working={working}
              errorMessage={errorMessage}
              dialogRef={dialogRef}
              onConfirm={confirm}
              onCancel={close}
            />,
            document.body,
          )
        : null}
    </>
  );
}
