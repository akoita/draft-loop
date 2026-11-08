import { t } from "@lingui/core/macro";
import { type ReactNode, useState } from "react";
import { joinWaitlist, type WaitlistOutcome, waitlistNotice } from "./waitlist-model.js";

/** Where #2462 serves the legal pages. */
export const legalLinks = { privacy: "/legal/privacy", terms: "/legal/terms" } as const;

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
  if (outcome === "listed") {
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
        {t`Keep my email address to invite me to the DraftLoop beta. It is deleted once I am invited, or after six months.`}
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
        void joinWaitlist(email, fetchImpl).then((result) => {
          setBusy(false);
          setOutcome(result);
        });
      }}
    />
  );
}

/**
 * What a visitor who is not signed in sees on the hosted beta (#2567): what DraftLoop does, that
 * it is a test, the sign-in for invited people, the waitlist and the legal links. It loads no
 * analytics or third-party script, so it needs no cookie banner.
 */
export function Landing({
  signIn,
  fetchImpl,
}: {
  /** The sign-in block for people who already have an invite or an account. */
  readonly signIn: ReactNode;
  readonly fetchImpl?: typeof fetch;
}) {
  return (
    <main className="sign-in landing">
      <h1>{t`DraftLoop`}</h1>
      <p>{t`DraftLoop drafts a CV and a cover letter for each job from your own documents. One AI model writes, a model from another company checks each claim against your sources, and you approve what goes out.`}</p>
      <p className="notice">
        {t`This is a free public test, open by invitation. It may change or pause without notice. Drafting sends the material you select to AI providers, some of them outside the EU.`}
      </p>
      <section aria-labelledby="landing-sign-in">
        <h2 id="landing-sign-in">{t`Already invited?`}</h2>
        {signIn}
      </section>
      <section aria-labelledby="landing-waitlist">
        <h2 id="landing-waitlist">{t`Join the waitlist`}</h2>
        <WaitlistForm {...(fetchImpl === undefined ? {} : { fetchImpl })} />
      </section>
      <footer>
        <a href={legalLinks.privacy}>{t`Privacy policy`}</a>
        {" · "}
        <a href={legalLinks.terms}>{t`Terms of use`}</a>
      </footer>
    </main>
  );
}
