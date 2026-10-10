import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { OpportunityRecordResult, OpportunitySourceResult } from "./bridge.js";
import {
  acknowledgeIssue,
  type BriefEditState,
  type BriefOperationOutcome,
  type BriefOperations,
  briefEditProblem,
  createBriefEditState,
  dropRequirement,
  editRequirementText,
  hasUnsavedBriefChanges,
  loadBrief,
  maximumRequirementTextLength,
  type RequirementDraft,
  type RequirementPriority,
  requirementPriorityLabel,
  requirementPriorityOptions,
  restoreRequirement,
  reviewBlockers,
  reviewBrief,
  saveBriefEdits,
  setRequirementPriority,
} from "./opportunity-brief-review-model.js";
import { useModalFocusTrap } from "./review.js";

const classificationLabels: Readonly<Record<string, string>> = {
  "job-posting": "Job posting",
  "social-announcement": "Social announcement",
  "company-context": "Company context",
  "candidate-instruction": "Your instructions",
};

/** A source reference a person can read: what kind of material it is, and its id. */
export function describeBriefSource(
  sources: readonly OpportunitySourceResult[],
  sourceId: string,
): string {
  const source = sources.find((candidate) => candidate.id === sourceId);
  const label = source === undefined ? undefined : classificationLabels[source.classification];
  return label === undefined ? sourceId : `${label} (${sourceId})`;
}

export type BriefLoad = "loading" | "failed" | "ready";

export interface BriefNotice {
  readonly kind: "conflict" | "failed";
  readonly message: string;
}

export interface OpportunityBriefReviewViewProps {
  readonly load: BriefLoad;
  readonly loadMessage?: string | null;
  readonly record: OpportunityRecordResult | null;
  /** Staged edits; `null` shows the version read-only. */
  readonly edit: BriefEditState | null;
  readonly busy: "saving" | "reviewing" | null;
  readonly notice?: BriefNotice | null;
  readonly discardArmed?: boolean;
  readonly onText: (id: string, text: string) => void;
  readonly onPriority: (id: string, priority: RequirementPriority) => void;
  readonly onDrop: (id: string) => void;
  readonly onRestore: (id: string) => void;
  readonly onAcknowledge: (id: string) => void;
  readonly onSave: () => void;
  readonly onReview: () => void;
  readonly onStartEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onClose: () => void;
  readonly onRetry?: () => void;
  readonly dialogRef?: RefObject<HTMLDivElement | null>;
}

/** The verified job-text quotation behind an extracted entry; nothing renders without one. */
function BriefExcerpt({ excerpt }: { readonly excerpt: string | undefined }) {
  if (excerpt === undefined) return null;
  return (
    <figure className="brief-excerpt">
      <figcaption className="brief-excerpt-label">From the job text</figcaption>
      <blockquote className="brief-excerpt-quote">{excerpt}</blockquote>
    </figure>
  );
}

