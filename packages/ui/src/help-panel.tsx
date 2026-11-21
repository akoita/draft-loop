import { helpGuide, searchHelpGuide } from "@draft-loop/user-guide";
import { plural, t } from "@lingui/core/macro";
import { useEffect, useId, useRef, useState } from "react";
import { HelpAsk } from "./help-ask.js";
import type { HelpSupport } from "./help-ask-model.js";
import { useCurrentHelpSection } from "./help-context.js";
import { useScreenLocale } from "./i18n.js";

export interface HelpDialogProps {
  readonly onClose: () => void;
  /** The host's support assistant (#2883); without it the panel is the guide alone. */
  readonly support?: HelpSupport | undefined;
  /** The host's public guide page in each language; the panel links the one for its language. */
  readonly fullGuide?: Readonly<Record<"en" | "fr", string>> | undefined;
}

/**
 * The user guide in a modal side sheet (#2830). Each section is a native disclosure, so a phone
 * shows the titles first; the section that fits the screen behind it starts open, else the first. A search field above them (#2880) lists only
 * the sections that match, open and best first. Escape, a click outside where the browser supports
 * `closedby`, and the Close button all close it.
 */
export function HelpDialog({ onClose, support, fullGuide }: HelpDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const { locale } = useScreenLocale();
  const guide = helpGuide(locale);
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const sections = searching ? searchHelpGuide(guide, query) : guide.sections;
  // A source link from an answer opens its section and scrolls to it.
  // It opens on the section that fits the screen behind it (#3227), else on the first one.
  const current = useCurrentHelpSection();
  const opening = current !== null && guide.sections.some((section) => section.id === current);
  const [shown, setShown] = useState<{ readonly id: string; readonly at: number } | null>(
    opening ? { id: current, at: 0 } : null,
  );

  useEffect(() => {
    if (shown === null) return;
    document.getElementById(`${id}-section-${shown.id}`)?.scrollIntoView({ block: "start" });
  }, [id, shown]);

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
      {fullGuide === undefined ? null : (
        <p className="help-full-guide">
          <a href={fullGuide[locale === "fr" ? "fr" : "en"]} target="_blank" rel="noopener">
            {t`Open the full guide in a new tab`}
          </a>
        </p>
      )}
      {support === undefined ? null : (
        <HelpAsk
          support={support}
          language={locale === "fr" ? "fr" : "en"}
          onShowSection={(sectionId) => {
            setQuery("");
            setShown({ id: sectionId, at: Date.now() });
          }}
        />
      )}
      <label className="help-search" htmlFor={`${id}-search`}>
        <span>{t`Search the guide`}</span>
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="help-search-status" role="status">
        {searching
          ? sections.length === 0
            ? t`No section matches. Try another word, or use Send feedback to ask the team.`
            : plural(sections.length, { one: "# matching section", other: "# matching sections" })
          : null}
      </p>
      {sections.map((section, index) => (
        // A new key when search starts or ends resets each disclosure to the default for that view.
        <details
          key={`${searching ? "found" : "all"}-${section.id}-${shown?.id === section.id ? shown.at : ""}`}
          id={`${id}-section-${section.id}`}
          className="help-section"
          open={searching || (index === 0 && !opening) || shown?.id === section.id}
        >
          <summary>{section.title}</summary>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </details>
      ))}
    </dialog>
  );
}

/** The question-mark icon the Help control carries. */
export function HelpIcon() {
  return (
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
  );
}

/** The header's Help button (#2830): opens the guide on every screen. */
export function HelpButton({
  support,
  fullGuide,
}: Pick<HelpDialogProps, "support" | "fullGuide"> = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button button-toolbar help-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <HelpIcon />
        {t`Help`}
      </button>
      {open ? (
        <HelpDialog onClose={() => setOpen(false)} support={support} fullGuide={fullGuide} />
      ) : null}
    </>
  );
}
export type { HelpAskReply, HelpSupport, HelpTranscriptTurn } from "./help-ask-model.js";
