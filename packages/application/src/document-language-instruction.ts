import { documentLanguageLabel } from "@draft-loop/domain/document-language";

/**
 * The one sentence every writing prompt adds for a document language other than English (#2316).
 * The prompts stay in English, and an English run's prompts stay byte for byte as before.
 */
export function documentLanguageInstruction(language: string | undefined): string | undefined {
  const code = language?.trim().toLowerCase() ?? "";
  if (code === "" || code === "en" || code.startsWith("en-")) return undefined;
  const label = documentLanguageLabel(code.split("-")[0] ?? code);
  return [
    `Write every word the candidate will read in ${label} (${code}), following ${label} conventions for dates, numbers and punctuation.`,
    "Keep the names of employers, products, technologies, qualifications and certifications as the sources write them.",
    `When a source is in another language, translate its facts into ${label} faithfully: never add scope, seniority, ownership or results the source does not state.`,
  ].join(" ");
}

/** The instructions with the language sentence last, or unchanged for English. */
export function withDocumentLanguage(instructions: string, language: string | undefined): string {
  const sentence = documentLanguageInstruction(language);
  return sentence === undefined ? instructions : `${instructions}\n\n${sentence}`;
}
