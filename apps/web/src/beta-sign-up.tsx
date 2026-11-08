import { t } from "@lingui/core/macro";
import { useState } from "react";
import type { ApiClient } from "./api-client.js";
import { redeemInvite, signUpRefusal } from "./beta-sign-up-model.js";

export interface BetaSignUpViewProps {
  readonly code: string;
  readonly busy: boolean;
  /** The last refusal or failure, shown above the form. */
  readonly notice?: string;
  readonly onCodeChange: (code: string) => void;
  readonly onSubmit: () => void;
  readonly onSignOut: () => void;
}

/** Asks a signed-in person with no account for their beta invite code (#2503). */
export function BetaSignUpView({
  code,
  busy,
  notice,
  onCodeChange,
  onSubmit,
  onSignOut,
}: BetaSignUpViewProps) {
  return (
    <main className="sign-in">
      <h1>{t`Join the DraftLoop beta`}</h1>
      <p>{t`You are signed in, but this account has no DraftLoop account yet. Enter the invite code you received by email to create it.`}</p>
      {notice === undefined ? null : (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="invite-code">{t`Invite code`}</label>
        <input
          id="invite-code"
          name="invite-code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          value={code}
          onChange={(event) => onCodeChange(event.target.value)}
        />
        <button type="submit" disabled={busy || code.trim() === ""}>
          {busy ? t`Creating your account` : t`Create my account`}
        </button>
      </form>
      <p>{t`No invite? The beta is invite-only for now.`}</p>
      <button type="button" className="link" onClick={onSignOut}>
        {t`Sign out`}
      </button>
    </main>
  );
}

export interface BetaSignUpProps {
  readonly client: ApiClient;
  readonly onSignedUp: () => void;
  readonly onSignOut: () => void;
}

/** The sign-up screen and its one call. */
export function BetaSignUp({ client, onSignedUp, onSignOut }: BetaSignUpProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  return (
    <BetaSignUpView
      code={code}
      busy={busy}
      {...(notice === undefined ? {} : { notice })}
      onCodeChange={setCode}
      onSignOut={onSignOut}
      onSubmit={() => {
        setBusy(true);
        setNotice(undefined);
        redeemInvite(client, code).then(onSignedUp, (error: unknown) => {
          setBusy(false);
          setNotice(
            signUpRefusal(error)?.message ?? t`Your account could not be created. Try again.`,
          );
        });
      }}
    />
  );
}
