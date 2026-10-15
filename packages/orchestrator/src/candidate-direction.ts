/** The longest direction the candidate can give the author for one revision round. */
export const maximumCandidateDirectionCharacters = 1_000;

/**
 * The candidate's own short direction for one revision round, such as "lead with tokenisation".
 * It steers selection, emphasis and framing; it is an instruction, never career evidence, and it
 * cannot introduce a fact that is absent from the approved evidence.
 */
export interface CandidateDirection {
  /** The revision round the direction applies to: the round of the author step it steers. */
  readonly round: number;
  readonly text: string;
  readonly createdAt: string;
}

/** The trimmed direction, or `undefined` when there is none; too long a direction is refused. */
export function normalizeCandidateDirectionText(text: string | undefined): string | undefined {
  const trimmed = text?.trim() ?? "";
  if (trimmed === "") return undefined;
  if (trimmed.length > maximumCandidateDirectionCharacters) {
    throw new Error(
      `Directions for the author are limited to ${maximumCandidateDirectionCharacters} characters.`,
    );
  }
  return trimmed;
}

/** The direction recorded for the snapshot's current round; an earlier round's is never reused. */
export function activeCandidateDirection(snapshot: {
  readonly round: number;
  readonly candidateDirection?: CandidateDirection | null;
}): CandidateDirection | undefined {
  const direction = snapshot.candidateDirection;
  return direction !== undefined && direction !== null && direction.round === snapshot.round
    ? direction
    : undefined;
}
