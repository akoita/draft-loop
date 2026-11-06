import { documentLanguageLabel } from "@draft-loop/domain/document-language";
import { documentLanguageInstruction } from "./document-language-instruction.js";

/** The critic finding codes of a document written in another language than English (#2319). */
export const criticLanguageFindingCodes = ["language", "translation-fidelity"] as const;

/**
 * The language review a critic call adds for a document language other than English. It follows
 * the run's cached prefix as a call instruction, so English runs and their prompt versions are
 * unchanged.
 */
export function criticLanguageReviewInstructions(language: string | undefined): string {
  if (documentLanguageInstruction(language) === undefined || language === undefined) return "";
  const code = language.trim().toLowerCase();
  const label = documentLanguageLabel(code.split("-")[0] ?? code);
  return [
    `The CV is written in ${label} (${code}); the sources may be in another language.`,
    `Report as a quality warning, quoting the text (at most 80 characters) and naming its section: text not in ${label}, a mix of languages, an anglicism where ${label} has a usual term, or a date, number or punctuation that breaks ${label} conventions (code language).`,
    "Compare each claim with its cited source in the source's own language: when the translation says more than the source, such as more scope, seniority, ownership or a result the source does not state, report a factuality error that names the claim and quotes the source (code translation-fidelity).",
    "Names of employers, products, technologies, qualifications and certifications kept as the sources write them are not findings.",
  ].join(" ");
}

/** The instructions with the language review last, or unchanged for English. */
export function withCriticLanguageReview(
  instructions: string,
  language: string | undefined,
): string {
  const review = criticLanguageReviewInstructions(language);
  if (review === "") return instructions;
  return instructions === "" ? review : `${instructions}\n\n${review}`;
}