function RequirementRow({
  requirement,
  index,
  record,
  editing,
  busy,
  onText,
  onPriority,
  onDrop,
  onRestore,
}: {
  readonly requirement: RequirementDraft;
  readonly index: number;
  readonly record: OpportunityRecordResult;
  readonly editing: boolean;
  readonly busy: boolean;
  readonly onText: OpportunityBriefReviewViewProps["onText"];
  readonly onPriority: OpportunityBriefReviewViewProps["onPriority"];
  readonly onDrop: OpportunityBriefReviewViewProps["onDrop"];
  readonly onRestore: OpportunityBriefReviewViewProps["onRestore"];
}) {
  const position = index + 1;
  const sources = requirement.sourceIds.map((id) => describeBriefSource(record.sources, id));
  return (
    <li className="brief-item" data-dropped={requirement.dropped ? "true" : "false"}>
      <div className="brief-item-head">
        <span className={`brief-priority brief-priority-${requirement.priority}`}>
          {requirementPriorityLabel(requirement.priority)}
        </span>
        {requirement.dropped ? <span className="brief-dropped-tag">Dropped</span> : null}
      </div>
      {editing && !requirement.dropped ? (
        <textarea
          className="brief-item-text"
          value={requirement.text}
          maxLength={maximumRequirementTextLength + 200}
          disabled={busy}
          aria-label={`Requirement ${position} text`}
          onChange={(event) => onText(requirement.id, event.target.value)}
        />
      ) : (
        <p className="brief-item-copy">{requirement.text}</p>
      )}
      <BriefExcerpt excerpt={requirement.excerpt} />
      <p className="brief-source">
        <span>Source</span> {sources.join(", ")}
      </p>
      {editing ? (
        <div className="brief-item-actions">
          {requirement.dropped ? null : (
            <label className="brief-priority-field">
              <span>Priority</span>
              <select
                value={requirement.priority}
                disabled={busy}
                aria-label={`Requirement ${position} priority`}
                onChange={(event) =>
                  onPriority(requirement.id, event.target.value as RequirementPriority)
                }
              >
                {requirementPriorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {requirement.dropped ? (
            <button
              className="button button-outline"
              type="button"
              disabled={busy}
              aria-label={`Restore requirement ${position}`}
              onClick={() => onRestore(requirement.id)}
            >
              Restore
            </button>
          ) : (
            <button
              className="button button-quiet"
              type="button"
              disabled={busy}
              aria-label={`Drop requirement ${position}`}
              onClick={() => onDrop(requirement.id)}
            >
              Drop
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function OpportunityBriefReviewView(props: OpportunityBriefReviewViewProps) {
  const {
    load,
    loadMessage,
    record,
    edit,
    busy,
    notice = null,
    discardArmed = false,
    onAcknowledge,
    onSave,
    onReview,
    onStartEdit,
    onCancelEdit,
    onClose,
    onRetry,
    dialogRef,
  } = props;
  const reviewed = record?.status === "reviewed";
  const editing = edit !== null;
  const dirty = record !== null && edit !== null && hasUnsavedBriefChanges(record, edit);
  const problem = edit === null ? null : briefEditProblem(edit);
  const blockers = record === null ? [] : reviewBlockers(record);
  const pending = busy !== null;
  const openIssues = record?.issues.filter((issue) => issue.status === "open") ?? [];
  const requirements: readonly RequirementDraft[] =
    edit !== null
      ? edit.requirements
      : (record?.requirements.map((requirement) => ({ ...requirement, dropped: false })) ?? []);
  return (
    <div className="modal-backdrop">
      <div
        className="modal-card brief-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brief-review-title"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">DraftLoop / Opportunity brief</p>
            <h2 id="brief-review-title">Review requirements</h2>
          </div>
          <button className="button button-quiet" type="button" onClick={onClose}>
            {discardArmed ? "Discard changes" : "Close"}
            <kbd>Esc</kbd>
          </button>
        </div>
        {load === "loading" ? (
          <p className="setup-note" role="status">
            Loading the brief…
          </p>
        ) : null}
        {load === "failed" ? (
          <>
            <p className="setup-blocker" role="alert">
              {loadMessage ?? "The brief could not be loaded."}
            </p>
            <div className="approval-actions">
              <button
                className="button button-outline"
                type="button"
                disabled={onRetry === undefined}
                onClick={() => onRetry?.()}
              >
                Try again
              </button>
            </div>
          </>
        ) : null}
        {load === "ready" && record !== null ? (
          <div className="brief-body">
            <p className="modal-copy" id="brief-review-copy">
              {reviewed
                ? editing
                  ? `Editing reviewed version ${record.version}. Saving creates a new draft; this reviewed version stays unchanged and must be reviewed again before a run uses the new one.`
                  : `Reviewed version ${record.version}. It is read-only; a run can use it. Edit creates a new draft you review again.`
                : `Draft version ${record.version}. Each save creates the next draft. Mark it reviewed before a run uses it.`}
            </p>
            <p className="brief-version" role="status">
              <span className="status-badge">
                {reviewed ? `Reviewed v${record.version}` : `Draft v${record.version}`}
              </span>
              <code>{record.briefId}</code>
            </p>
            <dl className="brief-facts">
              <div>
                <dt>Role</dt>
                <dd>{record.role?.value ?? "Not found in the job description"}</dd>
              </div>
              <div>
                <dt>Employer</dt>
                <dd>{record.employer?.value ?? "Not found in the job description"}</dd>
              </div>
            </dl>
            {record.sources.some((source) => source.textOrigin === "job-posting-json-ld") ? (
              <p className="setup-note">Read from the page's job posting data.</p>
            ) : null}
            {notice === null ? null : (
              <p className="error-banner" role="alert">
                {notice.message}
              </p>
            )}
            <section aria-labelledby="brief-requirements-title">
              <h3 className="brief-heading" id="brief-requirements-title">
                Requirements ({requirements.filter((requirement) => !requirement.dropped).length})
              </h3>
              {requirements.length === 0 ? (
                <p className="setup-note">This brief has no requirements.</p>
              ) : (
                <ul className="brief-list">
                  {requirements.map((requirement, index) => (
                    <RequirementRow
                      key={requirement.id}
                      requirement={requirement}
                      index={index}
                      record={record}
                      editing={editing}
                      busy={pending}
                      onText={props.onText}
                      onPriority={props.onPriority}
                      onDrop={props.onDrop}
                      onRestore={props.onRestore}
                    />
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="brief-responsibilities-title">
              <h3 className="brief-heading" id="brief-responsibilities-title">
                Responsibilities ({record.responsibilities.length})
              </h3>
              {record.responsibilities.length === 0 ? (
                <p className="setup-note">This brief has no responsibilities.</p>
              ) : (
                <ul className="brief-list">
                  {record.responsibilities.map((responsibility) => (
                    <li className="brief-item" key={responsibility.id}>
                      <p className="brief-item-copy">{responsibility.text}</p>
                      <BriefExcerpt excerpt={responsibility.excerpt} />
                      <p className="brief-source">
                        <span>Source</span>{" "}
                        {responsibility.sourceIds
                          .map((id) => describeBriefSource(record.sources, id))
                          .join(", ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {openIssues.length === 0 ? null : (
              <section aria-labelledby="brief-issues-title">
                <h3 className="brief-heading" id="brief-issues-title">
                  Open issues ({openIssues.length})
                </h3>
                <ul className="brief-list">
                  {openIssues.map((issue) => {
                    const acknowledged = edit?.acknowledgedIssueIds.includes(issue.id) === true;
                    return (
                      <li className="brief-item" key={issue.id}>
                        <p className="brief-item-copy">
                          <strong>{issue.severity === "error" ? "Problem" : "Warning"}:</strong>{" "}
                          {issue.message}
                        </p>
                        {editing ? (
                          <div className="brief-item-actions">
                            <button
                              className="button button-outline"
                              type="button"
                              disabled={pending || acknowledged}
                              onClick={() => onAcknowledge(issue.id)}
                            >
                              {acknowledged ? "Will acknowledge on save" : "Acknowledge"}
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {problem === null ? null : (
              <p className="setup-blocker" role="alert">
                {problem}
              </p>
            )}
            {!reviewed && !dirty && blockers.length > 0 ? (
              <ul className="brief-blockers" aria-label="Before this can be reviewed">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : null}
            {dirty && !reviewed ? (
              <p className="setup-note" role="status">
                You have unsaved changes. Save them before marking the brief reviewed.
              </p>
            ) : null}
            {discardArmed ? (
              <p className="setup-note" role="status">
                You have unsaved changes. Choose Discard changes to close without saving.
              </p>
            ) : null}
            <div className="approval-actions">
              {reviewed && !editing ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={pending}
                  onClick={onStartEdit}
                >
                  Edit
                </button>
              ) : (
                <>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={pending || !dirty || problem !== null}
                    onClick={onSave}
                  >
                    {busy === "saving"
                      ? "Saving…"
                      : reviewed
                        ? "Save as new draft"
                        : "Save changes"}
                  </button>
                  {reviewed ? (
                    <button
                      className="button button-quiet"
                      type="button"
                      disabled={pending}
                      onClick={onCancelEdit}
                    >
                      Cancel editing
                    </button>
                  ) : (
                    <button
                      className="button button-outline"
                      type="button"
                      disabled={pending || dirty || blockers.length > 0}
                      onClick={onReview}
                    >
                      {busy === "reviewing" ? "Marking reviewed…" : "Mark reviewed"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface OpportunityBriefReviewProps {
  readonly briefId: string;
  readonly operations: BriefOperations;
  /** Called after a save or review so the workspace can pick up the new version. */
  readonly onBriefChanged?: () => void;
  readonly onClose: () => void;
}

/** Loads the latest version of a brief, stages edits, and saves or reviews through the host. */
export function OpportunityBriefReview({
  briefId,
  operations,
  onBriefChanged,
  onClose,
}: OpportunityBriefReviewProps) {
  const [load, setLoad] = useState<BriefLoad>("loading");
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [record, setRecord] = useState<OpportunityRecordResult | null>(null);
  const [edit, setEdit] = useState<BriefEditState | null>(null);
  const [busy, setBusy] = useState<"saving" | "reviewing" | null>(null);
  const [notice, setNotice] = useState<BriefNotice | null>(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const changedRef = useRef(onBriefChanged);
  changedRef.current = onBriefChanged;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const show = useCallback((next: OpportunityRecordResult) => {
    setRecord(next);
    setEdit(next.status === "draft" ? createBriefEditState(next) : null);
    setDiscardArmed(false);
  }, []);

  // `attempt` re-runs the load when the person retries.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is the trigger, not a value read
  useEffect(() => {
    let cancelled = false;
    setLoad("loading");
    void loadBrief(operationsRef.current, briefId).then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === "done") {
        show(outcome.record);
        setLoad("ready");
      } else {
        setLoadMessage(outcome.message);
        setLoad("failed");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [briefId, attempt, show]);

  const dirty = record !== null && edit !== null && hasUnsavedBriefChanges(record, edit);
  const requestClose = useCallback(() => {
    if (busy !== null) return;
    if (dirty && !discardArmed) {
      setDiscardArmed(true);
      return;
    }
    onClose();
  }, [busy, dirty, discardArmed, onClose]);
  useModalFocusTrap(true, dialogRef, requestClose);

  const stage = (change: (state: BriefEditState) => BriefEditState) => {
    setEdit((current) => (current === null ? current : change(current)));
    setNotice(null);
    setDiscardArmed(false);
  };

  const settle = (outcome: BriefOperationOutcome) => {
    if (!mounted.current) return;
    setBusy(null);
    if (outcome.kind === "done") {
      setNotice(null);
      show(outcome.record);
      changedRef.current?.();
      return;
    }
    setNotice({ kind: outcome.kind, message: outcome.message });
    if (outcome.kind === "conflict") {
      // Reload the latest version; the staged edits were made against an older one.
      void loadBrief(operationsRef.current, briefId).then((reloaded) => {
        if (mounted.current && reloaded.kind === "done") show(reloaded.record);
      });
    }
  };

  const save = () => {
    if (busy !== null || record === null || edit === null) return;
    setBusy("saving");
    setNotice(null);
    void saveBriefEdits(operationsRef.current, record, edit).then(settle);
  };

  const review = () => {
    if (busy !== null || record === null) return;
    setBusy("reviewing");
    setNotice(null);
    void reviewBrief(operationsRef.current, record).then(settle);
  };

  return (
    <OpportunityBriefReviewView
      load={load}
      loadMessage={loadMessage}
      record={record}
      edit={edit}
      busy={busy}
      notice={notice}
      discardArmed={discardArmed}
      onText={(id, text) => stage((state) => editRequirementText(state, id, text))}
      onPriority={(id, priority) => stage((state) => setRequirementPriority(state, id, priority))}
      onDrop={(id) => stage((state) => dropRequirement(state, id))}
      onRestore={(id) => stage((state) => restoreRequirement(state, id))}
      onAcknowledge={(id) => stage((state) => acknowledgeIssue(state, id))}
      onSave={save}
      onReview={review}
      onStartEdit={() => {
        if (record !== null) setEdit(createBriefEditState(record));
        setNotice(null);
      }}
      onCancelEdit={() => {
        setEdit(null);
        setNotice(null);
        setDiscardArmed(false);
      }}
      onClose={requestClose}
      onRetry={() => setAttempt((value) => value + 1)}
      dialogRef={dialogRef}
    />
  );
}

export interface OpportunityBriefReviewActionProps {
  readonly briefId: string;
  readonly operations: BriefOperations;
  readonly onBriefChanged?: () => void;
  readonly disabled?: boolean;
  readonly label?: string;
}

/** The "Review requirements" button and the dialog it opens. */
export function OpportunityBriefReviewAction({
  briefId,
  operations,
  onBriefChanged,
  disabled = false,
  label = "Review requirements",
}: OpportunityBriefReviewActionProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        className="button button-outline"
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {/* Portalled out of the setup card so no ancestor's layout can contain the fixed backdrop. */}
      {open && typeof document !== "undefined"
        ? createPortal(
            <OpportunityBriefReview
              briefId={briefId}
              operations={operations}
              {...(onBriefChanged === undefined ? {} : { onBriefChanged })}
              onClose={close}
            />,
            document.body,
          )
        : null}
    </>
  );
}
