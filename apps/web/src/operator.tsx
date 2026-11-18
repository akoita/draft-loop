import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiClient } from "./api-client.js";
import {
  type BetaSeats,
  type FeedbackNote,
  feedbackKindLabel,
  type InviteList,
  type InviteOutcome,
  inviteFromWaitlist,
  inviteGoesPastCap,
  inviteStateLabel,
  type Loaded,
  operatorTime,
  readFeedback,
  readInvites,
  readWaitlist,
  seatsLeft,
  type WaitlistEntry,
} from "./operator-model.js";

function LoadProblem({ state }: { readonly state: Loaded<unknown> }) {
  if (state.kind === "loading") return <p role="status">{t`Reading…`}</p>;
  if (state.kind === "failed")
    return (
      <p className="problem" role="alert">
        {state.message}
      </p>
    );
  return null;
}

/** The seats used, the open invites and the seats left, in one sentence. */
function seatsSentence(seats: BetaSeats): string {
  return t`${seats.redeemed} of ${seats.cap} seats used, ${seats.open} invites not used yet, ${seatsLeft(seats)} left.`;
}

export interface WaitlistSectionProps {
  readonly state: Loaded<readonly WaitlistEntry[]>;
  /** The seats and the cap, once read; the Invite button warns past the cap. */
  readonly seats?: BetaSeats | undefined;
  /** The entry whose invite is being created, if any. */
  readonly inviting?: string | undefined;
  /** The entry whose invite waits for the operator to confirm going past the cap, if any. */
  readonly confirming?: string | undefined;
  readonly outcome?: InviteOutcome | undefined;
  /** Asks for an invite: creates it, or first asks to confirm when it goes past the cap. */
  readonly onInvite: (entry: WaitlistEntry) => void;
  /** Creates the invite the operator confirmed past the cap. */
  readonly onConfirm?: (entry: WaitlistEntry) => void;
  readonly onCancel?: () => void;
}

