import { t } from "@lingui/core/macro";
import { useEffect, useMemo, useState } from "react";
import { AccountScreenLanguage } from "./account-screen-language.js";
import type { ApiClient } from "./api-client.js";
import { Shell } from "./app.js";
import { BetaSignUp } from "./beta-sign-up.js";
import { Landing } from "./landing.js";
import { readAuthorizationResponse } from "./oidc-model.js";
import {
  type OidcSession,
  SignInEndedError,
  signedInClient,
  signInNotices,
} from "./oidc-session.js";
import { PreferencesBar } from "./shell-actions.js";

export interface OidcSignInProps {
  /** Why the last session ended or the last attempt failed. */
  readonly notice?: string;
  /** Set while the screen goes to the provider or finishes a sign-in. */
  readonly busy?: boolean;
  readonly onSignIn: () => void;
  /** Called when the person points at or focuses the button, to wake the provider early. */
  readonly onPrepare?: () => void;
}

/** How long Signing in shows before the screen says the provider may be waking up. */
export const slowSignInMs = 4000;

/** Whether `busy` has lasted longer than {@link slowSignInMs}. */
function useSlow(busy: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), slowSignInMs);
    return () => clearTimeout(timer);
  }, [busy]);
  return slow;
}

/** The sign-in text, the last notice and the button, without the page around them. */
function SignInBlock({ notice, busy = false, onSignIn, onPrepare }: OidcSignInProps) {
  const slow = useSlow(busy);
  return (
    <>
      <p>{t`Sign in with the email address your invitation was sent to.`}</p>
      {notice === undefined ? null : (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onSignIn}
        onPointerEnter={onPrepare}
        onFocus={onPrepare}
      >
        {busy ? t`Signing in` : t`Sign in`}
      </button>
      {slow ? (
        <p className="notice" role="status">
          {t`The sign-in service is waking up. After a quiet spell this can take up to a minute.`}
        </p>
      ) : null}
    </>
  );
}

/** Sends the person to the identity provider to sign in. */
export function OidcSignIn(
  props: OidcSignInProps & {
    readonly waitlist?: boolean;
    /** The token of a waitlist confirmation link the visitor opened. */
    readonly waitlistConfirmToken?: string;
  },
) {
  const { waitlist = false, waitlistConfirmToken, ...signIn } = props;
  // While the beta is open, a visitor who is not signed in sees the landing page (#2567).
  if (waitlist && signIn.busy !== true)
    return (
      <Landing
        signIn={<SignInBlock {...signIn} />}
        {...(waitlistConfirmToken === undefined ? {} : { confirmToken: waitlistConfirmToken })}
      />
    );
  return (
    <>
      <PreferencesBar />
      <main className="sign-in">
        <h1>{t`Redakloop`}</h1>
        <SignInBlock {...signIn} />
      </main>
    </>
  );
}

/** Where the screen is, and how it leaves for the provider and tidies its address on return. */
export interface ScreenNavigation {
  readonly search: string;
  assign(url: string): void;
  /** Drops the provider's answer from the address, so a reload does not replay it. */
  clearQuery(): void;
}

export interface OidcAppProps {
  readonly session: OidcSession;
  readonly createClient: (token: string) => ApiClient;
  readonly navigation: ScreenNavigation;
  /** The provider's page where a person sets up a passkey or an authenticator app. */
  readonly signInSecurity?: string;
  /** The public beta is open: a signed-out visitor sees the landing page and waitlist. */
  readonly waitlist?: boolean;
  /** The code an invite email's link carried: sign-in comes first and sign-up fills it in. */
  readonly inviteCode?: string;
  /**
   * The person just chose their password from the invite email (`#welcome`): the screen goes
   * straight on to the provider's sign-in, without the landing page or a Sign in press.
   */
  readonly welcome?: boolean;
  /** Called once the invite's account exists, so the kept code is forgotten. */
  readonly onInviteUsed?: () => void;
  /** The token of a waitlist confirmation link the visitor opened. */
  readonly waitlistConfirmToken?: string;
}

/** `resuming`: a new tab asks the provider, without its page, whether the person is still signed in. */
type Phase = "resuming" | "completing" | "signed-out" | "signed-in";

/** The web screen when the API signs people in through the identity provider (ADR 0011, D6). */
export function OidcApp({
  session,
  createClient,
  navigation,
  signInSecurity,
  waitlist = false,
  welcome = false,
  inviteCode,
  onInviteUsed,
  waitlistConfirmToken,
}: OidcAppProps) {
  const [phase, setPhase] = useState<Phase>(() =>
    readAuthorizationResponse(navigation.search) !== undefined
      ? "completing"
      : session.isSignedIn()
        ? "signed-in"
        : session.canResume()
          ? "resuming"
          : "signed-out",
  );
  const [notice, setNotice] = useState<string | undefined>(
    () =>
      session.takeNotice() ??
      (inviteCode === undefined
        ? undefined
        : t`Your invite is ready. Sign in with the email address the invite was sent to; the code is filled in for you.`),
  );
  const [leaving, setLeaving] = useState(false);
  // A verified sign-in with no account sees beta sign-up; a new account remounts the app.
  const [needsAccount, setNeedsAccount] = useState(false);
  const [accountVersion, setAccountVersion] = useState(0);

  // The provider may sleep when idle: start waking it as soon as the sign-in screen shows. The
  // public landing page waits for the person to point at Sign in, so visitors do not wake it.
  useEffect(() => {
    if (phase === "signed-out" && !waitlist) session.prepare();
  }, [phase, waitlist, session]);

  // Back from choosing a password: go on to sign-in once, without a press. A failure leaves the
  // ordinary screen and its notice.
  const [welcoming, setWelcoming] = useState(welcome);
  useEffect(() => {
    if (!welcoming || phase !== "signed-out") return;
    setWelcoming(false);
    setLeaving(true);
    session.begin().then(
      (url) => navigation.assign(url),
      (error: unknown) => {
        setLeaving(false);
        setNotice(error instanceof SignInEndedError ? error.notice : signInNotices().unreachable);
      },
    );
  }, [welcoming, phase, session, navigation]);

  // Someone already signed in at the provider opens the app in a new tab without the landing page
  // or a second press of Sign in; with no session there, the provider sends them straight back.
  useEffect(() => {
    if (phase !== "resuming") return;
    let current = true;
    session.begin({ silent: true }).then(
      (url) => {
        if (current) navigation.assign(url);
      },
      () => {
        if (current) setPhase("signed-out");
      },
    );
    return () => {
      current = false;
    };
  }, [phase, session, navigation]);

  useEffect(() => {
    if (phase !== "completing") return;
    let current = true;
    session.complete(navigation.search).then(
      (signedIn) => {
        navigation.clearQuery();
        if (current) setPhase(signedIn ? "signed-in" : "signed-out");
      },
      (error: unknown) => {
        navigation.clearQuery();
        if (!current) return;
        setNotice(error instanceof SignInEndedError ? error.notice : signInNotices().failed);
        setPhase("signed-out");
      },
    );
    return () => {
      current = false;
    };
  }, [phase, session, navigation]);

  const client = useMemo(() => {
    if (phase !== "signed-in") return undefined;
    function end(message: string | undefined, atProvider: boolean) {
      if (!atProvider) {
        session.clear();
        setNotice(message);
        setPhase("signed-out");
        return;
      }
      setLeaving(true);
      void session.signOut(message).then((url) => {
        if (url !== undefined) {
          navigation.assign(url);
          return;
        }
        setLeaving(false);
        setNotice(message);
        setPhase("signed-out");
      });
    }
    return {
      end,
      api: signedInClient(session, createClient, end, () => setNeedsAccount(true)),
    };
  }, [phase, session, createClient, navigation]);

  if (client === undefined || leaving)
    return (
      <OidcSignIn
        // An invited visitor skips the landing page and goes straight to sign-in.
        waitlist={waitlist && inviteCode === undefined && !welcome}
        {...(waitlistConfirmToken === undefined ? {} : { waitlistConfirmToken })}
        {...(notice === undefined ? {} : { notice })}
        busy={phase === "completing" || phase === "resuming" || leaving}
        onPrepare={() => session.prepare()}
        onSignIn={() => {
          setLeaving(true);
          session.begin().then(
            (url) => navigation.assign(url),
            (error: unknown) => {
              setLeaving(false);
              setNotice(
                error instanceof SignInEndedError ? error.notice : signInNotices().unreachable,
              );
            },
          );
        }}
      />
    );

  if (needsAccount)
    return (
      <BetaSignUp
        client={client.api}
        {...(inviteCode === undefined ? {} : { initialCode: inviteCode })}
        onSignedUp={() => {
          onInviteUsed?.();
          setNeedsAccount(false);
          setAccountVersion((version) => version + 1);
        }}
        onSignOut={() => client.end(undefined, true)}
      />
    );

  return (
    <AccountScreenLanguage key={accountVersion} client={client.api}>
      <Shell
        mode="sign-in"
        client={client.api}
        onSignOut={() => client.end(undefined, true)}
        {...(signInSecurity === undefined ? {} : { signInSecurity })}
        // An operator's second step counts for a limited time; this asks for it again.
        onConfirmOperator={() =>
          session.begin({ again: true }).then((url) => navigation.assign(url))
        }
        // The provider deleted the account and its sessions: leave without its sign-out page.
        onAccountDeleted={(notice) => client.end(notice, false)}
      />
    </AccountScreenLanguage>
  );
}
