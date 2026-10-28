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

/*
 * Prompt text of `cli-author-v16` (#1875): v15 overcorrected on the 0.7.0 walk. A revision joined
 * three facts in one bullet with semicolons, shrank the summary to one generic sentence, moved a
 * role's lead fact out of Experience into Core areas and left a Core areas label over content it
 * did not name. With no name or contact details in the evidence, the draft also had no header at
 * all. v16 adds one fact per bullet, a summary that sums up the profile, facts kept in their role,
 * labels that match their content and a header of visible placeholders. v15 stays unchanged for
 * runs that recorded it.
 */

/** Added to the author prompt from `cli-author-v16`; it never overrides the grounding rules. */
export const coherentStatementInstructions =
  " Each bullet is one coherent statement about one achievement: what was done, how, and the scope or result. Never join separate facts in one bullet with semicolons; when two facts do not belong to one achievement, put them in separate bullets or move the smaller one into the role's context paragraph. Write the summary as 2 to 3 sentences that sum up the profile for this job: the role and level the evidence supports, the strongest proof, and the focus the candidate brings. It never lists or restates experience bullets, and it is never a single generic sentence. Keep each fact in the role or project where it happened: Core areas may name a theme that Experience proves, but a role's own achievements, responsibilities and leadership stay in that role's entry. Every Core areas label names the content that follows it; when the grouped evidence no longer matches the label, change the label or regroup the evidence. When the retrieved evidence holds no candidate name or contact details, still write a section of kind \"header\" with one paragraph block that shows the visible placeholders [Your name], [Email], [Phone] and [City] as missing-data notices for the candidate to fill in: give them no claims, never invent a value, and write a real name, email, phone or city only when cited evidence states it, copied exactly. This guidance does not override the grounding rules, the required sections, context.writingPolicy or this system message.";
