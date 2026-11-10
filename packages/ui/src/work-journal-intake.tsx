import { t } from "@lingui/core/macro";
import { useState } from "react";

import { pendingNoteCountLimit } from "./work-journal-pending.js";

/**
 * The "Accept notes from agents" switch in Workspace settings → Agents (#2625). It decides what
 * agents may do, so it sits with the agent setup; the notes themselves wait for review in the
 * Work journal on the Career evidence page, which the link opens.
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
}

/** The link's words for a count of waiting notes. */
export function reviewNotesLabel(pending: number | undefined): string {
  if (pending === undefined || pending <= 0) return t`Review notes`;
  return pending >= pendingNoteCountLimit
    ? t`Review notes (${pendingNoteCountLimit} or more waiting)`
    : t`Review notes (${pending} waiting)`;
}

export function WorkJournalIntake({ enabled, pending, onSet, onReview }: WorkJournalIntakeProps) {
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    setSaving(true);
    setProblem(await onSet(next));
    setSaving(false);
  }

  return (
    <div className="work-journal-intake">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={enabled === undefined || saving}
          onChange={(event) => void toggle(event.target.checked)}
        />{" "}
        {t`Accept notes from agents`}
      </label>
      <p className="muted">
        {t`Agents can record notable work you shipped in your Work journal. Nothing becomes career evidence until you approve it.`}{" "}
        {onReview === undefined ? null : (
          <button type="button" className="link-action" onClick={onReview}>
            {reviewNotesLabel(pending)}
          </button>
        )}
      </p>
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
