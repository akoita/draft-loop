import { constants, inflateSync } from "node:zlib";

import { PdfTextLayoutCollector } from "./pdf-text-layout.js";

/**
 * Text extraction for unencrypted PDFs without a PDF library.
 *
 * Pages are read through the document's object graph so that every text-show operator is decoded
 * with the ToUnicode map of the font selected by `Tf`. Subset fonts reuse the same glyph codes for
 * different characters, so a single document-wide map garbles any PDF with more than one font.
 * Files without a readable page tree fall back to scanning every stream.
 */

/** A text-show string: its bytes after literal escapes or hex decoding, and how it was written. */
interface PdfStringOperand {
  readonly kind: "string";
  readonly bytes: string;
  readonly hex: boolean;
  readonly start: number;
}

type PdfOperand =
  | PdfStringOperand
  | { readonly kind: "array"; readonly items: readonly PdfStringOperand[]; readonly start: number }
  | { readonly kind: "name"; readonly value: string; readonly start: number }
  | { readonly kind: "other"; readonly start: number };

interface PdfFont {
  decode(operand: PdfStringOperand): string;
}

interface PdfResources {
  font(name: string): PdfFont;
  form(name: string): { readonly content: string; readonly resources: PdfResources } | undefined;
}

interface PdfObject {
  readonly body: string;
  readonly stream?: string;
}

interface PdfCMap {
  readonly map: ReadonlyMap<number, string>;
  readonly codeBytes: 1 | 2 | undefined;
}

const maxFormDepth = 12;
const maxCMapRange = 0x10000;
const delimiter = /[\s()[\]{}<>/%]/u;
const numberToken = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u;
const referencePattern = /^(\d+)\s+(\d+)\s+R$/u;

/** Windows-1252 differs from Latin-1 only in 0x80-0x9F, where Latin-1 has C1 controls. */
const winAnsiHighCodes: Readonly<Record<number, number>> = {
  128: 0x20ac,
  130: 0x201a,
  131: 0x0192,
  132: 0x201e,
  133: 0x2026,
  134: 0x2020,
  135: 0x2021,
  136: 0x02c6,
  137: 0x2030,
  138: 0x0160,
  139: 0x2039,
  140: 0x0152,
  142: 0x017d,
  145: 0x2018,
  146: 0x2019,
  147: 0x201c,
  148: 0x201d,
  149: 0x2022,
  150: 0x2013,
  151: 0x2014,
  152: 0x02dc,
  153: 0x2122,
  154: 0x0161,
  155: 0x203a,
  156: 0x0153,
  158: 0x017e,
  159: 0x0178,
};

function latin1Bytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/** Page layout never means a blank line: whitespace-only runs (a space between styled words) are dropped. */
function trimLines(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

function decodePdfLiteral(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      result += character;
      continue;
    }
    const escaped = value[++index] ?? "";
    const escapes: Readonly<Record<string, string>> = {
      "\\": "\\",
      "(": "(",
      ")": ")",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escapes[escaped] !== undefined) {
      result += escapes[escaped];
      continue;
    }
    if (/[0-7]/u.test(escaped)) {
      const octal = `${escaped}${value[index + 1] ?? ""}${value[index + 2] ?? ""}`.match(
        /^[0-7]{1,3}/u,
      )?.[0];
      if (octal !== undefined) {
        result += String.fromCharCode(Number.parseInt(octal, 8) & 0xff);
        index += octal.length - 1;
        continue;
      }
    }
    if (escaped === "\n") continue;
    if (escaped === "\r" && value[index + 1] === "\n") index += 1;
  }
  return result;
}

/** Returns the raw (still escaped) literal body and the index after its closing parenthesis. */
function readLiteral(value: string, start: number): { readonly raw: string; readonly end: number } {
  let depth = 1;
  let index = start + 1;
  while (index < value.length) {
    const character = value[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return { raw: value.slice(start + 1, index), end: index + 1 };
    }
    index += 1;
  }
  return { raw: value.slice(start + 1), end: value.length };
}

