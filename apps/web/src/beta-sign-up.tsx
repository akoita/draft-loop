import { t } from "@lingui/core/macro";
import { useState } from "react";
import { type ApiClient, ApiRequestError } from "./api-client.js";
import { redeemInvite, signUpRefusal } from "./beta-sign-up-model.js";
import { legalLinks } from "./landing.js";
import { PreferencesBar } from "./shell-actions.js";

export interface BetaSignUpViewProps {
  readonly code: string;
  /**
   * Whether the screen asks for a code. Off by default: the invite of the signed-in email address
   * is found without one. On when a link carried a code, the person asks, or no invite was found.
   */
  readonly askCode?: boolean;
  readonly onAskCode?: () => void;
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

/**
 * Creates a signed-in person's account from their beta invite (#2503): the terms, and the code
 * only when the screen asks for one.
 */
export function BetaSignUpView({
  code,
  askCode = false,
  onAskCode,
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
        <h1>{t`Create your Redakloop account`}</h1>
        <p>
          {askCode
            ? t`You are signed in, but this sign-in has no Redakloop account yet. Enter the invite code you received by email to create it.`
            : t`Your invite is ready. Accept the terms to create your account.`}
        </p>
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
          {askCode ? (
            <>
              <label htmlFor="invite-code">{t`Invite code`}</label>
              <input
                id="invite-code"
                name="invite-code"
                type="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={64}
                value={code}
                onChange={(event) => onCodeChange(event.target.value)}
              />
            </>
          ) : null}
          <p>{t`This is a free test version: it can stop at any time, and we will make an effort to let you download your data first. To write and review your drafts, Redakloop sends the parts of your material you select to Anthropic and OpenAI, which process them outside the European Union.`}</p>
          <p>{t`Redakloop is tuned and tested on software and tech roles so far. It works for other jobs too, so check those drafts a little more closely. Support for more professions is on our roadmap.`}</p>
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
          <button type="submit" disabled={busy || (askCode && code.trim() === "") || !accepted}>
            {busy ? t`Creating your account` : t`Create my account`}
          </button>
        </form>
        {askCode || onAskCode === undefined ? null : (
          <button type="button" className="link" onClick={onAskCode}>
            {t`I have an invite code`}
          </button>
        )}
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
  /** The code an invite email's link carried. */
  readonly initialCode?: string;
  readonly onSignedUp: () => void;
  readonly onSignOut: () => void;
}

/** The sign-up screen and its one call. */
export function BetaSignUp({ client, initialCode, onSignedUp, onSignOut }: BetaSignUpProps) {
  const [code, setCode] = useState(initialCode ?? "");
  const [askCode, setAskCode] = useState(initialCode !== undefined);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  return (
    <BetaSignUpView
      code={code}
      askCode={askCode}
      onAskCode={() => setAskCode(true)}
      accepted={accepted}
      busy={busy}
      {...(notice === undefined ? {} : { notice })}
      onCodeChange={setCode}
      onAcceptedChange={setAccepted}
      onSignOut={onSignOut}
      onSubmit={() => {
        setBusy(true);
        setNotice(undefined);
        const withoutCode = !askCode;
        redeemInvite(client, withoutCode ? undefined : code).then(onSignedUp, (error: unknown) => {
          setBusy(false);
          const refusal = signUpRefusal(error, withoutCode);
          // No invite for this address: the code from the email may still name one.
          if (withoutCode && error instanceof ApiRequestError && error.code === "invite_unknown")
            setAskCode(true);
          setNotice(refusal?.message ?? t`Your account could not be created. Try again.`);
        });
      }}
    />
  );
}
