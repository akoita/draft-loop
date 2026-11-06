import type { DraftArtifact } from "@draft-loop/artifacts";

/**
 * How each document language is typeset at export (#2317). Dates, language levels and section
 * order are the author's to write in the language (#2316); export only fixes what a person types
 * with an ordinary space but print needs held together.
 */
export interface LanguageConventions {
  /** French keeps a no-break space before `: ; ! ? »` and after `«`. */
  readonly typography: "french" | "plain";
}

const plain: LanguageConventions = { typography: "plain" };

export const languageConventions: Readonly<Record<string, LanguageConventions>> = {
  en: plain,
  fr: { typography: "french" },
};

export function conventionsFor(language: string | undefined): LanguageConventions {
  const code = (language ?? "en").toLowerCase().slice(0, 2);
  return languageConventions[code] ?? plain;
}

const noBreakSpace = " ";

/**
 * French punctuation spacing: an ordinary space before a high punctuation mark or a closing
 * guillemet, or after an opening one, becomes a no-break space, so the mark never starts a line.
 * Nothing is inserted where the writer left no space, so addresses such as `https://` stay intact.
 */
export function frenchTypography(text: string): string {
  return text.replace(/ +(?=[:;!?»])/gu, noBreakSpace).replace(/(?<=«) +/gu, noBreakSpace);
}

export function typesetText(text: string, language: string | undefined): string {
  return conventionsFor(language).typography === "french" ? frenchTypography(text) : text;
}

/** The artifact with its visible text typeset for its language; English is returned as is. */
export function typesetArtifact(artifact: DraftArtifact): DraftArtifact {
  if (conventionsFor(artifact.language).typography === "plain") return artifact;
  return {
    ...artifact,
    sections: artifact.sections.map((section) => ({
      ...section,
      title: frenchTypography(section.title),
      blocks: section.blocks.map((block) => ({ ...block, text: frenchTypography(block.text) })),
    })),
  };
}