function hexBytes(hex: string): string {
  const digits = hex.replace(/[^0-9a-fA-F]/gu, "");
  const padded = digits.length % 2 === 0 ? digits : `${digits}0`;
  let result = "";
  for (let index = 0; index < padded.length; index += 2) {
    result += String.fromCharCode(Number.parseInt(padded.slice(index, index + 2), 16));
  }
  return result;
}

function skipWhitespaceAndComments(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    const character = value[index] ?? "";
    if (/\s/u.test(character)) {
      index += 1;
    } else if (character === "%") {
      while (index < value.length && value[index] !== "\n" && value[index] !== "\r") index += 1;
    } else {
      break;
    }
  }
  return index;
}

/** Reads one PDF object value (dictionary, array, string, name, number, reference or keyword). */
function readValue(value: string, start: number): { readonly raw: string; readonly end: number } {
  const index = skipWhitespaceAndComments(value, start);
  const character = value[index] ?? "";
  if (value.startsWith("<<", index) || character === "[") {
    const closing = character === "[" ? "]" : ">>";
    let cursor = index + (character === "[" ? 1 : 2);
    while (cursor < value.length) {
      cursor = skipWhitespaceAndComments(value, cursor);
      if (value.startsWith(closing, cursor)) {
        cursor += closing.length;
        return { raw: value.slice(index, cursor), end: cursor };
      }
      if (cursor >= value.length) break;
      const next = readValue(value, cursor);
      cursor = next.end > cursor ? next.end : cursor + 1;
    }
    return { raw: value.slice(index), end: value.length };
  }
  if (character === "(") {
    const literal = readLiteral(value, index);
    return { raw: value.slice(index, literal.end), end: literal.end };
  }
  if (character === "<") {
    const closing = value.indexOf(">", index + 1);
    const end = closing < 0 ? value.length : closing + 1;
    return { raw: value.slice(index, end), end };
  }
  if (character === "/") {
    let end = index + 1;
    while (end < value.length && !delimiter.test(value[end] ?? "")) end += 1;
    return { raw: value.slice(index, end), end };
  }
  if (character === "" || "])>{}".includes(character)) {
    return { raw: "", end: Math.min(value.length, index + 1) };
  }
  let end = index;
  while (end < value.length && !delimiter.test(value[end] ?? "")) end += 1;
  const reference = /^\s+(\d+)\s+R(?![^\s()[\]{}<>/%])/u.exec(value.slice(end, end + 32));
  if (/^\d+$/u.test(value.slice(index, end)) && reference !== null) {
    end += reference[0].length;
  }
  return { raw: value.slice(index, end), end };
}

function parseDictionary(raw: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  let index = skipWhitespaceAndComments(raw, 0);
  if (!raw.startsWith("<<", index)) return entries;
  index += 2;
  while (index < raw.length) {
    index = skipWhitespaceAndComments(raw, index);
    if (raw.startsWith(">>", index) || index >= raw.length) break;
    const key = readValue(raw, index);
    if (!key.raw.startsWith("/")) {
      index = key.end > index ? key.end : index + 1;
      continue;
    }
    const entry = readValue(raw, key.end);
    entries.set(key.raw.slice(1), entry.raw.trim());
    index = entry.end;
  }
  return entries;
}

function arrayItems(raw: string): readonly string[] {
  const items: string[] = [];
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) return items;
  let index = 1;
  while (index < trimmed.length) {
    index = skipWhitespaceAndComments(trimmed, index);
    if (trimmed[index] === "]" || index >= trimmed.length) break;
    const item = readValue(trimmed, index);
    if (item.raw !== "") items.push(item.raw.trim());
    index = item.end > index ? item.end : index + 1;
  }
  return items;
}

function utf16Hex(hex: string): string {
  if (hex.length <= 2) return String.fromCharCode(Number.parseInt(hex, 16));
  let result = "";
  for (let index = 0; index + 4 <= hex.length; index += 4) {
    result += String.fromCharCode(Number.parseInt(hex.slice(index, index + 4), 16));
  }
  return result;
}

