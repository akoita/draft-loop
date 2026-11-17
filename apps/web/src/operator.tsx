import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiClient } from "./api-client.js";
import {
  type FeedbackNote,
  feedbackKindLabel,
  type InviteList,
  type InviteOutcome,
  inviteFromWaitlist,
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

export interface WaitlistSectionProps {
  readonly state: Loaded<readonly WaitlistEntry[]>;
  /** The entry whose invite is being created, if any. */
  readonly inviting?: string | undefined;
  readonly outcome?: InviteOutcome | undefined;
  readonly onInvite: (entry: WaitlistEntry) => void;
}

/** People waiting for a place, newest first, each with an Invite button. */
export function WaitlistSection({ state, inviting, outcome, onInvite }: WaitlistSectionProps) {
  return (
    <section className="panel operator-section" aria-labelledby="operator-waitlist">
      <h2 id="operator-waitlist">{t`Waitlist`}</h2>
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
                  <button
                    type="button"
                    disabled={inviting !== undefined}
                    aria-label={t`Invite ${entry.email}`}
                    onClick={() => onInvite(entry)}
                  >
                    {inviting === entry.entryId ? t`Inviting…` : t`Invite`}
                  </button>
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

/** Every invite with its state, and the accounts invites may still create. */
export function InvitesSection({ state }: { readonly state: Loaded<InviteList> }) {
  return (
    <section className="panel operator-section" aria-labelledby="operator-invites">
      <h2 id="operator-invites">{t`Invites`}</h2>
      <LoadProblem state={state} />
      {state.kind !== "ready" ? null : (
        <>
          <p className="operator-seats">
            {t`${state.value.redeemed} of ${state.value.cap} beta accounts used, ${seatsLeft(state.value)} left.`}
          </p>
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

  async function invite(entry: WaitlistEntry) {
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
        inviting={inviting}
        outcome={outcome}
        onInvite={(entry) => void invite(entry)}
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
