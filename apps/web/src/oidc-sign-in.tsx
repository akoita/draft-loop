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

export interface OidcSignInProps {
  /** Why the last session ended or the last attempt failed. */
  readonly notice?: string;
  /** Set while the screen goes to the provider or finishes a sign-in. */
  readonly busy?: boolean;
  readonly onSignIn: () => void;
}

/** The sign-in text, the last notice and the button, without the page around them. */
function SignInBlock({ notice, busy = false, onSignIn }: OidcSignInProps) {
  return (
    <>
      <p>{t`Sign in with your organisation account. You stay signed in until you close this tab.`}</p>
      {notice === undefined ? null : (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <button type="button" disabled={busy} onClick={onSignIn}>
        {busy ? t`Signing in` : t`Sign in`}
      </button>
    </>
  );
}

/** Sends the person to the identity provider to sign in. */
export function OidcSignIn(props: OidcSignInProps & { readonly waitlist?: boolean }) {
  const { waitlist = false, ...signIn } = props;
  // While the beta is open, a visitor who is not signed in sees the landing page (#2567).
  if (waitlist && signIn.busy !== true) return <Landing signIn={<SignInBlock {...signIn} />} />;
  return (
    <main className="sign-in">
      <h1>{t`DraftLoop`}</h1>
      <SignInBlock {...signIn} />
    </main>
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
  /** The public beta is open: a signed-out visitor sees the landing page and waitlist. */
  readonly waitlist?: boolean;
}

type Phase = "completing" | "signed-out" | "signed-in";

/** The web screen when the API signs people in through the identity provider (ADR 0011, D6). */
export function OidcApp({ session, createClient, navigation, waitlist = false }: OidcAppProps) {
  const [phase, setPhase] = useState<Phase>(() =>
    readAuthorizationResponse(navigation.search) !== undefined
      ? "completing"
      : session.isSignedIn()
        ? "signed-in"
        : "signed-out",
  );
  const [notice, setNotice] = useState<string | undefined>(() => session.takeNotice());
  const [leaving, setLeaving] = useState(false);
  // A verified sign-in with no account sees beta sign-up; a new account remounts the app.
  const [needsAccount, setNeedsAccount] = useState(false);
  const [accountVersion, setAccountVersion] = useState(0);

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
        waitlist={waitlist}
        {...(notice === undefined ? {} : { notice })}
        busy={phase === "completing" || leaving}
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
        onSignedUp={() => {
          setNeedsAccount(false);
          setAccountVersion((version) => version + 1);
        }}
        onSignOut={() => client.end(undefined, true)}
      />
    );

  return (
    <AccountScreenLanguage key={accountVersion} client={client.api}>
      <Shell mode="sign-in" client={client.api} onSignOut={() => client.end(undefined, true)} />
    </AccountScreenLanguage>
  );
}
