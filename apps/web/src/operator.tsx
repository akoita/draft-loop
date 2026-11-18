import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { ApiClient } from "./api-client.js";
import {
  type BetaSeats,
  draftIssueUrl,
  type FeedbackNote,
  type FeedbackStatus,
  type FeedbackTriage,
  feedbackCounts,
  feedbackKindLabel,
  feedbackStatuses,
  feedbackStatusLabel,
  type InviteList,
  type InviteOutcome,
  inviteFromWaitlist,
  inviteGoesPastCap,
  inviteStateLabel,
  isIssueUrl,
  type Loaded,
  operatorTime,
  readFeedback,
  readInvites,
  readWaitlist,
  replaceNote,
  seatsLeft,
  triageFeedback,
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

/** The note's context as label and value rows; empty parts are left out. */
function contextRows(note: FeedbackNote): readonly (readonly [string, string])[] {
  const context = note.context;
  if (context === null) return [];
  const rows: [string, string][] = [];
  const add = (label: string, value: string | undefined) => {
    if (value !== undefined && value !== "") rows.push([label, value]);
  };
  add(t`Source`, context.source);
  add(t`Page`, context.route);
  add(t`Web version`, context.webBuild);
  add(t`Server version`, context.serverRelease ?? undefined);
  add(t`Plan`, context.plan ?? undefined);
  add(t`Record`, context.ids?.recordId);
  add(t`Application`, context.ids?.applicationId);
  add(t`Run`, context.ids?.runId);
  add(t`Recent errors`, context.recentErrors?.map((error) => error.code).join(", "));
  add(t`Last failed request`, context.lastFailedRequestId);
  const browser = context.browser;
  if (browser !== undefined) {
    add(
      t`Browser`,
      `${browser.family}, ${browser.os}, ${browser.viewport}, ${browser.language}, ${browser.theme}`,
    );
  }
  return rows;
}

/** An address shape, not words: it reads the same in every language. */
const issueUrlExample = "https://github.com/owner/repo/issues/123";

/** Saves a GitHub issue address on the note, from a short inline form. */
function LinkIssueForm({
  disabled,
  onSave,
  onCancel,
}: {
  readonly disabled: boolean;
  readonly onSave: (issueUrl: string) => void;
  readonly onCancel: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="operator-link-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isIssueUrl(value)) {
          setInvalid(true);
          return;
        }
        onSave(value.trim());
      }}
    >
      <label htmlFor={`${id}-url`}>{t`GitHub issue address`}</label>
      <input
        id={`${id}-url`}
        type="url"
        value={value}
        placeholder={issueUrlExample}
        aria-invalid={invalid}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
      />
      {invalid ? (
        <p className="problem" role="alert">
          {t`Paste a GitHub issue address, such as https://github.com/owner/repo/issues/123.`}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" disabled={disabled}>
          {t`Save link`}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {t`Cancel`}
        </button>
      </div>
    </form>
  );
}

interface FeedbackItemProps {
  readonly note: FeedbackNote;
  readonly busy: boolean;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly onSelect: (selected: boolean) => void;
  readonly onTriage?: ((note: FeedbackNote, triage: FeedbackTriage) => void) | undefined;
}

