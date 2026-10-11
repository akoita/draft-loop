// Latin typographic ligatures (U+FB00 to U+FB06) that PDF text layers often keep. Expanding
// them lets "eﬃcient" match "efficient" in extraction quotes and evidence search.
const ligatures: Readonly<Record<string, string>> = {
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬅ: "st",
  ﬆ: "st",
};

/** Replace Latin typographic ligatures with their letters; other text is unchanged. */
export function expandLigatures(text: string): string {
  return text.replace(/[ﬀ-ﬆ]/gu, (ligature) => ligatures[ligature] ?? ligature);
}

/** Below this many Latin-script words, a text is too short to judge. */
export const minimumJudgedJobTextWords = 30;
/** The share of implausible Latin-script words from which a text counts as garbled. */
export const garbledJobTextWordShare = 0.25;

const latinWord = /^[A-Za-zÀ-ɏ]{3,}$/u;
const vowel = /[aeiouyAEIOUYÀ-ÆÈ-ÏÒ-ÖØ-Ýà-æè-ïò-öø-ýÿ]/u;

/**
 * Whether a word is unlikely in prose: a lowercase letter followed by two capitals ("ViHHG"),
 * a capital ending a mixed-case word ("FsaocG"), or no vowel in a mixed or lowercase word.
 * Acronyms in capitals and ordinary camel case such as "JavaScript" or "DevOps" stay plausible.
 */
function implausibleWord(word: string): boolean {
  if (word === word.toUpperCase()) return false;
  if (/\p{Ll}\p{Lu}{2}/u.test(word)) return true;
  if (/\p{Ll}\p{Lu}$/u.test(word)) return true;
  return !vowel.test(word);
}

/**
 * Whether extracted job text looks garbled, as a broken PDF text layer produces ("Pays / FsaocG /
 * ViHHG"). Replacement and private-use characters, or a high share of implausible Latin-script
 * words, mark it. Texts with too few Latin-script words are not judged, so short or non-Latin
 * job texts pass.
 */
export function looksGarbled(text: string): boolean {
  const unreadable = text.match(/[�-]/gu)?.length ?? 0;
  const words = (text.match(/[\p{L}]+/gu) ?? []).filter((word) => latinWord.test(word));
  if (words.length < minimumJudgedJobTextWords) return false;
  const implausible = words.filter(implausibleWord).length + unreadable;
  return implausible / words.length >= garbledJobTextWordShare;
}
