import { emptySuperlatives, stockPhrases } from "@draft-loop/application/writing-tells";
import { t } from "@lingui/core/macro";

import type {
  AnnotatedDraftParagraphView,
  AnnotatedDraftView,
} from "./cover-letter-annotated-contract.js";
import type { CoverLetterKitView } from "./cover-letter-kit-contract.js";
import { letterParagraphs } from "./cover-letter-kit-model.js";

/**
 * The logic of the annotated draft (#3281), apart from rendering. Every note is built without a
 * model: a paragraph's role from where it sits, the requirement it answers from the writing kit,
 * the facts behind it from its citations, and a "say this your way" prompt from a fixed set.
 * Generic phrases are the writing-tells stock phrases and Check my letter's empty superlatives.
 */

/** What a paragraph does in the letter. */
export type AnnotatedParagraphRole = "opening" | "proof" | "employer" | "closing";

export function annotatedParagraphRole(
  paragraph: AnnotatedDraftParagraphView,
  index: number,
  count: number,
): AnnotatedParagraphRole {
  if (index === 0) return "opening";
  if (index === count - 1 && count > 2) return "closing";
  if (paragraph.facts.length === 0 && paragraph.employerFacts.length > 0) return "employer";
  return "proof";
}

/** Words that say nothing about a requirement, in English and French. */
const commonWords = new Set([
  "about",
  "also",
  "been",
  "from",
  "have",
  "into",
  "more",
  "that",
  "their",
  "them",
  "they",
  "this",
  "were",
  "which",
  "will",
  "with",
  "work",
  "your",
  "avec",
  "dans",
  "nous",
  "pour",
  "sont",
  "votre",
  "vous",
]);

function topicWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/\p{L}{4,}/gu) ?? [];
  return new Set(words.filter((word) => !commonWords.has(word)));
}

/** A kit requirement a paragraph answers, numbered from 1 as the kit screen shows it. */
export interface AnsweredRequirement {
  readonly number: number;
  readonly text: string;
}

/**
 * The kit requirement a paragraph answers: the first whose facts the paragraph cites, else the
 * one sharing the most topic words with it (two at least, one for a one-word requirement).
 */
export function answeredRequirement(
  paragraph: AnnotatedDraftParagraphView,
  kit: CoverLetterKitView | undefined,
): AnsweredRequirement | undefined {
  if (kit === undefined) return undefined;
  const cited = new Set(paragraph.facts.map((fact) => fact.factId));
  const byFact = kit.requirements.findIndex((requirement) =>
    requirement.facts.some((fact) => cited.has(fact.factId)),
  );
  if (byFact >= 0) {
    return { number: byFact + 1, text: kit.requirements[byFact]?.text ?? "" };
  }
  const words = topicWords(paragraph.text);
  let best: { index: number; shared: number } | undefined;
  kit.requirements.forEach((requirement, index) => {
    const wanted = topicWords(requirement.text);
    let shared = 0;
    for (const word of wanted) if (words.has(word)) shared += 1;
    if (wanted.size > 0 && shared >= Math.min(2, wanted.size)) {
      if (best === undefined || shared > best.shared) best = { index, shared };
    }
  });
  return best === undefined
    ? undefined
    : { number: best.index + 1, text: kit.requirements[best.index]?.text ?? "" };
}

/** Why the paragraph is there, in one sentence. */
export function annotatedWhy(
  role: AnnotatedParagraphRole,
  requirement: AnsweredRequirement | undefined,
): string {
  if (requirement !== undefined) {
    return t`Answers requirement ${requirement.number}: ${requirement.text}`;
  }
  switch (role) {
    case "opening":
      return t`Opens the letter: names the role and why this employer.`;
    case "employer":
      return t`Shows you know the employer, from a dated fact about them.`;
    case "closing":
      return t`Closes the letter: thanks the reader and asks for the next step.`;
    case "proof":
      return t`Proves what you can do with a fact from your record.`;
  }
}

/** The "say this your way" prompt: a question to answer in the person's own words. */
export function annotatedPrompt(role: AnnotatedParagraphRole): string {
  switch (role) {
    case "opening":
      return t`Why do you want this job? Say it as you would to a friend, in one or two sentences.`;
    case "employer":
      return t`What about this employer made you apply? Name the one thing you would mention in an interview.`;
    case "closing":
      return t`End as you would end an email to someone you respect: one next step, no flourish.`;
    case "proof":
      return t`Tell it as a short story: what you faced, what you did, what changed. Keep the facts, use your words.`;
  }
}

