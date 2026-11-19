import { type ReactNode, useEffect, useRef } from "react";

import { AccountPageButton } from "./account-page.js";
import type { ApiSchemas } from "./api-client.js";
import { LegalLinks } from "./landing.js";
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
  /** Opens the operator page; offered only when `/v1/me` says the caller may operate (#2829). */
  readonly onOperator?: (() => void) | undefined;
  /** Feedback notes waiting in New, shown on the Operator entry and the menu (#3002). */
  readonly newNotes?: number | undefined;
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
  onOperator,
  newNotes,
}: AccountMenuProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  // A click outside the open menu, or Escape, folds it, as menus elsewhere do.
  useEffect(() => {
    const fold = (event: Event) => {
      const element = menu.current;
      if (element === null || !element.open) return;
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !element.contains(event.target as Node)
      )
        element.open = false;
    };
    document.addEventListener("pointerdown", fold);
    document.addEventListener("keydown", fold);
    return () => {
      document.removeEventListener("pointerdown", fold);
      document.removeEventListener("keydown", fold);
    };
  }, []);
  return (
    <details ref={menu} className="account-menu">
      <summary>
        <span className="account-name">{accountLabel(me, onePerson)}</span>
        {onOperator !== undefined && canOperate(me) && newNotes !== undefined && newNotes > 0 ? (
          <span className="operator-count" aria-hidden="true">
            {newNotes}
          </span>
        ) : null}
      </summary>
      <div className="account-menu-body">
        {yourData}
        {onAccount === undefined ? null : (
          <AccountPageButton
            onOpen={() => {
              if (menu.current !== null) menu.current.open = false;
              onAccount();
            }}
          />
        )}
        {onOperator !== undefined && canOperate(me) ? (
          <OperatorButton
            newNotes={newNotes}
            onOpen={() => {
              if (menu.current !== null) menu.current.open = false;
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
