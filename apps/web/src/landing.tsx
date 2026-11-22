import { currentScreenLanguage } from "@draft-loop/ui/i18n";
import { t } from "@lingui/core/macro";
import { type ReactNode, useEffect, useState } from "react";
import { PreferencesBar } from "./shell-actions.js";
import {
  confirmWaitlist,
  joinWaitlist,
  type WaitlistConfirmOutcome,
  type WaitlistOutcome,
  waitlistConfirmNotice,
  waitlistNotice,
} from "./waitlist-model.js";

/** Where #2462 serves the legal pages. */
export const legalLinks = {
  privacy: "/legal/privacy",
  terms: "/legal/terms",
  notice: "/legal/notice",
} as const;

/**
 * The privacy policy, terms of use and legal notice as one line of links: on the landing page,
 * and in the signed-in account menu, where `newTab` keeps the open screen in place.
 */
export function LegalLinks({ newTab = false }: { readonly newTab?: boolean }) {
  const target = newTab ? { target: "_blank", rel: "noopener" } : {};
  return (
    <>
      <a href={legalLinks.privacy} {...target}>{t`Privacy policy`}</a>
      {" · "}
      <a href={legalLinks.terms} {...target}>{t`Terms of use`}</a>
      {" · "}
      <a href={legalLinks.notice} {...target}>{t`Legal notice`}</a>
    </>
  );
}

/** The public About and User guide pages in the screen's language (#3083, #3096). */
export function SitePageLinks({ newTab = false }: { readonly newTab?: boolean }) {
  const target = newTab ? { target: "_blank", rel: "noopener" } : {};
  const french = currentScreenLanguage() === "fr";
  return (
    <>
      <a href={french ? "/about/fr/" : "/about/"} {...target}>
        {t`About Redakloop`}
      </a>
      {" · "}
      <a href={french ? "/guide/fr/" : "/guide/"} {...target}>
        {t`User guide`}
      </a>
    </>
  );
}

export interface WaitlistFormViewProps {
  readonly email: string;
  readonly consent: boolean;
  readonly busy: boolean;
  readonly outcome?: WaitlistOutcome;
  readonly onEmailChange: (email: string) => void;
  readonly onConsentChange: (consent: boolean) => void;
  readonly onSubmit: () => void;
}

/** The waitlist form: an email, one consent and nothing else (#2567). */
export function WaitlistFormView({
  email,
  consent,
  busy,
  outcome,
  onEmailChange,
  onConsentChange,
  onSubmit,
}: WaitlistFormViewProps) {
  if (outcome === "listed" || outcome === "check_inbox") {
    return (
      <p className="notice" role="status">
        {waitlistNotice(outcome)}
      </p>
    );
  }
  return (
    <form
      className="waitlist"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {outcome === undefined ? null : (
        <p className="notice" role="alert">
          {waitlistNotice(outcome)}
        </p>
      )}
      <label htmlFor="waitlist-email">{t`Email address`}</label>
      <input
        id="waitlist-email"
        name="email"
        type="email"
        autoComplete="email"
        maxLength={320}
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
      />
      <label className="consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => onConsentChange(event.target.checked)}
        />
        {/* Change betaWaitlistConsentVersion in the API whenever this text changes. */}
        {t`Keep my email address to invite me to the Redakloop beta. It is deleted once I am invited, or after six months.`}
      </label>
      <button type="submit" disabled={busy || !consent || email.trim() === ""}>
        {busy ? t`Joining` : t`Join the waitlist`}
      </button>
    </form>
  );
}

/** The waitlist form and its one call. */
export function WaitlistForm({ fetchImpl }: { readonly fetchImpl?: typeof fetch }) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<WaitlistOutcome | undefined>();
  return (
    <WaitlistFormView
      email={email}
      consent={consent}
      busy={busy}
      {...(outcome === undefined ? {} : { outcome })}
      onEmailChange={setEmail}
      onConsentChange={setConsent}
      onSubmit={() => {
        setBusy(true);
        void joinWaitlist(email, fetchImpl, currentScreenLanguage()).then((result) => {
          setBusy(false);
          setOutcome(result);
        });
      }}
    />
  );
}

/** The answer to a confirmation link the visitor opened: it confirms once, then says how it went. */
export function WaitlistConfirmation({
  token,
  fetchImpl,
}: {
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}) {
  const [outcome, setOutcome] = useState<WaitlistConfirmOutcome | "confirming">("confirming");
  useEffect(() => {
    let current = true;
    void confirmWaitlist(token, fetchImpl).then((result) => {
      if (current) setOutcome(result);
    });
    return () => {
      current = false;
    };
  }, [token, fetchImpl]);
  return (
    <p
      className="notice"
      role={outcome === "confirmed" || outcome === "confirming" ? "status" : "alert"}
    >
      {waitlistConfirmNotice(outcome)}
    </p>
  );
}

/**
 * What a visitor who is not signed in sees on the hosted beta (#2567): what Redakloop does, that
 * it is a test, the sign-in for invited people, the waitlist and the legal links. It loads no
 * analytics or third-party script, so it needs no cookie banner.
 */
export function Landing({
  signIn,
  fetchImpl,
  confirmToken,
}: {
  /** The sign-in block for people who already have an invite or an account. */
  readonly signIn: ReactNode;
  readonly fetchImpl?: typeof fetch;
  /** The token of the waitlist confirmation link the visitor opened, if any. */
  readonly confirmToken?: string;
}) {
  return (
    <>
      <PreferencesBar />
      <main className="sign-in landing">
        <h1>{t`Redakloop`}</h1>
        <p>{t`Redakloop drafts a CV and a cover letter for each job from your own documents. One AI model writes, a model from another company checks each claim against your sources, and you approve what goes out.`}</p>
        <p className="notice">
          {t`This is a free public test, open by invitation. It may change or pause without notice. Drafting sends the material you select to AI providers, some of them outside the EU.`}
        </p>
        <section aria-labelledby="landing-sign-in">
          <h2 id="landing-sign-in">{t`Already invited?`}</h2>
          {signIn}
        </section>
        <section aria-labelledby="landing-waitlist">
          <h2 id="landing-waitlist">{t`Join the waitlist`}</h2>
          {confirmToken === undefined ? null : (
            <WaitlistConfirmation
              token={confirmToken}
              {...(fetchImpl === undefined ? {} : { fetchImpl })}
            />
          )}
          <p>{t`Places open in small groups, so we can help each tester well. Access opens soon: join the waitlist and we will email you when your place is ready.`}</p>
          <WaitlistForm {...(fetchImpl === undefined ? {} : { fetchImpl })} />
        </section>
        <footer>
          <SitePageLinks />
          {" · "}
          <LegalLinks />
        </footer>
      </main>
    </>
  );
}