/** One note: its kind, text, context and, for the operator, what to do with it. */
function FeedbackItem({
  note,
  busy,
  selectable,
  selected,
  highlighted,
  onSelect,
  onTriage,
}: FeedbackItemProps) {
  const [linking, setLinking] = useState(false);
  const rows = contextRows(note);
  const triage = (next: FeedbackTriage) => onTriage?.(note, next);
  const kind = feedbackKindLabel(note);
  return (
    <article
      id={`feedback-${note.noteId}`}
      className={highlighted ? "operator-item operator-item-highlight" : "operator-item"}
    >
      <div className="operator-item-heading">
        {selectable && onTriage !== undefined ? (
          <input
            type="checkbox"
            checked={selected}
            aria-label={t`Select the note sent ${operatorTime(note.sentAt)}`}
            onChange={(event) => onSelect(event.target.checked)}
          />
        ) : null}
        <h3>{kind}</h3>
      </div>
      <p className="muted">{t`Sent ${operatorTime(note.sentAt)} from ${note.screen}`}</p>
      <p className="operator-note">{note.text}</p>
      {note.issueUrl === null ? null : (
        <p>
          <a href={note.issueUrl} target="_blank" rel="noreferrer">
            {t`Open the issue`}
          </a>
        </p>
      )}
      {rows.length === 0 ? null : (
        <details>
          <summary>{t`Context`}</summary>
          <dl className="operator-context">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
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
      {onTriage === undefined ? null : linking ? (
        <LinkIssueForm
          disabled={busy}
          onSave={(issueUrl) => {
            setLinking(false);
            triage({ status: "issue", issueUrl });
          }}
          onCancel={() => setLinking(false)}
        />
      ) : (
        <footer className="actions operator-actions">
          {note.status === "closed" ? (
            <button type="button" disabled={busy} onClick={() => triage({ status: "new" })}>
              {t`Reopen`}
            </button>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => triage({ status: "closed" })}>
                {note.status === "issue" ? t`Close, it is fixed` : t`Close`}
              </button>
              {note.status === "new" ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => triage({ status: "triaged" })}
                >
                  {t`Keep for later`}
                </button>
              ) : null}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setLinking(true)}
              >
                {note.status === "issue" ? t`Change the issue` : t`Link an issue`}
              </button>
              {note.status === "issue" ? null : (
                <a
                  className="operator-link-button"
                  href={draftIssueUrl(note)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t`Draft an issue`}
                </a>
              )}
            </>
          )}
        </footer>
      )}
    </article>
  );
}

export interface FeedbackSectionProps {
  readonly state: Loaded<readonly FeedbackNote[]>;
  /** The note the page address names, shown first in its tab. */
  readonly focusNoteId?: string | undefined;
  /** Notes whose triage is being saved. */
  readonly busy?: ReadonlySet<string> | undefined;
  /** The last triage refusal, in words. */
  readonly problem?: string | undefined;
  /** Sets a note's status; without it the section only reads. */
  readonly onTriage?: ((note: FeedbackNote, triage: FeedbackTriage) => void) | undefined;
  /** Closes the selected notes at once. */
  readonly onCloseMany?: ((notes: readonly FeedbackNote[]) => void) | undefined;
}

/**
 * Members' notes and support tickets as an inbox (#3002): New, Kept, Linked to an issue and
 * Closed, newest first. Most notes need no answer, so Close is each note's first action.
 */
