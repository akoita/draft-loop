import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { ApiClient } from "./api-client.js";
import { ListMore, ListSearch, usePagedList } from "./operator-list.js";
import {
  appendUnique,
  type BetaSeats,
  draftIssueUrl,
  type FeedbackNote,
  type FeedbackPage,
  type FeedbackStatus,
  type FeedbackTriage,
  feedbackKindLabel,
  feedbackStatuses,
  feedbackStatusLabel,
  type InviteList,
  type InviteOutcome,
  type InviteState,
  inviteFromWaitlist,
  inviteGoesPastCap,
  inviteStateLabel,
  inviteStates,
  isIssueUrl,
  type Loaded,
  movedCounts,
  operatorTime,
  readFeedback,
  readFeedbackNote,
  readInvites,
  readWaitlist,
  seatsLeft,
  triageFeedback,
  type WaitlistEntry,
  type WaitlistPage,
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
  readonly state: Loaded<WaitlistPage>;
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
  /** The search the list was read with; blank for every entry. */
  readonly query?: string | undefined;
  readonly onSearch?: ((query: string) => void) | undefined;
  /** Reads the next page; without it the list shows only what it holds. */
  readonly onMore?: (() => void) | undefined;
  readonly loadingMore?: boolean | undefined;
  readonly moreProblem?: string | undefined;
}

