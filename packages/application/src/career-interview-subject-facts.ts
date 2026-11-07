import type { CareerInterviewFact } from "./career-interview-topics.js";

/**
 * The record facts a subject the candidate names themselves is about (#2414), so the interviewer
 * can ask about what the record already says instead of starting blind. Words of three letters or
 * more are compared without case or accents; facts that share the most words come first. The
 * topic's usual bounds and sensitivity rules still apply when the facts are sent.
 */
export function careerInterviewSubjectFacts(
  subject: string,
  facts: readonly CareerInterviewFact[],
  mayTransmit: (fact: CareerInterviewFact) => boolean,
  maximum: number,
): string[] {
  const wanted = new Set(words(subject).filter((word) => !ignoredWords.has(word)));
  if (wanted.size === 0) return [];
  return facts
    .filter(mayTransmit)
    .map((fact, order) => {
      const own = new Set(words(`${fact.field} ${fact.value}`));
      let score = 0;
      for (const word of wanted) if (own.has(word)) score += 1;
      return { id: fact.id, score, order };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, maximum)
    .map((entry) => entry.id);
}

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);
}

/** Glue words in English and French that would match almost every fact. */
const ignoredWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "about",
  "that",
  "this",
  "from",
  "was",
  "were",
  "les",
  "des",
  "une",
  "pour",
  "avec",
  "dans",
  "sur",
  "qui",
  "que",
  "mon",
  "mes",
  "son",
  "est",
]);

const speechHintCategories = new Set(["employer", "project", "skill", "certification"]);

/**
 * Names from the record that speech recognition should expect (#2414): employers, projects,
 * skills and certifications short enough to be a name, from facts the interview may send.
 */
export function careerInterviewSpeechHints(
  facts: readonly CareerInterviewFact[],
  mayTransmit: (fact: CareerInterviewFact) => boolean,
  maximum = 50,
): string[] {
  const hints = new Map<string, string>();
  for (const fact of facts) {
    if (!speechHintCategories.has(fact.category) || !mayTransmit(fact)) continue;
    const value = fact.value.trim().replace(/\s+/g, " ");
    if (value === "" || value.length > 60 || value.split(" ").length > 6) continue;
    const key = value.toLowerCase();
    if (!hints.has(key)) hints.set(key, value);
    if (hints.size >= maximum) break;
  }
  return [...hints.values()];
}
