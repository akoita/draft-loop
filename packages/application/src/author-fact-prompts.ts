/*
 * Prompt text of `cli-author-v15` (#1860): each fact is stated once. The 0.6.2 walk's draft said the
 * same two facts in Summary, Core areas and Experience, and v7's "worded differently from the
 * experience bullets" only taught the author to reword them. v15 gives each part of the CV its own
 * job and tells the revising author what to do with a `repeated-fact` finding (#1859). v14 stays
 * unchanged for runs that recorded it.
 */

/** Added to the author prompt from `cli-author-v15`; it never overrides the grounding rules. */
export const singleStatementInstructions =
  " State each fact once. Every supported fact (a role, an achievement, a project, a scope or a way of working) has one home, and each part of the CV has its own job. Experience and Projects carry the detail: what was done, how, and the scope or result. The summary condenses the candidate in new words: the titles they held, the skill areas this job asks for that the evidence shows, and the kind of work they do; it never restates an experience bullet or names the same achievement. Each Core areas paragraph groups evidence from across the candidate's roles and projects under one theme the job asks for, in its own words, and never restates a single bullet, a project introduction or the summary; when the evidence holds only one example of a theme, leave that theme to Experience. Do not repeat a sentence, an achievement or the same framing (for example, the same tool or way of working) across the summary, Core areas, project introductions and Experience. When findings include code repeated-fact, its message names each section that states the same fact: keep the fact in the one section where it fits best, usually Experience, and remove the other occurrences or rewrite them to that section's own job, unless pendingAdjudication rejects that finding. Every substantive claim still follows the grounding and citation rules above, and this guidance does not override the required sections, context.writingPolicy or this system message.";
