import { t } from "@lingui/core/macro";
import { useState } from "react";
import type { ApiClient } from "./api-client.js";
import { redeemInvite, signUpRefusal } from "./beta-sign-up-model.js";
import { legalLinks } from "./landing.js";
import { PreferencesBar } from "./shell-actions.js";

export interface BetaSignUpViewProps {
  readonly code: string;
  /** Whether the person ticked the acceptance of the terms and privacy policy. */
  readonly accepted: boolean;
  readonly busy: boolean;
  /** The last refusal or failure, shown above the form. */
  readonly notice?: string;
  readonly onCodeChange: (code: string) => void;
  readonly onAcceptedChange: (accepted: boolean) => void;
  readonly onSubmit: () => void;
  readonly onSignOut: () => void;
}

/** Asks a signed-in person with no account for their beta invite code (#2503). */
export function BetaSignUpView({
  code,
  accepted,
  busy,
  notice,
  onCodeChange,
  onAcceptedChange,
  onSubmit,
  onSignOut,
}: BetaSignUpViewProps) {
  return (
    <>
      <PreferencesBar />
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
          <p>{t`This is a free test version: it can stop at any time, and we will make an effort to let you download your data first. To write and review your drafts, DraftLoop sends the parts of your material you select to Anthropic and OpenAI, which process them outside the European Union.`}</p>
          <div className="terms-acceptance">
            <input
              id="accept-terms"
              type="checkbox"
              checked={accepted}
              onChange={(event) => onAcceptedChange(event.target.checked)}
            />
            <label htmlFor="accept-terms">
              {t`I accept the terms of use and the privacy policy.`}{" "}
              <a href={legalLinks.terms} target="_blank" rel="noopener">
                {t`Terms of use`}
              </a>
              {" · "}
              <a href={legalLinks.privacy} target="_blank" rel="noopener">
                {t`Privacy policy`}
              </a>
            </label>
          </div>
          <button type="submit" disabled={busy || code.trim() === "" || !accepted}>
            {busy ? t`Creating your account` : t`Create my account`}
          </button>
        </form>
        <p>{t`No invite? The beta is invite-only for now.`}</p>
        <button type="button" className="link" onClick={onSignOut}>
          {t`Sign out`}
        </button>
      </main>
    </>
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
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  return (
    <BetaSignUpView
      code={code}
      accepted={accepted}
      busy={busy}
      {...(notice === undefined ? {} : { notice })}
      onCodeChange={setCode}
      onAcceptedChange={setAccepted}
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
