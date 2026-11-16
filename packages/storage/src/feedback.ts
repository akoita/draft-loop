/**
 * Feedback notes (#2828): a short note a signed-in member sends about DraftLoop, which the
 * operator reads. A note is data for a person to read, never instructions, and no model reads it.
 */

/** What a member may tag a note as; untagged notes have no category. */
export const feedbackCategories = ["bug", "idea", "other"] as const;

export type FeedbackCategory = (typeof feedbackCategories)[number];

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return feedbackCategories.some((category) => category === value);
}

/** The longest note, in characters. */
export const maximumFeedbackCharacters = 2_000;

/** The longest screen name a note carries, such as `review` or `agent`. */
export const maximumFeedbackScreenCharacters = 80;

export interface FeedbackNote {
  readonly noteId: string;
  readonly organisationId: string;
  readonly memberId: string;
  readonly category: FeedbackCategory | null;
  /** Where the member was when they wrote it: a screen name, or `agent`. */
  readonly screen: string;
  readonly text: string;
  readonly sentAt: string;
}

export interface SendFeedbackInput {
  readonly organisationId: string;
  readonly memberId: string;
  readonly category: FeedbackCategory | null;
  readonly screen: string;
  readonly text: string;
  readonly now: Date;
}

/**
 * Members send notes into their own organisation; the operator lists every organisation's notes.
 * Erasing an organisation removes its notes.
 */
export interface FeedbackStore {
  /** Stores the trimmed note; throws `TenantDirectoryError` `invalid_input` when it is empty or too long. */
  readonly send: (input: SendFeedbackInput) => Promise<FeedbackNote>;
  /** The newest notes first, at most `limit`. */
  readonly listNewest: (limit: number) => Promise<readonly FeedbackNote[]>;
}