function parsePdfCMap(cmapText: string): PdfCMap {
  const map = new Map<number, string>();
  const codespace = /begincodespacerange\s*<([0-9a-fA-F]+)>/u.exec(cmapText)?.[1];
  const codeBytes = codespace === undefined ? undefined : codespace.length <= 2 ? 1 : 2;
  for (const section of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu)) {
    for (const entry of (section[1] ?? "").matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/gu)) {
      map.set(Number.parseInt(entry[1] ?? "", 16), utf16Hex(entry[2] ?? ""));
    }
  }
  for (const section of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
    const ranges = (section[1] ?? "").matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/gu,
    );
    for (const range of ranges) {
      const first = Number.parseInt(range[1] ?? "", 16);
      const last = Number.parseInt(range[2] ?? "", 16);
      if (Number.isNaN(first) || Number.isNaN(last) || last < first) continue;
      if (last - first >= maxCMapRange) continue;
      if (range[4] !== undefined) {
        const targets = [...range[4].matchAll(/<([0-9a-fA-F]*)>/gu)];
        targets.forEach((target, offset) => {
          if (first + offset <= last) map.set(first + offset, utf16Hex(target[1] ?? ""));
        });
        continue;
      }
      const base = utf16Hex(range[3] ?? "");
      if (base === "") continue;
      const prefix = base.slice(0, -1);
      const lastUnit = base.charCodeAt(base.length - 1);
      for (let code = first; code <= last; code += 1) {
        map.set(code, prefix + String.fromCharCode(lastUnit + (code - first)));
      }
    }
  }
  return { map, codeBytes };
}

/** Pre-structure behaviour: hex strings use a document-wide map, literals pass through. */
function fallbackFont(map: ReadonlyMap<number, string>): PdfFont {
  return {
    decode(operand) {
      if (!operand.hex) return operand.bytes;
      const width = operand.bytes.length >= 2 && operand.bytes.length % 2 === 0 ? 2 : 1;
      let result = "";
      for (let index = 0; index + width <= operand.bytes.length; index += width) {
        const code =
          width === 2
            ? (operand.bytes.charCodeAt(index) << 8) | operand.bytes.charCodeAt(index + 1)
            : operand.bytes.charCodeAt(index);
        const mapped = map.get(code);
        if (mapped !== undefined) result += mapped;
        else if (code > 0) result += String.fromCharCode(code);
      }
      return result;
    },
  };
}

function simpleOrCompositeFont(cmap: PdfCMap | undefined, composite: boolean, winAnsi: boolean) {
  const width = cmap?.codeBytes ?? (composite ? 2 : 1);
  return {
    decode(operand: PdfStringOperand): string {
      let result = "";
      for (let index = 0; index + width <= operand.bytes.length; index += width) {
        const code =
          width === 2
            ? (operand.bytes.charCodeAt(index) << 8) | operand.bytes.charCodeAt(index + 1)
            : operand.bytes.charCodeAt(index);
        const mapped = cmap?.map.get(code);
        if (mapped !== undefined) {
          result += mapped;
        } else if (width === 1 && code > 0) {
          // Single-byte codes without a map are the font's encoding; two-byte codes without a
          // map are glyph ids and carry no text.
          result += String.fromCharCode((winAnsi && winAnsiHighCodes[code]) || code);
        }
      }
      return result;
    },
  } satisfies PdfFont;
}

class PdfDocument {
  private readonly objects = new Map<number, PdfObject>();
  private readonly decoded = new Map<number, string | undefined>();
  private readonly fonts = new Map<number, PdfFont>();
  private readonly cmaps = new Map<number, PdfCMap | undefined>();
  private readonly emptyFont = fallbackFont(new Map());

  constructor(private readonly binary: string) {
    this.readObjects();
    this.readObjectStreams();
  }

