import { t } from "@lingui/core/macro";
import { type FormEvent, useState } from "react";

import { type ApiClient, ApiRequestError, describeError } from "./api-client.js";
import { DangerDialog } from "./danger-dialog.js";

export interface AccountDeletionProps {
  readonly client: ApiClient;
  /** The address the person signed in with, which they type back to confirm. */
  readonly email: string;
  /** Called once the account is gone, with what the signed-out screen tells the person. */
  readonly onDeleted: (notice: string) => void;
}

const mismatch = () => t`Type the email address you sign in with to confirm.`;

/** Why the API kept the account, in the person's words. */
export function accountDeletionRefusal(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "confirmation_mismatch") return mismatch();
    if (error.code === "run_active") {
      return t`A draft is being written. Wait for it to finish or stop it, then delete your account.`;
    }
    if (error.code === "operator_account") {
      return t`This account runs DraftLoop as an operator, so it cannot be deleted from here. Remove its operator role first.`;
    }
    if (error.code === "organisation_has_members") {
      return t`Other people share your account's team, so it cannot be deleted from here. Ask us to close it.`;
    }
  }
  return describeError(error);
}

/** What the signed-out screen says once the account is gone. */
export function accountDeletedNotice(identity: "deleted" | "kept"): string {
  return identity === "deleted"
    ? t`Your account and everything stored for it were deleted. Thank you for trying DraftLoop.`
    : t`Everything stored for your account was deleted. Your sign-in could not be removed yet; we will remove it shortly.`;
}

/** Deletes the person's whole account, sign-in included (#3033), once they type their address. */
export function AccountDeletion({ client, email, onDeleted }: AccountDeletionProps) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  return (
    <AccountDeletionPanel
      email={email}
      busy={busy}
      problem={problem}
      onDelete={(typed) => {
        if (typed.trim().toLowerCase() !== email.trim().toLowerCase()) {
          setProblem(mismatch());
          return;
        }
        setBusy(true);
        setProblem(undefined);
        client.call("DELETE /v1/account", { body: { confirm: typed } }).then(
          (answer) => onDeleted(accountDeletedNotice(answer.identity)),
          (error: unknown) => {
            setProblem(accountDeletionRefusal(error));
            setBusy(false);
          },
        );
      }}
    />
  );
}

export interface AccountDeletionPanelProps {
  readonly email: string;
  readonly busy: boolean;
  readonly problem: string | undefined;
  /** Called with the address the person typed. */
  readonly onDelete: (typed: string) => void;
}

/** The account's delete form, which asks for the sign-in address typed back. */
export function AccountDeletionPanel({
  email,
  busy,
  problem,
  onDelete,
}: AccountDeletionPanelProps) {
  const [typed, setTyped] = useState("");

  function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDelete(typed);
  }

  return (
    <DangerDialog label={t`Delete my account…`} title={t`Delete my account`}>
      <form className="inline-form account-deletion" onSubmit={remove}>
        <p className="notice">{t`Deleting your account removes all your documents, applications and drafts, your sign-in and your beta place, for good. It cannot be undone. Download everything first if you need a copy.`}</p>
        <label htmlFor="delete-account-confirm">
          {t`Type your email address,`} {email}
          {t`, to confirm`}
        </label>
        <input
          id="delete-account-confirm"
          type="email"
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit" className="danger" disabled={busy}>
          {busy ? t`Deleting your account…` : t`Delete my account`}
        </button>
        {problem === undefined ? null : (
          <p className="problem" role="alert">
            {problem}
          </p>
        )}
      </form>
    </DangerDialog>
  );
}