export function FeedbackSection({
  state,
  focusNoteId,
  busy,
  problem,
  onTriage,
  onCloseMany,
}: FeedbackSectionProps) {
  const notes = state.kind === "ready" ? state.value : [];
  const focused = notes.find((note) => note.noteId === focusNoteId);
  const [chosen, setChosen] = useState<FeedbackStatus | undefined>(undefined);
  const filter = chosen ?? focused?.status ?? "new";
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const counts = feedbackCounts(notes);
  const shown = notes.filter((note) => note.status === filter);
  const ordered =
    focused === undefined || focused.status !== filter
      ? shown
      : [focused, ...shown.filter((note) => note.noteId !== focused.noteId)];
  const selectable = filter === "new" || filter === "triaged";
  const chosenNotes = shown.filter((note) => selected.has(note.noteId));

  useEffect(() => {
    if (focusNoteId === undefined) return;
    document.getElementById(`feedback-${focusNoteId}`)?.scrollIntoView({ block: "center" });
  }, [focusNoteId]);

  return (
    <section className="panel operator-section" aria-labelledby="operator-feedback">
      <h2 id="operator-feedback">{t`Feedback`}</h2>
      <LoadProblem state={state} />
      {state.kind !== "ready" ? null : (
        <>
          <fieldset className="operator-tabs">
            <legend className="operator-tabs-legend">{t`Show notes`}</legend>
            {feedbackStatuses.map((status) => (
              <button
                key={status}
                type="button"
                className={status === filter ? undefined : "secondary"}
                aria-pressed={status === filter}
                onClick={() => {
                  setChosen(status);
                  setSelected(new Set());
                }}
              >
                {feedbackStatusLabel(status)} {counts[status]}
              </button>
            ))}
          </fieldset>
          {problem === undefined ? null : (
            <p className="problem" role="alert">
              {problem}
            </p>
          )}
          {onTriage !== undefined && selectable && shown.length > 0 ? (
            <div className="actions operator-bulk">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setSelected(
                    chosenNotes.length === shown.length
                      ? new Set()
                      : new Set(shown.map((note) => note.noteId)),
                  )
                }
              >
                {chosenNotes.length === shown.length ? t`Select none` : t`Select all`}
              </button>
              <button
                type="button"
                disabled={chosenNotes.length === 0}
                onClick={() => {
                  onCloseMany?.(chosenNotes);
                  setSelected(new Set());
                }}
              >
                {t`Close selected (${chosenNotes.length})`}
              </button>
            </div>
          ) : null}
          {notes.length === 0 ? (
            <p className="muted">{t`No feedback yet.`}</p>
          ) : ordered.length === 0 ? (
            <p className="muted">{t`Nothing here.`}</p>
          ) : (
            <ul className="operator-list">
              {ordered.map((note) => (
                <li key={note.noteId}>
                  <FeedbackItem
                    note={note}
                    busy={busy?.has(note.noteId) ?? false}
                    selectable={selectable}
                    selected={selected.has(note.noteId)}
                    highlighted={note.noteId === focusNoteId}
                    onSelect={(on) =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (on) next.add(note.noteId);
                        else next.delete(note.noteId);
                        return next;
                      })
                    }
                    onTriage={onTriage}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export interface OperatorPageProps {
  readonly client: ApiClient;
  /** Back to the person's own work. */
  readonly onClose: () => void;
  /** The feedback note the page address names (`#operator/feedback/<noteId>`), shown first. */
  readonly focusNoteId?: string | undefined;
}

/**
 * The operator's page (#2829): the beta waitlist, the invites and the account cap, and members'
 * feedback. Reached only by the owner token or an operator's sign-in with a second factor.
 */
export function OperatorPage({ client, onClose, focusNoteId }: OperatorPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [waitlist, setWaitlist] = useState<Loaded<readonly WaitlistEntry[]>>({ kind: "loading" });
  const [invites, setInvites] = useState<Loaded<InviteList>>({ kind: "loading" });
  const [feedback, setFeedback] = useState<Loaded<readonly FeedbackNote[]>>({ kind: "loading" });
  const [inviting, setInviting] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<InviteOutcome | undefined>(undefined);
  const [triaging, setTriaging] = useState<ReadonlySet<string>>(new Set());
  const [triageProblem, setTriageProblem] = useState<string | undefined>(undefined);

  const triage = useCallback(
    async (notes: readonly FeedbackNote[], next: FeedbackTriage) => {
      const ids = notes.map((note) => note.noteId);
      setTriageProblem(undefined);
      setTriaging((previous) => new Set([...previous, ...ids]));
      const results = await Promise.all(
        notes.map((note) => triageFeedback(client, note.noteId, next)),
      );
      setFeedback((previous) => {
        if (previous.kind !== "ready") return previous;
        let value = previous.value;
        for (const result of results) {
          if (result.kind === "triaged") value = replaceNote(value, result.note);
        }
        return { kind: "ready", value };
      });
      const failed = results.find((result) => result.kind === "failed");
      if (failed?.kind === "failed") setTriageProblem(failed.message);
      setTriaging((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
    },
    [client],
  );

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
      <FeedbackSection
        state={feedback}
        focusNoteId={focusNoteId}
        busy={triaging}
        problem={triageProblem}
        onTriage={(note, next) => void triage([note], next)}
        onCloseMany={(notes) => void triage(notes, { status: "closed" })}
      />
    </main>
  );
}

/**
 * The account menu's way to the operator page; shown only to a caller who may operate. It counts
 * the feedback notes waiting in New, once read.
 */
export function OperatorButton({
  onOpen,
  newNotes,
}: {
  readonly onOpen: () => void;
  readonly newNotes?: number | undefined;
}) {
  return (
    <button
      type="button"
      className="button button-toolbar"
      onClick={onOpen}
      aria-label={
        newNotes === undefined || newNotes === 0
          ? undefined
          : t`Operator, ${newNotes} new feedback notes`
      }
    >
      {t`Operator`}
      {newNotes === undefined || newNotes === 0 ? null : (
        <span className="operator-count" aria-hidden="true">
          {newNotes}
        </span>
      )}
    </button>
  );
}
