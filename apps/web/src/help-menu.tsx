import { HelpDialog, HelpIcon } from "@draft-loop/ui/help-panel";
import { currentScreenLanguage } from "@draft-loop/ui/i18n";
import { formatDate } from "@draft-loop/ui/locale-format";
import { t } from "@lingui/core/macro";
import { useContext, useMemo, useState } from "react";

import type { ApiClient } from "./api-client.js";
import { useFeedbackDialog } from "./feedback.js";
import { guidePagePaths } from "./guide-page.js";
import { webHelpSupport } from "./help-support.js";
import { LegalLinks } from "./landing.js";
import { useFoldingMenu } from "./menu-fold.js";
import { RecordContext } from "./record-context.js";

export interface HelpMenuViewProps {
  /** Opens the in-app Help panel: the guide, its search and the support assistant. */
  readonly onQuickHelp: () => void;
  /** Opens Send feedback; absent in owner-token mode, which has no members (#2828). */
  readonly onFeedback?: (() => void) | undefined;
  /** The release the server runs, from its health; absent on an untagged build. */
  readonly release?: ServerRelease | undefined;
}

/** A server release as health reports it: its number, such as 0.26.46, and its build day. */
export interface ServerRelease {
  readonly version: string;
  readonly releasedOn?: string | undefined;
}

/** The menu's last line, such as `Version 0.26.46 · Released 19 Nov 2026`. */
export function releaseLine({ version, releasedOn }: ServerRelease): string {
  const day = releasedOn === undefined ? undefined : formatDate(releasedOn, { timeZone: "UTC" });
  return day === undefined ? t`Version ${version}` : t`Version ${version} · Released ${day}`;
}

/**
 * The header's Help menu, grouped as apps usually do: quick help in the app, the full user guide
 * and the About page in a new tab, Send feedback, the legal pages, and the version last.
 */
export function HelpMenuView({ onQuickHelp, onFeedback, release }: HelpMenuViewProps) {
  const { menu, fold } = useFoldingMenu();
  const french = currentScreenLanguage() === "fr";
  return (
    <details ref={menu} className="help-menu">
      <summary className="button button-toolbar help-button">
        <HelpIcon />
        {t`Help`}
      </summary>
      <div className="help-menu-body">
        <button
          type="button"
          className="help-menu-item"
          aria-haspopup="dialog"
          onClick={() => {
            fold();
            onQuickHelp();
          }}
        >
          {t`Quick help`}
        </button>
        <a
          className="help-menu-item"
          href={guidePagePaths[french ? "fr" : "en"]}
          target="_blank"
          rel="noopener"
        >
          {t`User guide`}
        </a>
        <a
          className="help-menu-item"
          href={french ? "/about/fr/" : "/about/"}
          target="_blank"
          rel="noopener"
        >
          {t`About DraftLoop`}
        </a>
        {onFeedback === undefined ? null : (
          <button
            type="button"
            className="help-menu-item"
            aria-haspopup="dialog"
            onClick={() => {
              fold();
              onFeedback();
            }}
          >
            {t`Send feedback`}
          </button>
        )}
        <p className="help-menu-legal">
          <LegalLinks newTab={true} />
        </p>
        {release === undefined ? null : <p className="help-menu-version">{releaseLine(release)}</p>}
      </div>
    </details>
  );
}

/** The Help menu over the API: the support assistant on the record in view, and feedback. */
export function WebHelpMenu({
  client,
  mode,
  release,
}: {
  readonly client: ApiClient;
  readonly mode: "owner" | "sign-in";
  readonly release?: ServerRelease | undefined;
}) {
  const recordId = useContext(RecordContext);
  const support = useMemo(() => webHelpSupport(client, recordId, mode), [client, recordId, mode]);
  const [quickHelp, setQuickHelp] = useState(false);
  const feedback = useFeedbackDialog(client, release?.version);
  // The dialogs sit beside the menu, not in it, so folding the menu never hides them.
  return (
    <>
      <HelpMenuView
        onQuickHelp={() => setQuickHelp(true)}
        onFeedback={mode === "sign-in" ? feedback.open : undefined}
        release={release}
      />
      {quickHelp ? (
        <HelpDialog
          onClose={() => setQuickHelp(false)}
          support={support}
          fullGuide={guidePagePaths}
        />
      ) : null}
      {mode === "sign-in" ? feedback.dialog : null}
    </>
  );
}
