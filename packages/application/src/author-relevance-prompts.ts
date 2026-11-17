/*
 * Prompt text of `cli-author-v18`: room follows the job. On a 2026-11-17 production run for an
 * applied-AI role, v17's flat 2 to 4 bullets per role gave the candidate's independent work, the
 * most relevant evidence and three projects under one role, two bullets in total, and listed the
 * projects again as one line each. A hand-made CV for a similar role gave each main project its own
 * line and five or six bullets. v17 stays unchanged for runs that recorded it.
 */

/** Added to the author prompt from `cli-author-v18`; it never overrides the grounding rules. */
export const relevanceWeightedRoomInstructions =
  " Size each role and project by how much the job values its evidence, not by a fixed count: where the evidence proves the job's central themes, write a fuller context paragraph and up to 6 bullets, which may follow one another; where the job barely values it, write the role line and one context line. The bullet counts above apply to the whole CV, not to each role. When one role groups several projects, such as independent, freelance or consulting work, open it with its role line and one context line, then give each job-relevant project its own project line as a paragraph block (the project's name, what it is, its link and its status as the evidence states them) followed by its own bullets, sized the same way. Fold minor projects into one line or one bullet. Describe each project once: a project written inside its role is not repeated in a Projects section, which keeps only projects outside any role. This guidance does not override the grounding rules, the one-page counts, the required sections, context.writingPolicy or this system message.";
