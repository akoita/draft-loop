import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";

import { type ApiClient, ApiRequestError, describeError } from "./api-client.js";
import { useRecordId } from "./record-context.js";
import { useCanRelease } from "./screening-access.js";
import {
  type Badge,
  materialName,
  maximumReleaseReasonLength,
  type QuarantinedMaterial,
  type QuarantineRefusal,
  quarantinedStatus,
  releaseScreening,
  type ScreeningStatus,
  screeningBadge,
} from "./screening-model.js";

export interface ScreeningState {
  /** The record's latest statuses; undefined until read, or when this service does not screen. */
  readonly statuses: readonly ScreeningStatus[] | undefined;
  /** Why the statuses could not be read, if they could not. */
  readonly problem: string | undefined;
  readonly reload: () => Promise<void>;
}

/** Reads the record's injection screening status, and again when `reload` is called. */
export function useScreening(client: ApiClient): ScreeningState {
  const workspaceId = useRecordId();
  const [statuses, setStatuses] = useState<readonly ScreeningStatus[] | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const read = await client.call("GET /v1/workspaces/{workspaceId}/screening", {
        path: { workspaceId },
      });
      setStatuses(read.statuses);
      setProblem(undefined);
    } catch (error) {
      // A service without screening has no such route; that is not a problem to show.
      if (!(error instanceof ApiRequestError && error.status === 404))
        setProblem(`The screening status could not be read. ${describeError(error)}`);
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { statuses, problem, reload };
}

/** The status as text first, with the reason beside it; colour only adds to it. */
export function ScreeningBadge({ badge }: { readonly badge: Badge }) {
  return (
    <span className={`screening screening-${badge.kind}`}>
      <span className="screening-label">{badge.label}</span>
      {badge.detail === "" ? null : <span className="screening-detail"> {badge.detail}</span>}
    </span>
  );
}

export interface ScreeningNoteProps {
  readonly client: ApiClient;
  /** The screened text's status; none means it was never screened. */
  readonly status: ScreeningStatus | undefined;
  /** What a release dialog calls the text, such as `career.md`. */
  readonly subject: string;
  /** Called once the text was released, so the screen reads the statuses again. */
  readonly onReleased: () => void;
}

/** A source's or brief's status badge, with a release button for owners and admins. */
export function ScreeningNote({ client, status, subject, onReleased }: ScreeningNoteProps) {
  const badge = screeningBadge(status);
  const canRelease = useCanRelease();
  return (
    <span className="screening-note">
      <ScreeningBadge badge={badge} />
      {badge.quarantined && status !== undefined && canRelease ? (
        <ReleaseControl
          client={client}
          resultId={status.resultId}
          subject={subject}
          signals={badge.detail}
          onReleased={onReleased}
        />
      ) : null}
    </span>
  );
}

export interface BriefScreeningProps {
  readonly client: ApiClient;
  /** The statuses of the shown brief's job sources; none means it was not screened. */
  readonly statuses: readonly ScreeningStatus[];
  readonly onReleased: () => void;
}

/** The job brief's screening status, one line per screened source. */
export function BriefScreening({ client, statuses, onReleased }: BriefScreeningProps) {
  const shown = statuses.length === 0 ? [undefined] : statuses;
  return (
    <div className="screening-line">
      {shown.map((status) => (
        <ScreeningNote
          key={status?.resultId ?? "none"}
          client={client}
          status={status}
          subject="the job brief"
          onReleased={onReleased}
        />
      ))}
    </div>
  );
}

interface ReleaseControlProps {
  readonly client: ApiClient;
  readonly resultId: string;
  readonly subject: string;
  /** The signals found, in words. */
  readonly signals: string;
  readonly onReleased: () => void;
}

