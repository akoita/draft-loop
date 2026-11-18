import { t } from "@lingui/core/macro";
import { type ReactNode, useId, useRef } from "react";

export interface DangerDialogProps {
  /** The button that opens the dialog, such as "Delete my account…". */
  readonly label: string;
  /** The dialog's heading. */
  readonly title: string;
  /** The warning and the typed confirmation, with the final delete button. */
  readonly children: ReactNode;
}

/**
 * A destructive action behind a short button: its warning and typed confirmation open in a modal
 * dialog, so a menu shows one line per action. Escape, Cancel or the backdrop close it.
 */
export function DangerDialog({ label, title, children }: DangerDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  function open() {
    const element = dialog.current;
    if (element === null || element.open) return;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
  }

  function close() {
    const element = dialog.current;
    if (element === null) return;
    if (typeof element.close === "function") element.close();
    else element.removeAttribute("open");
  }

  return (
    <>
      <button type="button" className="danger-link" onClick={open}>
        {label}
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes a modal dialog natively; the click only catches the backdrop. */}
      <dialog
        ref={dialog}
        className="release-dialog danger-dialog"
        aria-labelledby={`${id}-title`}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === event.currentTarget) close();
        }}
      >
        <h3 id={`${id}-title`}>{title}</h3>
        {children}
        <div className="actions">
          <button type="button" className="secondary" onClick={close}>
            {t`Cancel`}
          </button>
        </div>
      </dialog>
    </>
  );
}
