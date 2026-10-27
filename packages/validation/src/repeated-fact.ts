/**
 * The same fact stated in more than one section: a Summary line, a Core areas line and an
 * Experience bullet that each tell the reader the same thing in nearly the same words. Exact
 * copies are already reported as duplicate claim content; this catches the reworded ones, which
 * is how authors usually repeat themselves.
 */

/** Fewest content words a claim needs before it can count as a fact; shorter ones are labels. */
const MIN_CONTENT_WORDS = 4;
/** Share of the shorter claim's content words the longer one must hold to state the same fact. */
const MIN_SHARED_RATIO = 0.8;

/** Function words in the languages CVs are written in here; they never make two facts the same. */
const stopWords = new Set([
  "a",
  "about",
  "across",
  "after",
  "all",
  "also",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "both",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "over",
  "that",
  "the",
  "their",
  "this",
  "through",
  "to",
  "using",
  "was",
  "were",
  "while",
  "who",
  "with",
  "within",
  "au",
  "aux",
  "avec",
  "dans",
  "de",
  "des",
  "du",
  "en",
  "et",
  "la",
  "le",
  "les",
  "par",
  "pour",
  "sur",
  "un",
  "une",
]);

export interface RepeatedFactClaim {
  readonly id: string;
  readonly text: string;
  readonly sectionId: string;
  readonly substantive: boolean;
}

export interface RepeatedFact {
  /** Every claim stating the fact, in draft order. */
  readonly claimIds: readonly string[];
  /** Each section the fact appears in, in draft order. */
  readonly sectionIds: readonly string[];
}

/** A word's comparable form: lower case, with a plural or verb ending dropped. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function contentWords(text: string): ReadonlySet<string> {
  const words =
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}+#.]*/gu) ?? [];
  return new Set(
    words
      .map((word) => word.replace(/\.+$/u, ""))
      .filter((word) => !stopWords.has(word) && (word.length > 2 || /\p{N}/u.test(word)))
      .map(stem),
  );
}

function normalized(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function sameFact(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  const [shorter, longer] = first.size <= second.size ? [first, second] : [second, first];
  if (shorter.size < MIN_CONTENT_WORDS) return false;
  let shared = 0;
  for (const word of shorter) if (longer.has(word)) shared += 1;
  return shared / shorter.size >= MIN_SHARED_RATIO;
}

/**
 * Groups substantive claims in different sections that share almost all their content words.
 * Each group spans at least two sections; a group whose claims are exact copies is left to the
 * duplicate claim check.
 */
export function findRepeatedFacts(claims: readonly RepeatedFactClaim[]): readonly RepeatedFact[] {
  const facts = claims
    .filter((claim) => claim.substantive)
    .map((claim) => ({ claim, words: contentWords(claim.text) }));
  const parent = facts.map((_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parent[current] !== current) current = parent[current] as number;
    return current;
  };
  for (let first = 0; first < facts.length; first += 1) {
    for (let second = first + 1; second < facts.length; second += 1) {
      const a = facts[first];
      const b = facts[second];
      if (a === undefined || b === undefined || a.claim.sectionId === b.claim.sectionId) continue;
      if (sameFact(a.words, b.words)) parent[root(second)] = root(first);
    }
  }
  const groups = new Map<number, RepeatedFactClaim[]>();
  facts.forEach(({ claim }, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  });
  const repeated: RepeatedFact[] = [];
  for (const group of groups.values()) {
    const sectionIds = [...new Set(group.map(({ sectionId }) => sectionId))];
    if (sectionIds.length < 2) continue;
    if (new Set(group.map(({ text }) => normalized(text))).size === 1) continue;
    repeated.push({ claimIds: group.map(({ id }) => id), sectionIds });
  }
  return repeated;
}
