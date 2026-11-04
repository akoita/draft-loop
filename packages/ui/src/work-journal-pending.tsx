/**
 * Home's reminder of work journal notes that wait for review (#2151). A note from a coding agent
 * waits at the bottom of the Career evidence page, so Home says how many wait and links there.
 */

/** The most notes one read counts; more show as "50 or more". */
export const pendingNoteCountLimit = 50;

/** The sentence for a count of waiting notes, or null when none wait. */
export function pendingNotesText(count: number): string | null {
  if (count <= 0) return null;
  if (count >= pendingNoteCountLimit) {
    return `${pendingNoteCountLimit} or more work journal notes wait for your review.`;
  }
  return count === 1
    ? "1 work journal note waits for your review."
    : `${count} work journal notes wait for your review.`;
}

export interface WorkJournalPendingProps {
  /** Notes waiting for review; undefined until read, and nothing shows until then. */
  readonly count: number | undefined;
  readonly onOpen: () => void;
}

export function WorkJournalPending({ count, onOpen }: WorkJournalPendingProps) {
  const text = count === undefined ? null : pendingNotesText(count);
  if (text === null) return null;
  return (
    <p className="home-card-copy work-journal-pending">
      {text}{" "}
      <button className="button button-quiet" type="button" onClick={onOpen}>
        Review notes
      </button>
    </p>
  );
}