/** A stretch of a paragraph, marked when it is a generic phrase. */
export interface AnnotatedSegment {
  readonly text: string;
  readonly generic: boolean;
}

const genericPhrases: readonly string[] = [...stockPhrases, ...emptySuperlatives];

/**
 * The generic phrases in a text, as [start, end) offsets, in reading order and never overlapping.
 * A phrase counts only as whole words, as the writing-tells check matches it.
 */
export function genericPhraseSpans(
  text: string,
): { readonly start: number; readonly end: number; readonly phrase: string }[] {
  const lower = text.toLowerCase().replaceAll("’", "'");
  // A character whose lower case is longer would shift every offset; such text gets no marks.
  if (lower.length !== text.length) return [];
  const found: { start: number; end: number; phrase: string }[] = [];
  for (const phrase of genericPhrases) {
    let at = lower.indexOf(phrase);
    while (at >= 0) {
      const before = lower[at - 1] ?? "";
      const after = lower[at + phrase.length] ?? "";
      if (!/[\p{L}-]/u.test(before) && !/[\p{L}-]/u.test(after)) {
        found.push({ start: at, end: at + phrase.length, phrase });
      }
      at = lower.indexOf(phrase, at + 1);
    }
  }
  found.sort((left, right) => left.start - right.start || right.end - left.end);
  const spans: typeof found = [];
  for (const span of found) {
    const last = spans.at(-1);
    if (last !== undefined && span.start < last.end) {
      if (span.end > last.end) last.end = span.end;
      continue;
    }
    spans.push({ ...span });
  }
  return spans.map((span) => ({ ...span, phrase: text.slice(span.start, span.end) }));
}

/** The text cut into plain and generic stretches, to underline the generic ones. */
export function annotatedSegments(text: string): AnnotatedSegment[] {
  const segments: AnnotatedSegment[] = [];
  let at = 0;
  for (const span of genericPhraseSpans(text)) {
    if (span.start > at) segments.push({ text: text.slice(at, span.start), generic: false });
    segments.push({ text: text.slice(span.start, span.end), generic: true });
    at = span.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at), generic: false });
  return segments;
}

/** How many words in a row the person must share with the draft for them to count as copied. */
export const copiedRunWords = 5;

function meterWords(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replaceAll("’", "'")
      .match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? []
  );
}

export interface OwnWordsShare {
  /** The words in the person's version. */
  readonly words: number;
  /** The ones not inside a run of `copiedRunWords` words that the draft also has. */
  readonly ownWords: number;
  /** ownWords / words, from 0 to 1. */
  readonly share: number;
}

/**
 * The share of the person's words not copied from the draft: a word is copied when it sits in a
 * run of five words in a row that the draft also has, case and punctuation aside. Undefined
 * before the person writes a word.
 */
export function ownWordsShare(own: string, draft: string): OwnWordsShare | undefined {
  const words = meterWords(own);
  if (words.length === 0) return undefined;
  const source = meterWords(draft);
  const runs = new Set<string>();
  for (let start = 0; start + copiedRunWords <= source.length; start += 1) {
    runs.add(source.slice(start, start + copiedRunWords).join(" "));
  }
  const copied = new Array<boolean>(words.length).fill(false);
  for (let start = 0; start + copiedRunWords <= words.length; start += 1) {
    if (!runs.has(words.slice(start, start + copiedRunWords).join(" "))) continue;
    for (let index = start; index < start + copiedRunWords; index += 1) copied[index] = true;
  }
  const ownWords = copied.filter((isCopied) => !isCopied).length;
  return { words: words.length, ownWords, share: ownWords / words.length };
}

/** The draft's whole text, for the meter. */
export function annotatedDraftText(draft: AnnotatedDraftView): string {
  return draft.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
}

/** The person's letter: each rewrite box's paragraphs, empty boxes left out. */
export function rewriteParagraphs(rewrites: readonly string[]): string[] {
  return rewrites.flatMap(letterParagraphs);
}

/**
 * The rewrite boxes to start from: one per draft paragraph, filled from the person's saved letter
 * in order. A saved letter longer than the draft keeps its extra paragraphs in the last box.
 */
export function initialRewrites(
  draftParagraphs: number,
  saved: readonly string[] | undefined,
): string[] {
  const own = saved ?? [];
  return Array.from({ length: draftParagraphs }, (_, index) =>
    index === draftParagraphs - 1 ? own.slice(index).join("\n\n") : (own[index] ?? ""),
  );
}
