/** The longest note the API takes (#2828). */
export const maximumFeedbackLength = 2_000;

/** The counter shows once a note comes this close to the limit (#2876). */
export const feedbackCounterThreshold = 200;

/**
 * The characters left once the note nears the limit, or `undefined` while it is far from it, so
 * the dialog stays quiet for an ordinary note.
 */
export function feedbackCharactersLeft(length: number): number | undefined {
  const left = maximumFeedbackLength - length;
  return left <= feedbackCounterThreshold ? Math.max(left, 0) : undefined;
}

/**
 * The short reference a member can quote for a sent note (#2876): `FB-` and the first eight
 * characters of its id, in capitals. The operator's search finds the note by it.
 */
export function feedbackReference(noteId: string): string {
  return `FB-${noteId
    .replace(/[^A-Za-z0-9]/gu, "")
    .slice(0, 8)
    .toUpperCase()}`;
}
