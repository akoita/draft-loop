import { useEffect, useMemo, useState } from "react";

import type { ApiClient } from "./api-client.js";
import { Shell } from "./app.js";
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

/** Sends the person to the identity provider to sign in. */
export function OidcSignIn({ notice, busy = false, onSignIn }: OidcSignInProps) {
  return (
    <main className="sign-in">
      <h1>DraftLoop</h1>
      <p>Sign in with your organisation account. You stay signed in until you close this tab.</p>
      {notice === undefined ? null : (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <button type="button" disabled={busy} onClick={onSignIn}>
        {busy ? "Signing in" : "Sign in"}
      </button>
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
}

type Phase = "completing" | "signed-out" | "signed-in";

/** The web screen when the API signs people in through the identity provider (ADR 0011, D6). */
export function OidcApp({ session, createClient, navigation }: OidcAppProps) {
  const [phase, setPhase] = useState<Phase>(() =>
    readAuthorizationResponse(navigation.search) !== undefined
      ? "completing"
      : session.isSignedIn()
        ? "signed-in"
        : "signed-out",
  );
  const [notice, setNotice] = useState<string | undefined>(() => session.takeNotice());
  const [leaving, setLeaving] = useState(false);

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
        setNotice(error instanceof SignInEndedError ? error.notice : signInNotices.failed);
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
      api: signedInClient(session, createClient, end),
    };
  }, [phase, session, createClient, navigation]);

  if (client === undefined || leaving)
    return (
      <OidcSignIn
        {...(notice === undefined ? {} : { notice })}
        busy={phase === "completing" || leaving}
        onSignIn={() => {
          setLeaving(true);
          session.begin().then(
            (url) => navigation.assign(url),
            (error: unknown) => {
              setLeaving(false);
              setNotice(
                error instanceof SignInEndedError ? error.notice : signInNotices.unreachable,
              );
            },
          );
        }}
      />
    );

  return <Shell client={client.api} onSignOut={() => client.end(undefined, true)} />;
}