/** People waiting for a place, newest first, each with an Invite button. */
export function WaitlistSection({
  state,
  seats,
  inviting,
  confirming,
  outcome,
  onInvite,
  onConfirm,
  onCancel,
}: WaitlistSectionProps) {
  return (
    <section className="panel operator-section" aria-labelledby="operator-waitlist">
      <h2 id="operator-waitlist">{t`Waitlist`}</h2>
      {seats === undefined ? null : (
        <p className="operator-seats">
          {seatsSentence(seats)}
          {inviteGoesPastCap(seats) ? ` ${t`The cap is reached.`}` : ""}
        </p>
      )}
      {outcome === undefined ? null : outcome.kind === "invited" ? (
        <div className="operator-code" role="status">
          <p>{t`Invite created for ${outcome.email}. Send them this code now: it is shown only once.`}</p>
          <code>{outcome.code}</code>
        </div>
      ) : (
        <p className="problem" role="alert">
          {t`No invite for ${outcome.email}: ${outcome.message}`}
        </p>
      )}
      <LoadProblem state={state} />
      {state.kind !== "ready" ? null : state.value.length === 0 ? (
        <p className="muted">{t`Nobody is waiting.`}</p>
      ) : (
        <ul className="operator-list">
          {state.value.map((entry) => (
            <li key={entry.entryId}>
              <article className="operator-item">
                <h3>{entry.email}</h3>
                <p className="muted">{t`Joined ${operatorTime(entry.joinedAt)}`}</p>
                <footer>
                  {confirming === entry.entryId && seats !== undefined ? (
                    <div className="notice operator-confirm" role="alert">
                      <p>
                        {t`This invite goes past the cap of ${seats.cap} seats: ${seats.redeemed} are used and ${seats.open} invites are not used yet. ${entry.email} cannot sign up until a seat frees or you raise the cap.`}
                      </p>
                      <button type="button" onClick={() => onConfirm?.(entry)}>
                        {t`Invite anyway`}
                      </button>{" "}
                      <button type="button" className="secondary" onClick={() => onCancel?.()}>
                        {t`Cancel`}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={inviting !== undefined || confirming !== undefined}
                      aria-label={t`Invite ${entry.email}`}
                      onClick={() => onInvite(entry)}
                    >
                      {inviting === entry.entryId ? t`Inviting…` : t`Invite`}
                    </button>
                  )}
                </footer>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function inviteTime(invite: InviteList["invites"][number]): string {
  if (invite.state === "redeemed" && invite.redeemedAt !== undefined)
    return t`Redeemed ${operatorTime(invite.redeemedAt)}`;
  if (invite.state === "revoked" && invite.revokedAt !== undefined)
    return t`Revoked ${operatorTime(invite.revokedAt)}`;
  return t`Sent ${operatorTime(invite.createdAt)}`;
}

/** Where the cap comes from, and how to change it. */
function capSourceSentence(seats: BetaSeats): string {
  return seats.capSource === "operator"
    ? t`The operator set this cap. Change it with pnpm beta:cap; no redeploy is needed.`
    : t`This cap comes from the deployment setting. Set another with pnpm beta:cap; no redeploy is needed.`;
}

/** Every invite with its state, and the accounts invites may still create. */
export function InvitesSection({ state }: { readonly state: Loaded<InviteList> }) {
  return (
    <section className="panel operator-section" aria-labelledby="operator-invites">
      <h2 id="operator-invites">{t`Invites`}</h2>
      <LoadProblem state={state} />
      {state.kind !== "ready" ? null : (
        <>
          <p className="operator-seats">{seatsSentence(state.value)}</p>
          <p className="muted">{capSourceSentence(state.value)}</p>
          {state.value.invites.length === 0 ? (
            <p className="muted">{t`No invite sent yet.`}</p>
          ) : (
            <ul className="operator-list">
              {state.value.invites.map((invite) => (
                <li key={invite.inviteId}>
                  <article className="operator-item">
                    <h3>{invite.email}</h3>
                    <p>
                      <span className={`operator-state operator-state-${invite.state}`}>
                        {inviteStateLabel(invite.state)}
                      </span>{" "}
                      <span className="muted">{inviteTime(invite)}</span>
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Members' notes and support tickets, newest first; read only. */
export function FeedbackSection({ state }: { readonly state: Loaded<readonly FeedbackNote[]> }) {
  return (
    <section className="panel operator-section" aria-labelledby="operator-feedback">
      <h2 id="operator-feedback">{t`Feedback`}</h2>
      <LoadProblem state={state} />
      {state.kind !== "ready" ? null : state.value.length === 0 ? (
        <p className="muted">{t`No feedback yet.`}</p>
      ) : (
        <ul className="operator-list">
          {state.value.map((note) => (
            <li key={note.noteId}>
              <article className="operator-item">
                <h3>{feedbackKindLabel(note)}</h3>
                <p className="muted">{t`Sent ${operatorTime(note.sentAt)} from ${note.screen}`}</p>
                <p className="operator-note">{note.text}</p>
                {note.transcript === null || note.transcript.length === 0 ? null : (
                  <details>
                    <summary>{t`Conversation with the assistant`}</summary>
                    <ol className="operator-transcript">
                      {note.transcript.map((turn, index) => (
                        // The transcript is fixed once sent, so its order is its identity.
                        // biome-ignore lint/suspicious/noArrayIndexKey: see above
                        <li key={index}>
                          <strong>{turn.role === "member" ? t`Member` : t`Assistant`}</strong>{" "}
                          <span className="operator-note">{turn.text}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface OperatorPageProps {
  readonly client: ApiClient;
  /** Back to the person's own work. */
  readonly onClose: () => void;
}

/**
 * The operator's page (#2829): the beta waitlist, the invites and the account cap, and members'
 * feedback. Reached only by the owner token or an operator's sign-in with a second factor.
 */
export function OperatorPage({ client, onClose }: OperatorPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [waitlist, setWaitlist] = useState<Loaded<readonly WaitlistEntry[]>>({ kind: "loading" });
  const [invites, setInvites] = useState<Loaded<InviteList>>({ kind: "loading" });
  const [feedback, setFeedback] = useState<Loaded<readonly FeedbackNote[]>>({ kind: "loading" });
  const [inviting, setInviting] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<InviteOutcome | undefined>(undefined);

  const reloadInvitations = useCallback(async () => {
    const [nextWaitlist, nextInvites] = await Promise.all([
      readWaitlist(client),
      readInvites(client),
    ]);
    setWaitlist(nextWaitlist);
    setInvites(nextInvites);
  }, [client]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([readWaitlist(client), readInvites(client), readFeedback(client)]).then(
      ([nextWaitlist, nextInvites, nextFeedback]) => {
        if (!current) return;
        setWaitlist(nextWaitlist);
        setInvites(nextInvites);
        setFeedback(nextFeedback);
      },
    );
    return () => {
      current = false;
    };
  }, [client]);

  function requestInvite(entry: WaitlistEntry) {
    setOutcome(undefined);
    if (invites.kind === "ready" && inviteGoesPastCap(invites.value)) {
      setConfirming(entry.entryId);
      return;
    }
    void invite(entry);
  }

  async function invite(entry: WaitlistEntry) {
    setConfirming(undefined);
    setInviting(entry.entryId);
    setOutcome(undefined);
    const result = await inviteFromWaitlist(client, entry);
    setOutcome(result);
    setInviting(undefined);
    // The API removed the entry and added the invite: read both again.
    if (result.kind === "invited") await reloadInvitations();
  }

  return (
    <main className="operator-page">
      <div className="operator-header">
        <h1 ref={heading} tabIndex={-1}>
          {t`Operator`}
        </h1>
        <button type="button" className="secondary" onClick={onClose}>
          {t`Back to DraftLoop`}
        </button>
      </div>
      <p className="muted">
        {t`The beta's waitlist, its invites and what members tell you. Each invite is written to the audit log.`}
      </p>
      <WaitlistSection
        state={waitlist}
        seats={invites.kind === "ready" ? invites.value : undefined}
        inviting={inviting}
        confirming={confirming}
        outcome={outcome}
        onInvite={requestInvite}
        onConfirm={(entry) => void invite(entry)}
        onCancel={() => setConfirming(undefined)}
      />
      <InvitesSection state={invites} />
      <FeedbackSection state={feedback} />
    </main>
  );
}

/** The account menu's way to the operator page; shown only to a caller who may operate. */
export function OperatorButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button type="button" className="button button-toolbar" onClick={onOpen}>
      {t`Operator`}
    </button>
  );
}
