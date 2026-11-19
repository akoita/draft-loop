import { HelpDialog, HelpIcon } from "@draft-loop/ui/help-panel";
import { currentScreenLanguage } from "@draft-loop/ui/i18n";
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
}

/**
 * The header's Help menu, grouped as apps usually do: quick help in the app, the full user guide
 * and the About page in a new tab, Send feedback, and the legal pages.
 */
export function HelpMenuView({ onQuickHelp, onFeedback }: HelpMenuViewProps) {
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
      </div>
    </details>
  );
}

/** The Help menu over the API: the support assistant on the record in view, and feedback. */
export function WebHelpMenu({
  client,
  mode,
}: {
  readonly client: ApiClient;
  readonly mode: "owner" | "sign-in";
}) {
  const recordId = useContext(RecordContext);
  const support = useMemo(() => webHelpSupport(client, recordId, mode), [client, recordId, mode]);
  const [quickHelp, setQuickHelp] = useState(false);
  const feedback = useFeedbackDialog(client);
  // The dialogs sit beside the menu, not in it, so folding the menu never hides them.
  return (
    <>
      <HelpMenuView
        onQuickHelp={() => setQuickHelp(true)}
        onFeedback={mode === "sign-in" ? feedback.open : undefined}
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
