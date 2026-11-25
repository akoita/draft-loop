/**
 * Finds the words a job ad planted for AI tools in a letter the candidate wrote (#3337).
 *
 * Some job ads ask AI writing tools to add a word, such as "watermelon", or to start with a phrase
 * such as "I AM A BOT", so an AI-written application gives itself away. Redakloop's models never
 * read those requests, but a letter written with another tool may still carry the word. This
 * check runs without a model: a planted word or phrase found as whole words, ignoring case and
 * accents, is reported once with the first sentence that holds it. A word the candidate's own
 * approved facts also use is theirs, and is not reported.
 */

export interface PlantedWordFinding {
  readonly word: string;
  readonly paragraph: number;
  readonly sentence: string;
}

function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’‘]/gu, "'");
}

/** Whether `phrase` appears in `text` as whole words, both already folded. */
function holds(text: string, phrase: string): boolean {
  let at = text.indexOf(phrase);
  while (at >= 0) {
    const before = text[at - 1] ?? "";
    const after = text[at + phrase.length] ?? "";
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    at = text.indexOf(phrase, at + 1);
  }
  return false;
}

export function plantedWordFindings(
  sentences: readonly { readonly paragraph: number; readonly text: string }[],
  plantedWords: readonly string[],
  ownTexts: readonly string[] = [],
): PlantedWordFinding[] {
  const own = ownTexts.map(folded);
  const findings: PlantedWordFinding[] = [];
  const seen = new Set<string>();
  for (const word of plantedWords) {
    const phrase = folded(word).replace(/\s+/gu, " ").trim();
    if (phrase.length < 2 || seen.has(phrase)) continue;
    seen.add(phrase);
    if (own.some((text) => holds(text, phrase))) continue;
    const found = sentences.find((sentence) =>
      holds(folded(sentence.text).replace(/\s+/gu, " "), phrase),
    );
    if (found !== undefined) {
      findings.push({ word, paragraph: found.paragraph, sentence: found.text });
    }
  }
  return findings;
}
