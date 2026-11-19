import { t } from "@lingui/core/macro";
import { type ReactNode, useEffect, useRef } from "react";

export interface AccountPageProps {
  /** The address the person signs in with. */
  readonly email?: string | undefined;
  /** The safe part, such as Download everything, or nothing when the person may not. */
  readonly yourData?: ReactNode;
  /** The deletes, each behind a typed confirmation; nothing when the person may not delete. */
  readonly dangerZone?: ReactNode;
  readonly onClose: () => void;
}

/**
 * The account page a person on a one-person plan opens from the account menu. The deletes live
 * here, in a marked danger zone, and never in the menu, so no stray click in a menu reaches them.
 */
export function AccountPage({ email, yourData, dangerZone, onClose }: AccountPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <main className="account-page">
      <div className="operator-header">
        <h1 ref={heading} tabIndex={-1}>
          {t`Account`}
        </h1>
        <button type="button" className="secondary" onClick={onClose}>
          {t`Back to DraftLoop`}
        </button>
      </div>
      {email === undefined ? null : <p className="muted">{t`Signed in as ${email}`}</p>}
      {yourData === undefined || yourData === null ? null : (
        <section className="panel account-section" aria-labelledby="account-your-data">
          <h2 id="account-your-data">{t`Your data`}</h2>
          {yourData}
        </section>
      )}
      {dangerZone === undefined || dangerZone === null ? null : (
        <section className="panel account-section danger-zone" aria-labelledby="account-danger">
          <h2 id="account-danger">{t`Danger zone`}</h2>
          <p className="muted">{t`These actions delete data for good and cannot be undone. Each one asks you to type a confirmation first.`}</p>
          {dangerZone}
        </section>
      )}
    </main>
  );
}

/** The account menu's entry to the account page. */
export function AccountPageButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button type="button" className="button button-toolbar" onClick={onOpen}>
      {t`Account settings`}
    </button>
  );
}
