/**
 * One page of an operator list (#3015): the feedback inbox, the waitlist and the beta invites
 * grow to hundreds of rows, so the operator reads them a page at a time and searches them.
 */
export interface OperatorListPage {
  /** At most this many rows; clamped to 1–500, 50 when absent. */
  readonly limit?: number;
  /** Rows to skip from the start of the order; 0 when absent. */
  readonly offset?: number;
  /** Case-insensitive text the row must contain; blank means no search. */
  readonly query?: string;
}

/** The longest search the lists accept; longer text is cut. */
export const operatorSearchMaxLength = 200;

export function pageLimit(page: OperatorListPage | undefined, fallback = 50): number {
  const limit = page?.limit ?? fallback;
  return Math.max(1, Math.min(500, Math.trunc(Number.isFinite(limit) ? limit : fallback)));
}

export function pageOffset(page: OperatorListPage | undefined): number {
  const offset = page?.offset ?? 0;
  return Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
}

/**
 * The ILIKE pattern for a search, with `%`, `_` and `\` escaped so the text matches literally;
 * undefined for a blank search.
 */
export function searchPattern(query: string | undefined): string | undefined {
  const text = query?.trim().slice(0, operatorSearchMaxLength) ?? "";
  if (text.length === 0) return undefined;
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
