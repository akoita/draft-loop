/**
 * Role-neutral wording for the model instructions (#3090, rollup #3086). The rules stay the
 * same; only their examples change, so a nurse, a salesperson or an electrician reads as
 * naturally as an engineer. Used from `cli-author-v21`, `cli-critic-v12` and
 * `canonical-candidate-profile-extraction-v10`; older versions keep their exact text.
 */

/** Replace one passage of a pinned prompt, failing loudly when the passage is gone. */
function replaceExactly(prompt: string, passage: string, replacement: string): string {
  if (!prompt.includes(passage)) {
    throw new Error(`Prompt passage not found: "${passage.slice(0, 60)}".`);
  }
  return prompt.split(passage).join(replacement);
}

/** The author's body-prose rule with examples from several fields instead of software only. */
export function roleNeutralAuthorProse(instructions: string): string {
  return replaceExactly(
    replaceExactly(
      instructions,
      "including production versus staging and",
      "including supervised versus independent practice, a pilot versus a full rollout, staging versus production, and",
    ),
    "outcomes, numbers, or technologies.",
    "outcomes, numbers, tools, or methods.",
  );
}

/** Added to the author prompt from `cli-author-v21`; it never overrides the grounding rules. */
export const roleNeutralSectionInstructions =
  ' Write sections in the candidate\'s own field. When the evidence holds professional registrations, licences or trade cards (a nursing registration, a teaching qualification, an electrician\'s card), put them in a section of kind "certifications" titled "Registrations and licences". When it holds voluntary work, put it in a section of kind "custom" titled "Volunteering". Name skills, tools and methods in the words the evidence uses, and keep acronyms and abbreviations as the evidence writes them.';

/** The critic's employment-gap rule with a role-neutral example. */
export function roleNeutralCriticGapRule(prompt: string): string {
  return replaceExactly(
    prompt,
    "no listed software employment does not mean",
    "no listed employment in a stated field does not mean",
  );
}

/** The profile extraction rule that keeps an entry whole, with a role-neutral list. */
export function roleNeutralProfileEntryRule(rule: string): string {
  return replaceExactly(
    rule,
    "numbers, scope, technologies, and outcome",
    "numbers, scope, tools or methods, and outcome",
  );
}