/** The release button and the dialog it opens; owners and admins only. */
export function ReleaseControl({
  client,
  resultId,
  subject,
  signals,
  onReleased,
}: ReleaseControlProps) {
  const workspaceId = useRecordId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Back to the button that opened the dialog once it closes.
  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

  async function release(reason: string) {
    setBusy(true);
    const refused = await releaseScreening(client, workspaceId, resultId, reason);
    setBusy(false);
    setProblem(refused);
    if (refused === undefined) {
      setOpen(false);
      onReleased();
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="secondary"
        aria-haspopup="dialog"
        onClick={() => {
          setProblem(undefined);
          setOpen(true);
        }}
      >
        Release {subject}
      </button>
      {open ? (
        <ReleaseDialog
          subject={subject}
          signals={signals}
          busy={busy}
          problem={problem}
          onSubmit={(reason) => void release(reason)}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export interface ReleaseDialogProps {
  readonly subject: string;
  readonly signals: string;
  readonly busy: boolean;
  readonly problem: string | undefined;
  /** Called with the reason the person typed. */
  readonly onSubmit: (reason: string) => void;
  readonly onCancel: () => void;
}

/**
 * The modal that asks why quarantined text is let through. It is mounted when opened, so it shows
 * itself then; the browser keeps focus inside it and closes it on Escape.
 */
export function ReleaseDialog({
  subject,
  signals,
  busy,
  problem,
  onSubmit,
  onCancel,
}: ReleaseDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && typeof element.showModal === "function" && !element.open)
      element.showModal();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(reason);
  }

  return (
    <dialog
      ref={dialog}
      className="release-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={submit}>
        <h3 id={`${id}-title`}>Release {subject}</h3>
        <p>
          Screening held this text back
          {signals === "" ? "" : ` (${signals})`}. Releasing lets runs use it. The release covers
          this screening result only and is recorded with your name and your reason.
        </p>
        <label htmlFor={`${id}-reason`}>Reason for releasing</label>
        <textarea
          id={`${id}-reason`}
          value={reason}
          required
          maxLength={maximumReleaseReasonLength}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setReason(event.target.value)}
        />
        <p id={`${id}-hint`} className="muted">
          Required, up to {maximumReleaseReasonLength} characters. Say why the text is safe; do not
          paste the text itself.
        </p>
        {problem === undefined ? null : (
          <p className="problem" role="alert">
            {problem}
          </p>
        )}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? "Releasing…" : "Release"}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

export interface QuarantineRefusalPanelProps {
  readonly client: ApiClient;
  readonly refusal: QuarantineRefusal;
}

/**
 * Why a run was refused: what is quarantined, and for owners and admins a way to release each
 * piece. Released pieces stay listed as released until the person starts the run again.
 */
export function QuarantineRefusalPanel({ client, refusal }: QuarantineRefusalPanelProps) {
  const [released, setReleased] = useState<ReadonlySet<string>>(new Set());
  const canRelease = useCanRelease();
  const allReleased = refusal.items.every((item) => released.has(item.resultId));
  return (
    <QuarantineList
      client={client}
      message={refusal.message}
      items={refusal.items}
      released={released}
      canRelease={canRelease}
      allReleased={allReleased}
      onReleased={(resultId) => setReleased((current) => new Set(current).add(resultId))}
    />
  );
}

interface QuarantineListProps {
  readonly client: ApiClient;
  readonly message: string;
  readonly items: readonly QuarantinedMaterial[];
  readonly released: ReadonlySet<string>;
  readonly canRelease: boolean;
  readonly allReleased: boolean;
  readonly onReleased: (resultId: string) => void;
}

/** The presentational part of the refusal, so a test can show each state. */
export function QuarantineList({
  client,
  message,
  items,
  released,
  canRelease,
  allReleased,
  onReleased,
}: QuarantineListProps) {
  return (
    <div className="quarantine-refusal">
      <p className="problem" role="alert">
        {message}
      </p>
      <ul className="quarantined">
        {items.map((item) => {
          const done = released.has(item.resultId);
          const status = quarantinedStatus(item);
          return (
            <li key={item.resultId}>
              <strong>{materialName(item)}</strong>{" "}
              {done ? (
                <span className="screening screening-released">
                  <span className="screening-label">Released</span>
                </span>
              ) : (
                <>
                  <ScreeningBadge badge={screeningBadge(status)} />
                  {canRelease ? (
                    <ReleaseControl
                      client={client}
                      resultId={item.resultId}
                      subject={materialName(item).toLowerCase()}
                      signals={screeningBadge(status).detail}
                      onReleased={() => onReleased(item.resultId)}
                    />
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {allReleased ? (
        <p role="status">Everything is released. Start the run again.</p>
      ) : canRelease ? null : (
        <p className="muted">
          Only owners and admins of your organisation release quarantined material. Ask one of them,
          or replace the material.
        </p>
      )}
    </div>
  );
}
