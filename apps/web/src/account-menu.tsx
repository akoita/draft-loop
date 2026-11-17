import { type ReactNode, useEffect, useRef } from "react";

import type { ApiSchemas } from "./api-client.js";
import { accountLabel } from "./records-model.js";
import { SignOutButton } from "./shell-actions.js";

type Me = ApiSchemas["Me"];

export interface AccountMenuProps {
  readonly me: Me;
  /** True on a plan for one person and one job search: the menu names no team. */
  readonly onePerson: boolean;
  /** The person's own data, such as download and delete, or nothing when they may not. */
  readonly yourData?: ReactNode;
  readonly onSignOut: () => void;
}

/**
 * Who is signed in and, on a team plan, which team they act for: a small menu at the start of the
 * top bar with the person's data and sign-out.
 */
export function AccountMenu({ me, onePerson, yourData, onSignOut }: AccountMenuProps) {
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
      </summary>
      <div className="account-menu-body">
        {yourData}
        <SignOutButton onSignOut={onSignOut} />
      </div>
    </details>
  );
}
