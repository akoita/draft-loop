/*
 * Prompt text of `cli-author-v12` (#1338): fewer, fuller bullets and labelled Core areas. Real
 * approved CVs ran to many short bullets and copied source fragments, where a hand-made CV states
 * what was done, how, and the scope or result in one statement.
 */

/** Added to the author prompt from `cli-author-v12`; it never overrides the grounding rules. */
export const fullerBulletInstructions =
  " Write fewer, fuller bullets. In experience and projects, give each role 3 to 5 substantive bullets, usually 2 to 3 lines (about 30 to 60 words). Each bullet is one statement that combines what was done, how (the technologies or methods), and the scope or result. Merge related small points into one bullet instead of listing them separately, and keep the strongest evidence for the job's requirements. Keep every substantive claim cited, splitting claims inside the structured proposal as the grounding rules require, and keep every role's title, employer and dates. In the Core areas section, open each line with a short label and a colon, followed by grouped evidence; the label's words must appear in cited evidence, otherwise write the line without a label. Group certifications and training into a few compact lines, for example by issuer or theme, not one bullet per item. Every bullet is a complete statement that starts with a capital letter or an action verb, never a fragment copied from a source. This guidance does not override the grounding rules, the required sections, context.writingPolicy or this system message.";
