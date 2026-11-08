/**
 * Machine-writing tells in a cover letter (#2512): a pure, deterministic check of the habits
 * readers associate with model-written text. It flags sentences for the candidate to rewrite; it
 * is not an AI detector and never claims a letter would pass one. English and French.
 */

export type WritingTellCode =
  | "stock_phrase"
  | "heavy_dashes"
  | "list_of_three"
  | "mirrored_openings"
  | "word_count";

export interface WritingTell {
  readonly code: WritingTellCode;
  /** The paragraph, counted from 0; absent for a tell about the whole letter. */
  readonly paragraph?: number;
  /** The flagged sentence as written; absent for a tell about the whole letter. */
  readonly sentence?: string;
  /** The words that triggered it, such as the stock phrase. */
  readonly match?: string;
}

/** The brief's length for a cover letter, in words. */
export const coverLetterWordRange = { minimum: 250, maximum: 350 } as const;

/** Phrases that open, pad or close a letter the way models do. Lower case, accents kept. */
export const stockPhrases: readonly string[] = [
  "i am writing to express",
  "i am excited to apply",
  "i am thrilled",
  "thrilled to",
  "passionate about",
  "passion for",
  "leverage",
  "leveraging",
  "delve",
  "tapestry",
  "testament to",
  "in today's fast-paced",
  "fast-paced environment",
  "dynamic team",
  "seamlessly",
  "synergy",
  "unwavering",
  "proven track record",
  "i would welcome the opportunity",
  "thank you for considering my application",
  "i look forward to the opportunity",
  "align perfectly",
  "is one of my skills",
  "a skill i bring",
  "skills i bring",
  "a skill i can name",
  "is familiar to me",
  "fait partie de mes compétences",
  "aligns perfectly",
  "je me permets de vous adresser",
  "c'est avec un grand enthousiasme",
  "passionné par",
  "passionnée par",
  "véritable passion",
  "tirer parti",
  "dans un monde en constante évolution",
  "environnement dynamique",
  "je reste à votre disposition",
  "dans l'attente de votre retour",
  "je serais ravi",
  "je serais ravie",
];

const sentencePattern = /[^.!?…]+(?:[.!?…]+|$)/gu;

function sentencesOf(paragraph: string): string[] {
  return (paragraph.match(sentencePattern) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordsOf(text: string): string[] {
  return text.match(/\p{L}[\p{L}'’-]*/gu) ?? [];
}

const dashPattern = /\s[—–]\s|—/gu;
/** "fast, reliable and cheap" or "rapide, fiable et simple": three single words in a row. */
const listOfThreePattern = /\b(\p{L}+), (\p{L}+),? (?:and|et|ou|or) (\p{L}+)\b/giu;

function phraseIn(sentence: string): string | undefined {
  const lower = sentence.toLowerCase().replaceAll("’", "'");
  return stockPhrases.find((phrase) => {
    const at = lower.indexOf(phrase);
    if (at < 0) return false;
    const before = lower[at - 1];
    const after = lower[at + phrase.length];
    return !/\p{L}/u.test(before ?? "") && !/\p{L}/u.test(after ?? "");
  });
}

/** The first two words of a paragraph, lower case, to compare openings. */
function openingOf(paragraph: string): string | undefined {
  const words = wordsOf(paragraph).slice(0, 2);
  return words.length < 2 ? undefined : words.join(" ").toLowerCase();
}

/**
 * Every tell in a cover letter's paragraphs, in reading order, then the letter-wide ones. Heavy
 * dashes are flagged only when the letter uses two or more; one dash is ordinary punctuation.
 */
export function writingTells(paragraphs: readonly string[]): WritingTell[] {
  const tells: WritingTell[] = [];
  const dashes = paragraphs.reduce(
    (count, paragraph) => count + (paragraph.match(dashPattern)?.length ?? 0),
    0,
  );
  paragraphs.forEach((paragraph, index) => {
    for (const sentence of sentencesOf(paragraph)) {
      const phrase = phraseIn(sentence);
      if (phrase !== undefined) {
        tells.push({ code: "stock_phrase", paragraph: index, sentence, match: phrase });
      }
      if (dashes >= 2 && new RegExp(dashPattern.source, "u").test(sentence)) {
        tells.push({ code: "heavy_dashes", paragraph: index, sentence });
      }
      const list = new RegExp(listOfThreePattern.source, "iu").exec(sentence);
      if (list !== null) {
        tells.push({ code: "list_of_three", paragraph: index, sentence, match: list[0] });
      }
    }
  });
  const openings = paragraphs.map(openingOf);
  openings.forEach((opening, index) => {
    if (opening !== undefined && openings.indexOf(opening) < index) {
      const first = sentencesOf(paragraphs[index] ?? "")[0];
      tells.push({
        code: "mirrored_openings",
        paragraph: index,
        ...(first === undefined ? {} : { sentence: first }),
        match: opening,
      });
    }
  });
  const words = paragraphs.reduce((count, paragraph) => count + wordsOf(paragraph).length, 0);
  if (words < coverLetterWordRange.minimum || words > coverLetterWordRange.maximum) {
    tells.push({ code: "word_count", match: String(words) });
  }
  return tells;
}
