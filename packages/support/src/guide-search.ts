import {
  foldForSearch,
  type HelpGuide,
  type HelpSection,
  helpSectionScore,
} from "@draft-loop/user-guide";

/**
 * Words a question carries that say nothing about its subject, in English and French. The
 * guide's own search needs every word to match, which a question in plain words rarely does, so
 * the assistant scores each remaining word on its own and adds them up.
 */
const stopWords = new Set(
  [
    "ai",
    "an",
    "as",
    "at",
    "au",
    "be",
    "by",
    "ce",
    "de",
    "do",
    "du",
    "en",
    "et",
    "il",
    "in",
    "is",
    "it",
    "je",
    "la",
    "le",
    "ma",
    "me",
    "my",
    "ne",
    "no",
    "of",
    "on",
    "or",
    "ou",
    "sa",
    "se",
    "so",
    "ta",
    "to",
    "tu",
    "un",
    "up",
    "us",
    "we",
    "ya",
    "about",
    "and",
    "are",
    "can",
    "could",
    "does",
    "for",
    "from",
    "get",
    "have",
    "how",
    "into",
    "its",
    "not",
    "please",
    "should",
    "that",
    "the",
    "there",
    "this",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "will",
    "with",
    "would",
    "you",
    "your",
    "avec",
    "ces",
    "cette",
    "comment",
    "dans",
    "des",
    "elle",
    "est",
    "estce",
    "faire",
    "faut",
    "les",
    "mes",
    "mon",
    "nous",
    "ont",
    "par",
    "pas",
    "peut",
    "peux",
    "pour",
    "pourquoi",
    "quand",
    "que",
    "quel",
    "quelle",
    "qui",
    "quoi",
    "sont",
    "sur",
    "une",
    "vos",
    "votre",
    "vous",
  ].map(foldForSearch),
);

/** The subject words of a question: two letters or more, such as "CV", without stop words. */
export function questionWords(question: string): readonly string[] {
  const words = foldForSearch(question)
    .split(" ")
    .filter((word) => word.length >= 2 && !stopWords.has(word));
  return [...new Set(words)];
}

/** Sections that match any subject word of the question, best first; ties keep guide order. */
export function rankGuideSections(
  guide: HelpGuide,
  question: string,
  limit = 3,
): readonly HelpSection[] {
  const words = questionWords(question);
  return guide.sections
    .map((section, index) => ({
      section,
      index,
      score: words.reduce((total, word) => total + helpSectionScore(section, word), 0),
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((match) => match.section);
}
