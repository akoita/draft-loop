import { t } from "@lingui/core/macro";
import { useEffect, useId, useRef, useState } from "react";

import { helpGuide } from "./help-guide.js";
import { useScreenLocale } from "./i18n.js";

export interface HelpDialogProps {
  readonly onClose: () => void;
}

/**
 * The user guide in a modal side sheet (#2830). Each section is a native disclosure, so a phone
 * shows the titles first; the first one starts open. Escape, a click outside where the browser
 * supports `closedby`, and the Close button all close it.
 */
export function HelpDialog({ onClose }: HelpDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const { locale } = useScreenLocale();
  const guide = helpGuide(locale);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && typeof element.showModal === "function" && !element.open) {
      element.showModal();
    }
  }, []);

  return (
    <dialog
      ref={dialog}
      className="help-dialog"
      aria-labelledby={`${id}-title`}
      // Light dismiss where supported; Escape and Close work everywhere.
      {...{ closedby: "any" }}
      onClose={onClose}
    >
      <div className="help-dialog-header">
        <h2 id={`${id}-title`}>{t`Help`}</h2>
        <button
          type="button"
          className="button button-toolbar"
          onClick={() => dialog.current?.close()}
        >
          {t`Close`}
        </button>
      </div>
      <p className="help-intro">{guide.intro}</p>
      {guide.sections.map((section, index) => (
        <details key={section.id} className="help-section" open={index === 0}>
          <summary>{section.title}</summary>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </details>
      ))}
    </dialog>
  );
}

/** The header's Help button (#2830): opens the guide on every screen. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button button-toolbar help-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="12" cy="16.9" r="0.9" fill="currentColor" />
        </svg>
        {t`Help`}
      </button>
      {open ? <HelpDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
