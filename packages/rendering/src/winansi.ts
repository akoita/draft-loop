/** Windows-1252 (PDF WinAnsiEncoding) code mapping shared by the PDF writer and the layout. */

export const windows1252Specials: Readonly<Record<string, number>> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** The WinAnsi code for one character, or null when the encoding cannot draw it. */
export function winAnsiCode(character: string): number | null {
  const special = windows1252Specials[character];
  if (special !== undefined) return special;
  const code = character.codePointAt(0) ?? 0x3f;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return null;
}

/** Text for each WinAnsi code in the 0x80 to 0x9f block, for decoding recovered literals. */
export const windows1252Characters: ReadonlyMap<number, string> = new Map(
  Object.entries(windows1252Specials).map(([character, code]) => [code, character]),
);

/** The Unicode code point a WinAnsi code draws; undefined codes draw a bullet, as the PDF spec says. */
export function winAnsiCodePoint(code: number): number {
  const special = windows1252Characters.get(code);
  if (special !== undefined) return special.codePointAt(0) ?? 0x2022;
  if (code >= 0x80 && code <= 0x9f) return 0x2022;
  return code;
}