/** People waiting for a place, oldest first (the order to invite in), one row each. */
export function WaitlistSection({
  state,
  seats,
  inviting,
  confirming,
  outcome,
  onInvite,
  onConfirm,
  onCancel,
  query = "",
  onSearch,
  onMore,
  loadingMore = false,
  moreProblem,
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
      {onSearch === undefined ? null : (
        <ListSearch label={t`Search by email`} query={query} onSearch={onSearch} />
      )}
      <LoadProblem state={state} />
      {state.kind !== "ready" ? null : state.value.entries.length === 0 ? (
        <p className="muted">
          {query.trim() === "" ? t`Nobody is waiting.` : t`No entry matches this search.`}
        </p>
      ) : (
        <>
          <p className="muted">{t`Oldest first: the order people asked in.`}</p>
          <ul className="operator-rows">
            {state.value.entries.map((entry) => (
              <li key={entry.entryId} className="operator-row">
                <span className="operator-row-main">
                  <strong>{entry.email}</strong>{" "}
                  <span className="muted">{t`Joined ${operatorTime(entry.joinedAt)}`}</span>
                </span>
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
              </li>
            ))}
          </ul>
          <ListMore
            shown={state.value.entries.length}
            total={state.value.total}
            loading={loadingMore}
            problem={moreProblem}
            onMore={onMore}
          />
        </>
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

/** A filter tab's name on the invites list. */
function inviteFilterLabel(state: InviteState | undefined): string {
  switch (state) {
    case undefined:
      return t`All`;
    case "open":
      return t`Not used yet`;
    case "redeemed":
      return t`Redeemed`;
    case "revoked":
      return t`Revoked`;
  }
}

export interface InvitesSectionProps {
  readonly state: Loaded<InviteList>;
  /** The state the list shows; every invite when absent. */
  readonly filter?: InviteState | undefined;
  readonly onFilter?: ((state: InviteState | undefined) => void) | undefined;
  readonly query?: string | undefined;
  readonly onSearch?: ((query: string) => void) | undefined;
  readonly onMore?: (() => void) | undefined;
  readonly loadingMore?: boolean | undefined;
  readonly moreProblem?: string | undefined;
}

/** The invites, newest first, one row each, and the accounts invites may still create. */
export function InvitesSection({
  state,
  filter,
  onFilter,
  query = "",
  onSearch,
  onMore,
  loadingMore = false,
  moreProblem,
}: InvitesSectionProps) {
  return (
    <section className="panel operator-section" aria-labelledby="operator-invites">
      <h2 id="operator-invites">{t`Invites`}</h2>
      <LoadProblem state={state} />
      {state.kind !== "ready" ? null : (
        <>
          <p className="operator-seats">{seatsSentence(state.value)}</p>
          <p className="muted">{capSourceSentence(state.value)}</p>
          {onFilter === undefined ? null : (
            <fieldset className="operator-tabs">
              <legend className="operator-tabs-legend">{t`Show invites`}</legend>
              {[undefined, ...inviteStates].map((choice) => {
                const counts = state.value.counts;
                const count =
                  choice === undefined
                    ? counts.open + counts.redeemed + counts.revoked
                    : counts[choice];
                return (
                  <button
                    key={choice ?? "all"}
                    type="button"
                    className={choice === filter ? undefined : "secondary"}
                    aria-pressed={choice === filter}
                    onClick={() => onFilter(choice)}
                  >
                    {inviteFilterLabel(choice)} {count}
                  </button>
                );
              })}
            </fieldset>
          )}
          {onSearch === undefined ? null : (
            <ListSearch label={t`Search by email`} query={query} onSearch={onSearch} />
          )}
          {state.value.invites.length === 0 ? (
            <p className="muted">
              {query.trim() === "" && filter === undefined
                ? t`No invite sent yet.`
                : t`No invite matches.`}
            </p>
          ) : (
            <>
              <ul className="operator-rows">
                {state.value.invites.map((invite) => (
                  <li key={invite.inviteId} className="operator-row">
                    <span className="operator-row-main">
                      <strong>{invite.email}</strong>{" "}
                      <span className="muted">{inviteTime(invite)}</span>
                    </span>
                    <span className={`operator-state operator-state-${invite.state}`}>
                      {inviteStateLabel(invite.state)}
                    </span>
                  </li>
                ))}
              </ul>
              <ListMore
                shown={state.value.invites.length}
                total={state.value.total}
                loading={loadingMore}
                problem={moreProblem}
                onMore={onMore}
              />
            </>
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
        <span className="muted">{t`Sent ${operatorTime(note.sentAt)} from ${note.screen}`}</span>
      </div>
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
  readonly state: Loaded<FeedbackPage>;
  /** The tab shown; New when absent. */
  readonly filter?: FeedbackStatus | undefined;
  readonly onFilter?: ((status: FeedbackStatus) => void) | undefined;
  /** The note the page address names, shown first while it is in the tab shown. */
  readonly focusNote?: FeedbackNote | undefined;
  /** Notes whose triage is being saved. */
  readonly busy?: ReadonlySet<string> | undefined;
  /** The last triage refusal, in words. */
  readonly problem?: string | undefined;
  /** Sets a note's status; without it the section only reads. */
  readonly onTriage?: ((note: FeedbackNote, triage: FeedbackTriage) => void) | undefined;
  /** Closes the selected notes at once. */
  readonly onCloseMany?: ((notes: readonly FeedbackNote[]) => void) | undefined;
  readonly query?: string | undefined;
  readonly onSearch?: ((query: string) => void) | undefined;
  readonly onMore?: (() => void) | undefined;
  readonly loadingMore?: boolean | undefined;
  readonly moreProblem?: string | undefined;
}

/**
 * Members' notes and support tickets as an inbox (#3002): New, Kept, Linked to an issue and
 * Closed, newest first, a page at a time with a search (#3016). Most notes need no answer, so
 * Close is each note's first action.
 */
export function FeedbackSection({
  state,
  filter = "new",
  onFilter,
  focusNote,
  busy,
  problem,
  onTriage,
  onCloseMany,
  query = "",
  onSearch,
  onMore,
  loadingMore = false,
  moreProblem,
}: FeedbackSectionProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const page = state.kind === "ready" ? state.value : undefined;
  const shown = (page?.notes ?? []).filter((note) => note.status === filter);
  const pinned = focusNote !== undefined && focusNote.status === filter ? focusNote : undefined;
  const ordered =
    pinned === undefined
      ? shown
      : [pinned, ...shown.filter((note) => note.noteId !== pinned.noteId)];
  const selectable = filter === "new" || filter === "triaged";
  const chosenNotes = ordered.filter((note) => selected.has(note.noteId));
  const allCounted = page === undefined ? 0 : Object.values(page.counts).reduce((a, b) => a + b, 0);

  useEffect(() => {
    if (pinned === undefined) return;
    document.getElementById(`feedback-${pinned.noteId}`)?.scrollIntoView({ block: "center" });
  }, [pinned]);

  return (
    <section className="panel operator-section" aria-labelledby="operator-feedback">
      <h2 id="operator-feedback">{t`Feedback`}</h2>
      <LoadProblem state={state} />
      {page === undefined ? null : (
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
                  onFilter?.(status);
                  setSelected(new Set());
                }}
              >
                {feedbackStatusLabel(status)} {page.counts[status]}
              </button>
            ))}
          </fieldset>
          {onSearch === undefined ? null : (
            <ListSearch
              label={t`Search the text, page or kind`}
              query={query}
              onSearch={(next) => {
                setSelected(new Set());
                onSearch(next);
              }}
            />
          )}
          {problem === undefined ? null : (
            <p className="problem" role="alert">
              {problem}
            </p>
          )}
          {onTriage !== undefined && selectable && ordered.length > 0 ? (
            <div className="actions operator-bulk">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setSelected(
                    chosenNotes.length === ordered.length
                      ? new Set()
                      : new Set(ordered.map((note) => note.noteId)),
                  )
                }
              >
                {chosenNotes.length === ordered.length
                  ? t`Select none`
                  : t`Select all shown (${ordered.length})`}
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
          {ordered.length === 0 ? (
            <p className="muted">
              {query.trim() !== ""
                ? t`No note matches this search.`
                : allCounted === 0
                  ? t`No feedback yet.`
                  : t`Nothing here.`}
            </p>
          ) : (
            <>
              <ul className="operator-list">
                {ordered.map((note) => (
                  <li key={note.noteId}>
                    <FeedbackItem
                      note={note}
                      busy={busy?.has(note.noteId) ?? false}
                      selectable={selectable}
                      selected={selected.has(note.noteId)}
                      highlighted={note.noteId === pinned?.noteId}
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
              <ListMore
                shown={shown.length}
                total={page.counts[filter]}
                loading={loadingMore}
                problem={moreProblem}
                onMore={onMore}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

/** The operator page's parts; one shows at a time, so a long list never hides the others. */
export type OperatorView = "feedback" | "waitlist" | "invites";

export interface OperatorPageProps {
  readonly client: ApiClient;
  /** Back to the person's own work. */
  readonly onClose: () => void;
  /** The feedback note the page address names (`#operator/feedback/<noteId>`), shown first. */
  readonly focusNoteId?: string | undefined;
  /** The part shown first; Feedback when absent. */
  readonly initialView?: OperatorView | undefined;
}

const sizeOf = {
  waitlist: (page: WaitlistPage) => page.entries.length,
  invites: (page: InviteList) => page.invites.length,
  feedback: (page: FeedbackPage) => page.notes.length,
};

const mergeOf = {
  waitlist: (shown: WaitlistPage, next: WaitlistPage): WaitlistPage => ({
    ...next,
    entries: appendUnique(shown.entries, next.entries, (entry) => entry.entryId),
  }),
  invites: (shown: InviteList, next: InviteList): InviteList => ({
    ...next,
    invites: appendUnique(shown.invites, next.invites, (invite) => invite.inviteId),
  }),
  feedback: (shown: FeedbackPage, next: FeedbackPage): FeedbackPage => ({
    ...next,
    notes: appendUnique(shown.notes, next.notes, (note) => note.noteId),
  }),
};

/**
 * The operator's page (#2829): members' feedback, the beta waitlist, and the invites with the
 * account cap, one part at a time and each read a page at a time (#3016). Reached only by the
 * owner token or an operator's sign-in with a second factor.
 */
export function OperatorPage({
  client,
  onClose,
  focusNoteId,
  initialView = "feedback",
}: OperatorPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<OperatorView>(initialView);
  const [waitlistQuery, setWaitlistQuery] = useState("");
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteFilter, setInviteFilter] = useState<InviteState | undefined>(undefined);
  const [feedbackQuery, setFeedbackQuery] = useState("");
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackStatus>("new");
  const [focusNote, setFocusNote] = useState<FeedbackNote | undefined>(undefined);
  const [inviting, setInviting] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<InviteOutcome | undefined>(undefined);
  const [triaging, setTriaging] = useState<ReadonlySet<string>>(new Set());
  const [triageProblem, setTriageProblem] = useState<string | undefined>(undefined);

  const waitlist = usePagedList(
    useCallback(
      (offset: number) => readWaitlist(client, { offset, query: waitlistQuery }),
      [client, waitlistQuery],
    ),
    mergeOf.waitlist,
    sizeOf.waitlist,
  );
  const invites = usePagedList(
    useCallback(
      (offset: number) => readInvites(client, { offset, query: inviteQuery, state: inviteFilter }),
      [client, inviteQuery, inviteFilter],
    ),
    mergeOf.invites,
    sizeOf.invites,
  );
  const feedback = usePagedList(
    useCallback(
      (offset: number) =>
        readFeedback(client, { offset, query: feedbackQuery, status: feedbackFilter }),
      [client, feedbackQuery, feedbackFilter],
    ),
    mergeOf.feedback,
    sizeOf.feedback,
  );
  const updateFeedback = feedback.update;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // The address names one note: read it wherever it sits, and open its tab.
  useEffect(() => {
    if (focusNoteId === undefined) return;
    let current = true;
    void readFeedbackNote(client, focusNoteId).then((note) => {
      if (!current || note === undefined) return;
      setFocusNote(note);
      setFeedbackFilter(note.status);
      setView("feedback");
    });
    return () => {
      current = false;
    };
  }, [client, focusNoteId]);

  const triage = useCallback(
    async (notes: readonly FeedbackNote[], next: FeedbackTriage) => {
      const ids = notes.map((note) => note.noteId);
      setTriageProblem(undefined);
      setTriaging((previous) => new Set([...previous, ...ids]));
      const results = await Promise.all(
        notes.map((note) => triageFeedback(client, note.noteId, next)),
      );
      const moved = results.flatMap((result) => (result.kind === "triaged" ? [result.note] : []));
      const before = new Map(notes.map((note) => [note.noteId, note.status]));
      // A triaged note leaves the tab it was in; the counts follow it.
      updateFeedback((page) => ({
        ...page,
        notes: page.notes.filter(
          (note) =>
            !moved.some((done) => done.noteId === note.noteId && done.status !== note.status),
        ),
        counts: movedCounts(
          page.counts,
          moved.map((note) => ({ from: before.get(note.noteId) ?? note.status, to: note.status })),
        ),
      }));
      setFocusNote((previous) =>
        previous === undefined
          ? previous
          : (moved.find((note) => note.noteId === previous.noteId) ?? previous),
      );
      const failed = results.find((result) => result.kind === "failed");
      if (failed?.kind === "failed") setTriageProblem(failed.message);
      setTriaging((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
    },
    [client, updateFeedback],
  );

  function requestInvite(entry: WaitlistEntry) {
    setOutcome(undefined);
    if (invites.state.kind === "ready" && inviteGoesPastCap(invites.state.value)) {
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
    if (result.kind === "invited") await Promise.all([waitlist.reload(), invites.reload()]);
  }

  const counts = {
    feedback: feedback.state.kind === "ready" ? feedback.state.value.counts.new : undefined,
    waitlist:
      waitlist.state.kind === "ready" && waitlistQuery === ""
        ? waitlist.state.value.total
        : undefined,
    invites: invites.state.kind === "ready" ? invites.state.value.open : undefined,
  };
  const viewLabel: Record<OperatorView, string> = {
    feedback: t`Feedback`,
    waitlist: t`Waitlist`,
    invites: t`Invites`,
  };
  const countLabel: Record<OperatorView, (count: number) => string> = {
    feedback: (count) => t`${count} new`,
    waitlist: (count) => t`${count} waiting`,
    invites: (count) => t`${count} not used yet`,
  };

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
        {t`What members tell you, the beta's waitlist and its invites. Each invite is written to the audit log.`}
      </p>
      <nav className="operator-views" aria-label={t`Operator sections`}>
        {(["feedback", "waitlist", "invites"] as const).map((part) => {
          const count = counts[part];
          return (
            <button
              key={part}
              type="button"
              className={part === view ? undefined : "secondary"}
              aria-pressed={part === view}
              onClick={() => setView(part)}
            >
              {viewLabel[part]}
              {count === undefined ? null : (
                <span className="operator-view-count"> · {countLabel[part](count)}</span>
              )}
            </button>
          );
        })}
      </nav>
      {view === "waitlist" ? (
        <WaitlistSection
          state={waitlist.state}
          seats={invites.state.kind === "ready" ? invites.state.value : undefined}
          inviting={inviting}
          confirming={confirming}
          outcome={outcome}
          onInvite={requestInvite}
          onConfirm={(entry) => void invite(entry)}
          onCancel={() => setConfirming(undefined)}
          query={waitlistQuery}
          onSearch={setWaitlistQuery}
          onMore={() => void waitlist.more()}
          loadingMore={waitlist.loadingMore}
          moreProblem={waitlist.moreProblem}
        />
      ) : view === "invites" ? (
        <InvitesSection
          state={invites.state}
          filter={inviteFilter}
          onFilter={setInviteFilter}
          query={inviteQuery}
          onSearch={setInviteQuery}
          onMore={() => void invites.more()}
          loadingMore={invites.loadingMore}
          moreProblem={invites.moreProblem}
        />
      ) : (
        <FeedbackSection
          state={feedback.state}
          filter={feedbackFilter}
          onFilter={setFeedbackFilter}
          focusNote={focusNote}
          busy={triaging}
          problem={triageProblem}
          onTriage={(note, next) => void triage([note], next)}
          onCloseMany={(notes) => void triage(notes, { status: "closed" })}
          query={feedbackQuery}
          onSearch={setFeedbackQuery}
          onMore={() => void feedback.more()}
          loadingMore={feedback.loadingMore}
          moreProblem={feedback.moreProblem}
        />
      )}
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
