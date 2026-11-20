import { t } from "@lingui/core/macro";
import type { ReactNode } from "react";

import { AccountPageButton } from "./account-page.js";
import type { ApiSchemas } from "./api-client.js";
import { LegalLinks } from "./landing.js";
import { useFoldingMenu } from "./menu-fold.js";
import { OperatorButton } from "./operator.js";
import { canOperate } from "./operator-model.js";
import { accountLabel } from "./records-model.js";
import { SignOutButton } from "./shell-actions.js";

type Me = ApiSchemas["Me"];

export interface AccountMenuProps {
  readonly me: Me;
  /** True on a plan for one person and one job search: the menu names no team. */
  readonly onePerson: boolean;
  /** The person's own data, such as Download everything; never a delete, which sits on the page. */
  readonly yourData?: ReactNode;
  /** Opens the account page, whose danger zone holds the deletes. */
  readonly onAccount?: (() => void) | undefined;
  readonly onSignOut: () => void;
  /**
   * The provider's page where the person sets up a passkey or an authenticator app, the second
   * step after their password. Opens in a new tab.
   */
  readonly signInSecurity?: string | undefined;
  /** Opens the operator page; offered only when `/v1/me` says the caller may operate (#2829). */
  readonly onOperator?: (() => void) | undefined;
  /** Feedback notes waiting in New, shown on the Operator entry and the menu (#3002). */
  readonly newNotes?: number | undefined;
  /** Phone layout: the button shows the person's initial, and the menu opens across the window. */
  readonly compact?: boolean;
  /** The shell's actions (service status, language, Help), folded in here on a phone. */
  readonly shellActions?: ReactNode;
}

/** The first letter of who is signed in, for the phone layout's round account button. */
export function accountInitial(me: Me): string {
  const source = me.kind === "member" ? (me.email ?? "") : "";
  const letter = source.trim().charAt(0).toLocaleUpperCase();
  return letter === "" ? "•" : letter;
}

/**
 * Who is signed in and, on a team plan, which team they act for: a small menu at the start of the
 * top bar with the person's data, sign-out and the legal pages they accepted at sign-up.
 */
export function AccountMenu({
  me,
  onePerson,
  yourData,
  onAccount,
  onSignOut,
  signInSecurity,
  onOperator,
  newNotes,
  compact = false,
  shellActions,
}: AccountMenuProps) {
  const { menu, fold } = useFoldingMenu();
  const label = accountLabel(me, onePerson);
  return (
    <details ref={menu} className={compact ? "account-menu account-menu-compact" : "account-menu"}>
      <summary>
        {compact ? (
          <>
            <span className="account-avatar" aria-hidden="true">
              {accountInitial(me)}
            </span>
            <span className="sr-only">{t`Account menu: ${label}`}</span>
          </>
        ) : (
          <span className="account-name">{label}</span>
        )}
        {onOperator !== undefined && canOperate(me) && newNotes !== undefined && newNotes > 0 ? (
          <span className="operator-count" aria-hidden="true">
            {newNotes}
          </span>
        ) : null}
      </summary>
      <div className="account-menu-body">
        {compact ? <p className="account-menu-who">{label}</p> : null}
        {shellActions === undefined ? null : (
          <div className="account-menu-shell-actions">{shellActions}</div>
        )}
        {yourData}
        {onAccount === undefined ? null : (
          <AccountPageButton
            onOpen={() => {
              fold();
              onAccount();
            }}
          />
        )}
        {signInSecurity === undefined ? null : (
          <a
            className="button button-toolbar"
            href={signInSecurity}
            target="_blank"
            rel="noopener noreferrer"
            title={t`Set up a passkey or an authenticator app for the step after your password`}
            onClick={fold}
          >
            {t`Sign-in security`}
          </a>
        )}
        {onOperator !== undefined && canOperate(me) ? (
          <OperatorButton
            newNotes={newNotes}
            onOpen={() => {
              fold();
              onOperator();
            }}
          />
        ) : null}
        <SignOutButton onSignOut={onSignOut} />
        <p className="account-menu-legal">
          <LegalLinks newTab={true} />
        </p>
      </div>
    </details>
  );
}
