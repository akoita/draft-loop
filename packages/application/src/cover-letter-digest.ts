/**
 * Cover letter help in the daily digest (#3282): how the Cover letter tab's help was used that
 * day, across every organisation. Counts only: no letter, kit, sentence or id reaches the digest.
 */

/** One organisation's counts of a day, as the sweep reads them. */
export interface CoverLetterUseCounts {
  readonly kits: number;
  readonly fullDrafts: number;
  /** Applications with a cover letter version saved that day. */
  readonly letters: number;
  /** Of those, the ones whose newest version that day the candidate edited. */
  readonly editedLetters: number;
}

export interface DigestCoverLetters extends CoverLetterUseCounts {
  /** Letters Check my letter checked; it stores no letter, so only this count is kept. */
  readonly checks: number;
  /** `editedLetters / letters`, to four places; `null` on a day with no letter. */
  readonly editedShare: number | null;
}

export const noCoverLetterUse: CoverLetterUseCounts = {
  kits: 0,
  fullDrafts: 0,
  letters: 0,
  editedLetters: 0,
};

const whole = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Adds the organisations' counts up and works out the edited share. */
export function digestCoverLetters(input: {
  readonly organisations: readonly CoverLetterUseCounts[];
  readonly checks: number;
}): DigestCoverLetters {
  const total = { ...noCoverLetterUse };
  for (const each of input.organisations) {
    for (const name of Object.keys(total) as (keyof CoverLetterUseCounts)[]) {
      total[name] += whole(each[name]);
    }
  }
  return {
    ...total,
    checks: whole(input.checks),
    editedShare:
      total.letters === 0
        ? null
        : Math.round((Math.min(total.editedLetters, total.letters) / total.letters) * 10_000) /
          10_000,
  };
}