  /** Text of every page in page-tree order, or undefined when no page could be found. */
  pagesText(): readonly string[] | undefined {
    const pages = this.pageObjectNumbers();
    if (pages.length === 0) return undefined;
    return pages.map((page) => {
      const dictionary = this.dictionaryOf(page);
      const layout = new PdfTextLayoutCollector();
      const content = this.contents(dictionary.get("Contents"));
      this.scan(content, this.resources(this.inheritedResources(page)), layout, new Set(), 0);
      return trimLines(layout.toString());
    });
  }

  /** Every decodable stream, scanned with one document-wide character map. */
  streamsText(): readonly string[] {
    const merged = new Map<number, string>();
    const streams: string[] = [];
    for (const objectNumber of this.objects.keys()) {
      const text = this.stream(objectNumber);
      if (text === undefined) continue;
      streams.push(text);
      if (text.includes("begincmap")) {
        for (const [code, value] of parsePdfCMap(text).map) merged.set(code, value);
      }
    }
    for (const stream of this.looseStreams()) {
      streams.push(stream);
      if (stream.includes("begincmap")) {
        for (const [code, value] of parsePdfCMap(stream).map) merged.set(code, value);
      }
    }
    const font = fallbackFont(merged);
    const resources: PdfResources = { font: () => font, form: () => undefined };
    return streams.map((stream) => {
      const layout = new PdfTextLayoutCollector();
      this.scan(stream, resources, layout, new Set(), maxFormDepth);
      return trimLines(layout.toString());
    });
  }

  private readObjects(): void {
    const header = /(\d+)\s+(\d+)\s+obj\b/gu;
    let match = header.exec(this.binary);
    while (match !== null) {
      const objectNumber = Number(match[1]);
      const bodyStart = match.index + match[0].length;
      const value = readValue(this.binary, bodyStart);
      let cursor = skipWhitespaceAndComments(this.binary, value.end);
      let stream: string | undefined;
      if (value.raw.startsWith("<<") && this.binary.startsWith("stream", cursor)) {
        const parsed = this.readStreamData(cursor + "stream".length, parseDictionary(value.raw));
        stream = parsed.data;
        cursor = parsed.end;
      }
      this.objects.set(
        objectNumber,
        stream === undefined ? { body: value.raw } : { body: value.raw, stream },
      );
      // Resume after the value and any stream data, so binary data is never read as a header.
      header.lastIndex = Math.max(cursor, bodyStart);
      match = header.exec(this.binary);
    }
  }

  private readStreamData(
    afterKeyword: number,
    dictionary: ReadonlyMap<string, string>,
  ): { readonly data: string; readonly end: number } {
    let start = afterKeyword;
    if (this.binary.startsWith("\r\n", start)) start += 2;
    else if (this.binary[start] === "\n" || this.binary[start] === "\r") start += 1;
    const length = Number(dictionary.get("Length"));
    if (Number.isSafeInteger(length) && length >= 0) {
      const after = skipWhitespaceAndComments(this.binary, start + length);
      if (this.binary.startsWith("endstream", after)) {
        return { data: this.binary.slice(start, start + length), end: after + "endstream".length };
      }
    }
    const endStream = this.binary.indexOf("endstream", start);
    if (endStream < 0) return { data: this.binary.slice(start), end: this.binary.length };
    const data = this.binary.slice(start, endStream).replace(/(?:\r\n|\n|\r)$/u, "");
    return { data, end: endStream + "endstream".length };
  }

  private readObjectStreams(): void {
    for (const [objectNumber, object] of [...this.objects]) {
      const dictionary = parseDictionary(object.body);
      if (dictionary.get("Type") !== "/ObjStm") continue;
      const text = this.stream(objectNumber);
      const count = Number(dictionary.get("N"));
      const first = Number(dictionary.get("First"));
      if (text === undefined || !Number.isSafeInteger(count) || !Number.isSafeInteger(first)) {
        continue;
      }
      const numbers = text.slice(0, first).trim().split(/\s+/u).map(Number);
      for (let index = 0; index < count; index += 1) {
        const member = numbers[index * 2];
        const offset = numbers[index * 2 + 1];
        if (member === undefined || offset === undefined || this.objects.has(member)) continue;
        const end = numbers[index * 2 + 3];
        const body = text.slice(first + offset, end === undefined ? undefined : first + end);
        this.objects.set(member, { body: readValue(body, 0).raw });
      }
    }
  }

