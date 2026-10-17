/*
 * Prompt text of `cli-author-v14` (#1364): the draft is written to the writing policy's page target.
 * v13's counts describe a two-page CV. A one-page CV is not the same text printed smaller: it keeps
 * every role but gives bullets only to the most relevant recent ones, with shorter bullets and fewer
 * labelled lines, so it fits one A4 page at a readable size. v13 stays unchanged for runs that
 * recorded it.
 */

/** Added to the author prompt from `cli-author-v14`; it never overrides the grounding rules. */
export const pageTargetLengthInstructions =
  " Write to the page target in context.writingPolicy.preferences.pageTarget. When it is two-page or absent, use the counts above. When it is one-page, the whole CV must fit on one A4 page at a readable size, so these counts replace the counts above: a summary of 2 to 3 lines; bullets only for the 2 or 3 roles or projects most relevant to the job, preferring recent ones, at most 3 bullets each and about 6 to 9 bullets in total, each about 2 to 3 lines (roughly 30 to 50 words); for every other role, only the role line and a context paragraph of one line; 2 or 3 labelled paragraph blocks in Core areas; and one or two labelled lines each for Skills, Education and Certifications or training. Keep every role's title, employer and dates either way, and cut words rather than facts the job needs. Everything else above still applies.";
