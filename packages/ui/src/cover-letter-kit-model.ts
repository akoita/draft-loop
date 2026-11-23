import { t } from "@lingui/core/macro";

import {
  type CoverLetterKitView,
  maximumOwnLetterParagraphCharacters,
  maximumOwnLetterParagraphs,
} from "./cover-letter-kit-contract.js";

/**
 * The logic of the cover letter writing kit screen (#3279), apart from rendering: how much help
 * the person asked for, how their letter splits into paragraphs, and what each kit note cites.
 */

/** How much help the Cover letter tab gives: the kit is the default and the recommended one. */
export const coverLetterHelpLevels = ["kit", "annotated", "full"] as const;
export type CoverLetterHelp = (typeof coverLetterHelpLevels)[number];
export const defaultCoverLetterHelp: CoverLetterHelp = "kit";

/** The paragraphs of the person's letter: blocks of text between blank lines, trimmed. */
export function letterParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

/** The editor's text for saved paragraphs, a blank line between each. */
export function letterText(paragraphs: readonly string[]): string {
  return paragraphs.join("\n\n");
}

export function letterWordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

/** Why the letter cannot be saved as it is, or undefined when it can. */
export function ownLetterProblem(text: string): string | undefined {
  const paragraphs = letterParagraphs(text);
  if (paragraphs.length === 0) return t`Write your letter first.`;
  if (paragraphs.length > maximumOwnLetterParagraphs) {
    return t`A letter holds at most ${maximumOwnLetterParagraphs} paragraphs. Join some of them.`;
  }
  if (paragraphs.some((paragraph) => paragraph.length > maximumOwnLetterParagraphCharacters)) {
    return t`A paragraph holds at most ${maximumOwnLetterParagraphCharacters} characters. Split the long one.`;
  }
  return undefined;
}

/** True when the editor holds text that differs from the saved letter. */
export function letterChanged(text: string, saved: readonly string[] | undefined): boolean {
  const current = letterParagraphs(text);
  const before = saved ?? [];
  return (
    current.length !== before.length || current.some((paragraph, i) => paragraph !== before[i])
  );
}

/** The texts a note cites: the kit's facts and employer facts, in the note's order. */
export function kitCitedTexts(
  kit: CoverLetterKitView,
  cited: { readonly factIds: readonly string[]; readonly findingIds: readonly string[] },
): string[] {
  const facts = new Map(
    kit.requirements.flatMap((requirement) =>
      requirement.facts.map((fact) => [fact.factId, fact.text] as const),
    ),
  );
  const findings = new Map(kit.employerFacts.map((fact) => [fact.findingId, fact.text] as const));
  return [
    ...cited.factIds.flatMap((id) => facts.get(id) ?? []),
    ...cited.findingIds.flatMap((id) => findings.get(id) ?? []),
  ];
}

/** The 1-based numbers of the requirements an outline paragraph answers. */
export function kitRequirementNumbers(
  kit: CoverLetterKitView,
  requirementIds: readonly string[],
): number[] {
  return requirementIds
    .map((id) => kit.requirements.findIndex((requirement) => requirement.requirementId === id) + 1)
    .filter((number) => number > 0);
}
