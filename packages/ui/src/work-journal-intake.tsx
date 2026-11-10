import { t } from "@lingui/core/macro";
import { useState } from "react";

import { pendingNoteCountLimit } from "./work-journal-pending.js";

/**
 * Whether agents may add work journal notes, in Workspace settings → Agents (#2625). It decides
 * what agents may do, so it sits with the agent setup; the notes themselves wait for review in
 * the Work journal on the Career evidence page, which the link opens.
 *
 * The row says the state in words and its button names what it does, so a stray click cannot
 * flip it unnoticed (#2629). Turning it off asks once, because the server then refuses an
 * agent's notes; turning it on does not, because every note still waits for approval.
 */

export interface WorkJournalIntakeProps {
  /** Whether notes from agents are accepted; undefined until read. */
  readonly enabled: boolean | undefined;
  /** Notes waiting for review; undefined until read. */
  readonly pending?: number | undefined;
  /** Resolves with a problem to show, or undefined once saved. */
  readonly onSet: (enabled: boolean) => Promise<string | undefined>;
  /** Opens the Work journal on the Career evidence page; no link without it. */
  readonly onReview?: (() => void) | undefined;
  /** Opens on the question asked before turning it off, such as to show it. */
  readonly confirmingStop?: boolean;
}

/** The link's words for a count of waiting notes. */
export function reviewNotesLabel(pending: number | undefined): string {
  if (pending === undefined || pending <= 0) return t`Review notes`;
  return pending >= pendingNoteCountLimit
    ? t`Review notes (${pendingNoteCountLimit} or more waiting)`
    : t`Review notes (${pending} waiting)`;
}

/** What stopping means for the notes that already wait. */
export function stopIntakeConsequence(pending: number | undefined): string {
  const refused = t`New notes from your agents will be refused until you turn this back on.`;
  if (pending === undefined || pending <= 0) return refused;
  const kept =
    pending === 1
      ? t`The note already waiting stays for review.`
      : t`The notes already waiting stay for review.`;
  return `${refused} ${kept}`;
}

export function WorkJournalIntake({
  enabled,
  pending,
  onSet,
  onReview,
  confirmingStop = false,
}: WorkJournalIntakeProps) {
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(confirmingStop);

  async function save(next: boolean) {
    setSaving(true);
    setProblem(await onSet(next));
    setSaving(false);
    setConfirming(false);
  }

  const alert =
    problem === undefined ? null : (
      <p className="problem" role="alert">
        {problem}
      </p>
    );

  if (enabled === true && confirming) {
    return (
      <div className="work-journal-intake work-journal-intake-confirm">
        <div>
          <p className="work-journal-intake-title">{t`Stop accepting notes from agents?`}</p>
          <p className="muted">{stopIntakeConsequence(pending)}</p>
          {alert}
        </div>
        <div className="work-journal-intake-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={saving}
            onClick={() => void save(false)}
          >
            {t`Stop accepting`}
          </button>
          <button
            type="button"
            className="button button-outline"
            disabled={saving}
            onClick={() => setConfirming(false)}
          >
            {t`Keep accepting`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="work-journal-intake">
      <div>
        <p className="work-journal-intake-title">
          {enabled === undefined ? null : (
            <span className={enabled ? "state-pill" : "status-tag"}>
              {enabled ? t`On` : t`Off`}
            </span>
          )}{" "}
          {t`Notes from agents`}
        </p>
        <p className="muted">
          {enabled === true
            ? t`Agents can add notes to your Work journal. Nothing becomes career evidence until you approve it.`
            : t`Agents cannot add notes to your Work journal. When they can, nothing becomes career evidence until you approve it.`}{" "}
          {onReview === undefined ? null : (
            <button type="button" className="link-action" onClick={onReview}>
              {reviewNotesLabel(pending)}
            </button>
          )}
        </p>
        {alert}
      </div>
      {enabled === true ? (
        <button
          type="button"
          className="button button-outline"
          disabled={saving}
          onClick={() => setConfirming(true)}
        >
          {t`Stop accepting notes`}
        </button>
      ) : (
        <button
          type="button"
          className="button button-primary"
          disabled={enabled === undefined || saving}
          onClick={() => void save(true)}
        >
          {t`Accept notes from agents`}
        </button>
      )}
    </div>
  );
}
