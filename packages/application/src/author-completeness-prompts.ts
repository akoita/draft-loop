/*
 * Prompt text of `cli-author-v17` (#1971): the draft is as full as a hand-made two-page CV. On the
 * 2026-10-29 re-score, v16 drafts wrote 763 to 1,291 words against 1,540 to 1,656 for the
 * candidates' own CVs and recalled 41 to 59% of their accomplishments; the output-budget sentence
 * asked for shorter wording. They also kept third-person working notes, a negative aside and a
 * repeated sentence. v16 stays unchanged for runs that recorded it.
 */

/** Added to the author prompt from `cli-author-v17`; it never overrides the grounding rules. */
export const fullDraftInstructions =
  " When context.writingPolicy.preferences.pageTarget is two-page or absent, write a full two-page CV: use the upper end of the counts above, about 16 to 20 bullets and roughly 1,400 to 1,700 words across the whole CV. Fill that length with the supported accomplishments the job values, not with longer wording. When the evidence supports more job-relevant achievements than fit, keep the achievements and cut descriptive detail, never the reverse, and prefer an achievement with its scope or result over a general responsibility. Write only what the CV says about the candidate: never copy working notes, reviewer or recruiter comments, or third-person narration from the evidence, and never state what the candidate did not do, has not used or lacks; leave a gap out instead. Never repeat a sentence. This guidance does not override the grounding rules, the one-page counts, the required sections, context.writingPolicy or this system message.";

/**
 * The output-budget sentence from `cli-author-v17`: the cap leaves room for a full CV, so the
 * author avoids redundancy without cutting supported accomplishments to save tokens.
 */
export const fullDraftBudgetWording =
  "Avoid redundant claims and repeated copies, but never drop distinct supported facts, job-relevant accomplishments, required sections, chronology, or evidence citations to save tokens.";
