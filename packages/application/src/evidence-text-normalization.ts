/**
 * Evidence-text comparison for extracted profile facts. Two levels are shared by every grounding
 * check so they cannot drift:
 *
 * - plain: NFKC, trimmed, whitespace-collapsed, case-folded text (the original rule);
 * - formatting-tolerant: plain plus removal of meaning-preserving Markdown formatting (emphasis and
 *   inline-code markers, leading list/heading/blockquote markers, link markup reduced to its text)
 *   and folding of typographic quotes and dashes. Paraphrases are never matched.
 *
 * The formatting-tolerant form keeps an offset map into the original text so a match can be
 * reported as the exact, verbatim source substring.
 */

export function normalizePlainEvidenceText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export interface FormattedEvidenceText {
  readonly text: string;
  /** Original start offset of each normalized character. */
  readonly starts: readonly number[];
  /** Original end offset (exclusive) of each normalized character. */
  readonly ends: readonly number[];
}

const lineMarkerPattern =
  /[ \t]*(?:(?:#{1,6}|[-*+•]|\d{1,3}[.)])[ \t]+|>[ \t]?)(?:\[[ xX]\][ \t]+)?/y;
const linkPattern = /(!?)\[([^[\]\n]*)\]\(([^()\n]*)\)/gu;
const singleQuotes = /[‘’‚‛′]/u;
const doubleQuotes = /[“”„‟″«»]/u;
const dashes = /[‐‑‒–—―−]/u;
const alphanumeric = /[\p{L}\p{N}]/u;
const combiningMark = /\p{M}/u;

function markDroppedLineMarkers(text: string, dropped: Uint8Array): void {
  let lineStart = 0;
  while (lineStart <= text.length) {
    let position = lineStart;
    for (;;) {
      lineMarkerPattern.lastIndex = position;
      const match = lineMarkerPattern.exec(text);
      if (match === null || match[0].length === 0) break;
      dropped.fill(1, position, position + match[0].length);
      position += match[0].length;
    }
    const newline = text.indexOf("\n", lineStart);
    if (newline === -1) break;
    lineStart = newline + 1;
  }
}

function markDroppedLinkMarkup(text: string, dropped: Uint8Array): void {
  for (const match of text.matchAll(linkPattern)) {
    const start = match.index;
    const bang = match[1]?.length ?? 0;
    const label = match[2]?.length ?? 0;
    dropped.fill(1, start, start + bang + 1);
    dropped.fill(1, start + bang + 1 + label, start + match[0].length);
  }
}

function markDroppedInlineMarkers(text: string, dropped: Uint8Array): void {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "*" || char === "`") {
      dropped[index] = 1;
    } else if (char === "~" && (text[index + 1] === "~" || text[index - 1] === "~")) {
      dropped[index] = 1;
    } else if (
      char === "_" &&
      !(alphanumeric.test(text[index - 1] ?? "") && alphanumeric.test(text[index + 1] ?? ""))
    ) {
      dropped[index] = 1;
    }
  }
}

function foldCharacter(char: string): string {
  if (/\s/u.test(char)) return " ";
  if (singleQuotes.test(char)) return "'";
  if (doubleQuotes.test(char)) return '"';
  if (dashes.test(char)) return "-";
  return char;
}

/** Normalize text with formatting removed, keeping an offset map back to the original. */
export function normalizeFormattedEvidenceText(original: string): FormattedEvidenceText {
  const dropped = new Uint8Array(original.length);
  markDroppedLineMarkers(original, dropped);
  markDroppedLinkMarkup(original, dropped);
  markDroppedInlineMarkers(original, dropped);

  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  while (index < original.length) {
    if (dropped[index] === 1) {
      index += 1;
      continue;
    }
    const start = index;
    index += (original.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    while (index < original.length && dropped[index] !== 1) {
      const next = String.fromCodePoint(original.codePointAt(index) ?? 0);
      if (!combiningMark.test(next)) break;
      index += next.length;
    }
    const cluster = original.slice(start, index).normalize("NFKC").toLowerCase();
    for (const raw of cluster) {
      const char = foldCharacter(raw);
      if (char === " " && (characters.length === 0 || characters.at(-1) === " ")) continue;
      characters.push(char);
      starts.push(start);
      ends.push(index);
    }
  }
  if (characters.at(-1) === " ") {
    characters.pop();
    starts.pop();
    ends.pop();
  }
  return Object.freeze({ text: characters.join(""), starts, ends });
}

/** Whether `value` occurs in `quote` at the plain or the formatting-tolerant level. */
export function valueOccursInQuote(value: string, quote: string): boolean {
  const plainValue = normalizePlainEvidenceText(value);
  const plainQuote = normalizePlainEvidenceText(quote);
  if (plainValue.length > 0 && plainQuote.includes(plainValue)) return true;
  const formattedValue = normalizeFormattedEvidenceText(value).text;
  return (
    formattedValue.length > 0 && normalizeFormattedEvidenceText(quote).text.includes(formattedValue)
  );
}

export interface EvidenceSourceIndex {
  /** Whether the quote occurs in the source at the plain or formatting-tolerant level. */
  readonly containsQuote: (sourceId: string, quote: string) => boolean;
  /**
   * The exact source substring that a formatting-tolerant match covers, or undefined when the quote
   * is already a plain match, is absent, or the source is unknown.
   */
  readonly locateExactQuote: (sourceId: string, quote: string) => string | undefined;
}

/** Lazily index each source once so many quotes can be checked against a large document. */
export function createEvidenceSourceIndex(
  sourceTexts: ReadonlyMap<string, string>,
): EvidenceSourceIndex {
  const plain = new Map<string, string>();
  const formatted = new Map<string, FormattedEvidenceText>();
  const plainSource = (sourceId: string, text: string): string => {
    let value = plain.get(sourceId);
    if (value === undefined) {
      value = normalizePlainEvidenceText(text);
      plain.set(sourceId, value);
    }
    return value;
  };
  const formattedSource = (sourceId: string, text: string): FormattedEvidenceText => {
    let value = formatted.get(sourceId);
    if (value === undefined) {
      value = normalizeFormattedEvidenceText(text);
      formatted.set(sourceId, value);
    }
    return value;
  };
  const isPlainMatch = (sourceId: string, text: string, quote: string): boolean => {
    const plainQuote = normalizePlainEvidenceText(quote);
    return plainQuote.length > 0 && plainSource(sourceId, text).includes(plainQuote);
  };

  const index: EvidenceSourceIndex = {
    containsQuote(sourceId, quote) {
      const text = sourceTexts.get(sourceId);
      if (text === undefined) return false;
      if (isPlainMatch(sourceId, text, quote)) return true;
      const formattedQuote = normalizeFormattedEvidenceText(quote).text;
      return (
        formattedQuote.length > 0 && formattedSource(sourceId, text).text.includes(formattedQuote)
      );
    },
    locateExactQuote(sourceId, quote) {
      const text = sourceTexts.get(sourceId);
      if (text === undefined || isPlainMatch(sourceId, text, quote)) return undefined;
      const formattedQuote = normalizeFormattedEvidenceText(quote).text;
      if (formattedQuote.length === 0) return undefined;
      const source = formattedSource(sourceId, text);
      const at = source.text.indexOf(formattedQuote);
      if (at === -1) return undefined;
      const start = source.starts[at];
      const end = source.ends[at + formattedQuote.length - 1];
      return start === undefined || end === undefined ? undefined : text.slice(start, end);
    },
  };
  return Object.freeze(index);
}