  /** Streams not inside a parsed `obj` (malformed files); kept so nothing that used to extract is lost. */
  private looseStreams(): readonly string[] {
    if (this.objects.size > 0) return [];
    const streams: string[] = [];
    for (const match of this.binary.matchAll(
      /stream(?:\r\n|\n|\r)([\s\S]*?)(?:(?:\r\n|\n|\r)endstream|$)/gu,
    )) {
      const dictionary = this.binary.slice(Math.max(0, (match.index ?? 0) - 1200), match.index);
      const decoded = this.decode(match[1] ?? "", /\/FlateDecode\b/u.test(dictionary));
      if (decoded !== undefined) streams.push(decoded);
    }
    return streams;
  }

  private decode(data: string, flate: boolean): string | undefined {
    if (!flate) return data;
    try {
      const inflated = inflateSync(latin1Bytes(data), { finishFlush: constants.Z_SYNC_FLUSH });
      return Buffer.from(inflated).toString("latin1");
    } catch {
      return undefined;
    }
  }

  private stream(objectNumber: number): string | undefined {
    if (this.decoded.has(objectNumber)) return this.decoded.get(objectNumber);
    const object = this.objects.get(objectNumber);
    let text: string | undefined;
    if (object?.stream !== undefined) {
      const filter = this.resolve(parseDictionary(object.body).get("Filter")) ?? "";
      const filters = filter.match(/\/[^\s/[\]]+/gu) ?? [];
      if (filters.length === 0) text = object.stream;
      else if (filters.every((name) => name === "/FlateDecode" || name === "/Fl")) {
        text = filters.length === 1 ? this.decode(object.stream, true) : undefined;
      }
    }
    this.decoded.set(objectNumber, text);
    return text;
  }

  private referenceNumber(raw: string | undefined): number | undefined {
    const match = raw === undefined ? null : referencePattern.exec(raw.trim());
    return match === null ? undefined : Number(match[1]);
  }

  /** Follows an indirect reference to the referenced object's value; direct values pass through. */
  private resolve(raw: string | undefined, depth = 0): string | undefined {
    const objectNumber = this.referenceNumber(raw);
    if (objectNumber === undefined) return raw;
    if (depth > 8) return undefined;
    return this.resolve(this.objects.get(objectNumber)?.body, depth + 1);
  }

  private dictionaryOf(objectNumber: number): ReadonlyMap<string, string> {
    return parseDictionary(this.objects.get(objectNumber)?.body ?? "");
  }

  private pageObjectNumbers(): readonly number[] {
    const pages: number[] = [];
    const visited = new Set<number>();
    const walk = (objectNumber: number | undefined) => {
      if (objectNumber === undefined || visited.has(objectNumber)) return;
      visited.add(objectNumber);
      const dictionary = this.dictionaryOf(objectNumber);
      const kids = this.resolve(dictionary.get("Kids"));
      if (kids !== undefined) {
        for (const kid of arrayItems(kids)) walk(this.referenceNumber(kid));
      } else if (dictionary.get("Type") === "/Page") {
        pages.push(objectNumber);
      }
    };
    const root = this.referenceNumber(this.trailer().get("Root"));
    if (root !== undefined) walk(this.referenceNumber(this.dictionaryOf(root).get("Pages")));
    if (pages.length > 0) return pages;
    // Without a usable catalog, take page objects in file order.
    return [...this.objects.keys()].filter(
      (objectNumber) => this.dictionaryOf(objectNumber).get("Type") === "/Page",
    );
  }

