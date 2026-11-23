/*
 * Prompt text of `cli-author-v22` (#3296, #3160). The live evaluation found every non-tech Economy
 * draft with `[Your name]` and `[Phone]` in its header while the email and town were filled: v16
 * named all four placeholders together, and the name sat only in the profile's top heading. v22
 * reads a top heading naming a person as the candidate's name, leaves out one missing contact
 * field instead of writing its placeholder, and keeps internal project names out of the summary
 * and Core areas. v21 stays unchanged for runs that recorded it.
 */

/** The v16 header rule that v22 replaces. */
const placeholderHeaderRule =
  'When the retrieved evidence holds no candidate name or contact details, still write a section of kind "header" with one paragraph block that shows the visible placeholders [Your name], [Email], [Phone] and [City] as missing-data notices for the candidate to fill in: give them no claims, never invent a value, and write a real name, email, phone or city only when cited evidence states it, copied exactly.';

/** The v22 header rule: the name from a top heading, and no placeholder beside real details. */
export const namedHeaderRule =
  'Write a section of kind "header" with one paragraph block holding the candidate\'s name and contact details. A top-level heading of a candidate source that names a person, such as "# Jane Doe" or "# Candidate profile: Jane Doe", states the candidate\'s name: write that name, copied exactly, with a claim citing that heading. Write an email, phone, city or profile link only when cited evidence states it, copied exactly, and never invent a value. When the evidence states some contact details but not one of them, leave that field out; never write a placeholder such as [Phone] beside real details. Only when the evidence holds no candidate name, write the visible placeholder [Your name]; only when it holds no contact details at all, write [Email], [Phone] and [City]. Placeholders are missing-data notices for the candidate to fill in and carry no claims.';

/** Replace v16's header rule in its pinned text, failing loudly when the passage is gone. */
export function namedHeaderStatementInstructions(coherentStatementInstructions: string): string {
  if (!coherentStatementInstructions.includes(placeholderHeaderRule)) {
    throw new Error("Prompt passage not found: the v16 header rule.");
  }
  return coherentStatementInstructions.replace(placeholderHeaderRule, namedHeaderRule);
}

/** Added to the author prompt from `cli-author-v22`; it never overrides the grounding rules. */
export const plainSummaryInstructions =
  ' In the summary and Core areas, name only what a recruiter already knows: employers, well-known companies and products, technologies, qualifications and job titles. Describe the candidate\'s own projects there in plain words, such as "a booking tool for a community clinic", never by their internal or product names; name a project only in Experience or Projects, where its line explains what it is. When findings include code editorial-project-name, replace the name it quotes with a plain description of the work.';
