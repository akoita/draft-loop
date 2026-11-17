/**
 * Searching the user guide (#2880): plain word matching in the browser, no model and no request.
 * Accents and case are ignored, so "eleve" finds "élève" and "cv" finds "CV".
 */
import type { HelpGuide, HelpSection } from "./guide.js";

/** Lower case without accents or punctuation, so French and English words compare plainly. */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Words shorter than this, such as "a" or "de", match too much to count. */
const shortestWord = 2;

function words(text: string): string[] {
  return foldForSearch(text)
    .split(" ")
    .filter((word) => word.length >= shortestWord);
}

/** How well one section answers the query: title and keyword hits weigh more than body hits. */
export function helpSectionScore(section: HelpSection, query: string): number {
  const wanted = words(query);
  if (wanted.length === 0) return 0;
  const title = foldForSearch(section.title);
  const keywords = foldForSearch(section.keywords.join(" "));
  const body = foldForSearch(section.paragraphs.join(" "));
  let score = 0;
  for (const word of wanted) {
    const inTitle = title.includes(word);
    const inKeywords = keywords.includes(word);
    const inBody = body.includes(word);
    // Every word must appear somewhere, so "export pdf" does not list every section with "export".
    if (!inTitle && !inKeywords && !inBody) return 0;
    score += (inTitle ? 3 : 0) + (inKeywords ? 2 : 0) + (inBody ? 1 : 0);
  }
  return score;
}

/** The sections that match every word of the query, best first; ties keep the guide's order. */
export function searchHelpGuide(guide: HelpGuide, query: string): readonly HelpSection[] {
  return guide.sections
    .map((section, index) => ({ section, index, score: helpSectionScore(section, query) }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((match) => match.section);
}