  private trailer(): ReadonlyMap<string, string> {
    const trailerIndex = this.binary.lastIndexOf("trailer");
    if (trailerIndex >= 0) {
      const trailer = parseDictionary(readValue(this.binary, trailerIndex + "trailer".length).raw);
      if (trailer.has("Root")) return trailer;
    }
    let found: ReadonlyMap<string, string> = new Map();
    for (const object of this.objects.values()) {
      const dictionary = parseDictionary(object.body);
      if (dictionary.get("Type") === "/XRef" && dictionary.has("Root")) found = dictionary;
    }
    return found;
  }

  private inheritedResources(page: number): string | undefined {
    const visited = new Set<number>();
    let current: number | undefined = page;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const dictionary = this.dictionaryOf(current);
      const resources = dictionary.get("Resources");
      if (resources !== undefined) return resources;
      current = this.referenceNumber(dictionary.get("Parent"));
    }
    return undefined;
  }

  private contents(raw: string | undefined): string {
    const value = this.resolve(raw);
    const objectNumber = this.referenceNumber(raw);
    if (value?.trim().startsWith("[")) {
      return arrayItems(value)
        .map((item) => this.stream(this.referenceNumber(item) ?? -1) ?? "")
        .join("\n");
    }
    return objectNumber === undefined ? "" : (this.stream(objectNumber) ?? "");
  }

  private resources(raw: string | undefined): PdfResources {
    const dictionary = parseDictionary(this.resolve(raw) ?? "");
    const fonts = parseDictionary(this.resolve(dictionary.get("Font")) ?? "");
    const xObjects = parseDictionary(this.resolve(dictionary.get("XObject")) ?? "");
    return {
      font: (name) => this.font(fonts.get(name)),
      form: (name) => {
        const objectNumber = this.referenceNumber(xObjects.get(name));
        if (objectNumber === undefined) return undefined;
        const form = this.dictionaryOf(objectNumber);
        if (form.get("Subtype") !== "/Form") return undefined;
        const content = this.stream(objectNumber);
        if (content === undefined) return undefined;
        const formResources = form.get("Resources");
        return {
          content,
          resources:
            formResources === undefined ? this.resources(raw) : this.resources(formResources),
        };
      },
    };
  }

  private font(raw: string | undefined): PdfFont {
    const objectNumber = this.referenceNumber(raw);
    const cached = objectNumber === undefined ? undefined : this.fonts.get(objectNumber);
    if (cached !== undefined) return cached;
    const value = this.resolve(raw);
    if (value === undefined) return this.emptyFont;
    const dictionary = parseDictionary(value);
    const toUnicode = this.referenceNumber(dictionary.get("ToUnicode"));
    let cmap: PdfCMap | undefined;
    if (toUnicode !== undefined) {
      if (!this.cmaps.has(toUnicode)) {
        const text = this.stream(toUnicode);
        this.cmaps.set(toUnicode, text === undefined ? undefined : parsePdfCMap(text));
      }
      cmap = this.cmaps.get(toUnicode);
    }
    const encoding = this.resolve(dictionary.get("Encoding")) ?? "";
    const font = simpleOrCompositeFont(
      cmap,
      dictionary.get("Subtype") === "/Type0",
      !/MacRomanEncoding/u.test(encoding),
    );
    if (objectNumber !== undefined) this.fonts.set(objectNumber, font);
    return font;
  }

  private scan(
    content: string,
    resources: PdfResources,
    layout: PdfTextLayoutCollector,
    activeForms: Set<string>,
    depth: number,
  ): void {
    const operands: PdfOperand[] = [];
    let font: PdfFont = this.emptyFont;
    let index = 0;
    let lastShowEnd = 0;
    const show = (text: string, operandStart: number, end: number, newLine = false) => {
      layout.append(text, `${content.slice(lastShowEnd, operandStart)}${newLine ? " T*" : ""}`);
      lastShowEnd = end;
    };

    while (index < content.length) {
      index = skipWhitespaceAndComments(content, index);
      if (index >= content.length) break;
      const start = index;
      const character = content[index] ?? "";
      if (character === "(") {
        const literal = readLiteral(content, index);
        operands.push({ kind: "string", bytes: decodePdfLiteral(literal.raw), hex: false, start });
        index = literal.end;
        continue;
      }
      if (character === "<" && !content.startsWith("<<", index)) {
        const closing = content.indexOf(">", index + 1);
        const end = closing < 0 ? content.length : closing + 1;
        operands.push({
          kind: "string",
          bytes: hexBytes(content.slice(index + 1, end - 1)),
          hex: true,
          start,
        });
        index = end;
        continue;
      }
      if (character === "[") {
        const array = readValue(content, index);
        const items: PdfStringOperand[] = [];
        let cursor = 1;
        while (cursor < array.raw.length) {
          cursor = skipWhitespaceAndComments(array.raw, cursor);
          const item = readValue(array.raw, cursor);
          if (item.raw.startsWith("(")) {
            const literal = readLiteral(item.raw, 0);
            items.push({ kind: "string", bytes: decodePdfLiteral(literal.raw), hex: false, start });
          } else if (item.raw.startsWith("<") && !item.raw.startsWith("<<")) {
            items.push({
              kind: "string",
              bytes: hexBytes(item.raw.slice(1, -1)),
              hex: true,
              start,
            });
          }
          cursor = item.end > cursor ? item.end : cursor + 1;
        }
        operands.push({ kind: "array", items, start });
        index = array.end;
        continue;
      }
      if (character === "/") {
        const name = readValue(content, index);
        operands.push({ kind: "name", value: name.raw.slice(1), start });
        index = name.end;
        continue;
      }
      if (content.startsWith("<<", index)) {
        index = readValue(content, index).end;
        operands.push({ kind: "other", start });
        continue;
      }
      let end = index + 1;
      while (end < content.length && !delimiter.test(content[end] ?? "")) end += 1;
      const token = content.slice(index, end);
      index = end;
      if (numberToken.test(token) || token === "true" || token === "false" || token === "null") {
        operands.push({ kind: "other", start });
        continue;
      }

      const last = operands.at(-1);
      const firstStart = operands[0]?.start ?? start;
      if (token === "Tf") {
        const name = operands.at(-2);
        if (name?.kind === "name") font = resources.font(name.value);
      } else if ((token === "Tj" || token === "'" || token === '"') && last?.kind === "string") {
        show(font.decode(last), firstStart, index, token !== "Tj");
      } else if (token === "TJ" && last?.kind === "array") {
        show(last.items.map((item) => font.decode(item)).join(""), firstStart, index);
      } else if (token === "Do" && last?.kind === "name" && depth < maxFormDepth) {
        const form = activeForms.has(last.value) ? undefined : resources.form(last.value);
        if (form !== undefined) {
          show("", firstStart, index);
          activeForms.add(last.value);
          this.scan(form.content, form.resources, layout, activeForms, depth + 1);
          activeForms.delete(last.value);
        }
      } else if (token === "BI") {
        // Inline image data is binary; skip to its end marker.
        show("", start, index);
        const data = /\sID\s/u.exec(content.slice(index));
        const imageEnd =
          data === null
            ? null
            : /\sEI(?=\s|$)/u.exec(content.slice(index + data.index + data[0].length));
        index =
          data === null || imageEnd === null
            ? content.length
            : index + data.index + data[0].length + imageEnd.index + imageEnd[0].length;
        lastShowEnd = Math.max(lastShowEnd, Math.min(index, content.length));
      }
      operands.length = 0;
    }
  }
}

/** Extracts page text from an unencrypted PDF; throws on invalid or encrypted files. */
export function extractPdfText(bytes: Uint8Array): string {
  const binary = Buffer.from(bytes).toString("latin1");
  if (!binary.startsWith("%PDF-")) throw new Error("PDF header is invalid");
  if (/\/Encrypt\b/u.test(binary)) throw new Error("encrypted PDFs are not supported");
  const document = new PdfDocument(binary);
  const pages = document.pagesText()?.filter((page) => page !== "");
  const parts = pages !== undefined && pages.length > 0 ? pages : document.streamsText();
  return parts.filter((part) => part !== "").join("\n");
}
