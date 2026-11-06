/**
 * The languages a document can be written in, and a small offline guess of a text's language.
 *
 * The guess counts frequent function words. It needs no model and no download, so the screens,
 * the service and the checks can all run it. It answers only when one language clearly leads.
 */

export interface DocumentLanguage {
  readonly code: string;
  readonly label: string;
}

/** The languages a workspace or an application can choose for its documents. */
export const documentLanguages: readonly DocumentLanguage[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pt", label: "Portuguese" },
];

export const documentLanguageCodes: readonly string[] = documentLanguages.map(({ code }) => code);

export function isDocumentLanguage(code: string): boolean {
  return documentLanguageCodes.includes(code);
}

/** The label of a language code, or the code itself when it is not one of the offered ones. */
export function documentLanguageLabel(code: string): string {
  return documentLanguages.find((language) => language.code === code)?.label ?? code;
}

/**
 * Frequent function words per language. A word may appear under two languages; the words only
 * one language uses decide between them.
 */
// prettier-ignore
const functionWords: Readonly<Record<string, readonly string[]>> = {
  en: [
    "the",
    "and",
    "of",
    "to",
    "with",
    "for",
    "is",
    "are",
    "you",
    "our",
    "we",
    "will",
    "be",
    "this",
    "that",
    "on",
    "your",
    "an",
    "or",
    "have",
    "from",
    "who",
    "they",
    "by",
    "at",
  ],
  fr: [
    "le",
    "la",
    "les",
    "des",
    "et",
    "est",
    "une",
    "pour",
    "dans",
    "avec",
    "nous",
    "vous",
    "sur",
    "qui",
    "au",
    "aux",
    "du",
    "ce",
    "cette",
    "sont",
    "votre",
    "notre",
    "être",
    "vos",
    "nos",
  ],
  de: [
    "der",
    "die",
    "das",
    "und",
    "ist",
    "mit",
    "für",
    "wir",
    "sie",
    "ein",
    "eine",
    "zu",
    "von",
    "auf",
    "den",
    "dem",
    "nicht",
    "auch",
    "ihre",
    "sind",
    "im",
    "bei",
    "oder",
    "unser",
  ],
  es: [
    "el",
    "los",
    "las",
    "y",
    "del",
    "para",
    "con",
    "una",
    "por",
    "que",
    "es",
    "se",
    "su",
    "nuestro",
    "como",
    "al",
    "sus",
    "más",
    "tu",
    "estamos",
    "buscamos",
  ],
  it: [
    "il",
    "gli",
    "di",
    "che",
    "è",
    "per",
    "con",
    "una",
    "della",
    "delle",
    "sono",
    "nel",
    "alla",
    "nostro",
    "siamo",
    "anche",
    "dei",
    "lo",
    "cerchiamo",
  ],
  nl: [
    "het",
    "een",
    "van",
    "en",
    "voor",
    "met",
    "zijn",
    "wij",
    "je",
    "op",
    "ons",
    "onze",
    "bij",
    "niet",
    "naar",
    "ook",
    "wordt",
    "jouw",
    "dat",
  ],
  pt: [
    "o",
    "os",
    "e",
    "da",
    "do",
    "das",
    "dos",
    "para",
    "com",
    "uma",
    "em",
    "não",
    "nossa",
    "você",
    "é",
    "ao",
    "na",
    "no",
    "procuramos",
  ],
};

const minimumHits = 5;
const minimumShare = 0.45;

export interface DetectedLanguage {
  readonly code: string;
  /** The leading language's share of all function-word hits, from 0 to 1. */
  readonly share: number;
}

/** The lowercase words of a text, accents kept. */
export function languageWords(text: string): readonly string[] {
  return text.toLocaleLowerCase("und").match(/\p{L}+/gu) ?? [];
}

/**
 * The text's language when one clearly leads, else `undefined`: too short, a mix, or a language
 * the guess does not know.
 */
export function detectTextLanguage(text: string): DetectedLanguage | undefined {
  const counts = new Map<string, number>();
  let total = 0;
  for (const word of languageWords(text)) {
    for (const [code, words] of Object.entries(functionWords)) {
      if (words.includes(word)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
        total += 1;
      }
    }
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const [first, second] = ranked;
  if (first === undefined || first[1] < minimumHits) return undefined;
  const share = first[1] / total;
  if (share < minimumShare) return undefined;
  if (second !== undefined && second[1] * 1.5 > first[1]) return undefined;
  return { code: first[0], share };
}
