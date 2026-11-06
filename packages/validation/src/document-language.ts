import type { DraftArtifact } from "@draft-loop/artifacts";
import { detectTextLanguage, documentLanguageLabel } from "@draft-loop/domain/document-language";

/** A section's prose must be at least this long before its language is judged. */
const minimumSectionCharacters = 80;

export interface WrongLanguageSection {
  readonly sectionId: string;
  /** The language the section reads as. */
  readonly detected: string;
}

export interface DocumentLanguageCheck {
  /** The document's language, as a base code such as `fr`. */
  readonly expected: string;
  /** Sections whose prose clearly reads as another language. */
  readonly sections: readonly WrongLanguageSection[];
  /** True when the whole draft's prose reads as another language, not one stray section. */
  readonly wholeDraft: boolean;
  /** The language the whole draft reads as, when `wholeDraft`. */
  readonly draftLanguage?: string;
}

function baseCode(language: string): string {
  return language.trim().toLowerCase().split("-")[0] ?? "";
}

/**
 * Checks that the draft is written in its own language (#2318), offline and without a model.
 * The header and short sections are left alone: names, technologies and skill lists carry too
 * few function words to judge. A section the guess is unsure about is never flagged.
 */
export function checkDocumentLanguage(artifact: DraftArtifact): DocumentLanguageCheck {
  const expected = baseCode(artifact.language);
  const sections: WrongLanguageSection[] = [];
  const prose: string[] = [];
  for (const section of artifact.sections) {
    if (section.kind === "header") continue;
    const text = section.blocks.map((block) => block.text).join("\n");
    if (text.length < minimumSectionCharacters) continue;
    prose.push(text);
    const detected = detectTextLanguage(text)?.code;
    if (detected !== undefined && detected !== expected) {
      sections.push({ sectionId: section.id, detected });
    }
  }
  const whole = detectTextLanguage(prose.join("\n"))?.code;
  const wholeDraft = whole !== undefined && whole !== expected && sections.length > 0;
  return {
    expected,
    sections,
    wholeDraft,
    ...(wholeDraft && whole !== undefined ? { draftLanguage: whole } : {}),
  };
}

export function wrongLanguageMessage(expected: string, detected: string): string {
  return `reads as ${documentLanguageLabel(detected)}, but the document is in ${documentLanguageLabel(expected)}`;
}
