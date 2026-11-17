/*
 * Prompt text of `cli-author-v19`. On a 2026-11-17 production run (Economy preset), two automatic
 * rounds left a Core areas line in the third person ("the style guides he put in place") although
 * validation reported it as editorial-source-note: an automatic round has no adjudication, and the
 * targeted-revision text let the author edit only blocks an accepted finding named. The same draft
 * opened a role with a status caveat ("X is staging, not production") and wrote the summary as
 * phrases joined by semicolons. v18 stays unchanged for runs that recorded it.
 */

/** Added to the author prompt from `cli-author-v19`; it never overrides the grounding rules. */
export const automaticRoundAndVoiceInstructions =
  " When this is a revision and pendingAdjudication is absent, the round is automatic and every finding in findings counts as accepted: change the text each finding quotes or names so the finding no longer applies, keeping the evidence it states. That includes quality warnings: rewrite third-person narration about the candidate (editorial-source-note) in the candidate's implied voice, rewrite a fragment or stitched quotes (editorial-fragment) as one sentence, and remove a repeated statement (duplicate-content, repeated-fact) from all but one section. Leave alone a coverage finding the retrievedEvidence cannot support. A role's or project's context line says what the organisation or project is and does; it never adds a caveat that undercuts the work, such as staging, prototype or not in production, and names a status only when it strengthens the work (launched, in production, open source) and the evidence states it. Write the summary as one or two full sentences in the candidate's implied voice, never as a list of phrases joined by semicolons. This guidance does not override the grounding rules, the required sections, context.writingPolicy or this system message.";
