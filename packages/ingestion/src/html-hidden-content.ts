import { decodeHtmlEntities } from "./html-text.js";

/**
 * Removes the parts of an HTML document a reader cannot see, before it becomes text (#3334).
 *
 * Some job pages carry text a person never sees but a tool reading the page does, such as an
 * instruction aimed at AI writing tools in white or zero-size text. A job ad's text should be what
 * the candidate read, so these elements are dropped, and what they held is reported so the screen
 * can show it.
 *
 * Hidden means, on the element itself or an ancestor:
 *
 * - the `hidden` attribute (not `hidden="until-found"`, which a reader can reveal by searching);
 * - inline `display: none`, `visibility: hidden` or `visibility: collapse`;
 * - inline zero or near-zero size: `font-size` under 2px, 2pt, 0.15em or 15%, or `opacity`
 *   under 0.1;
 * - inline off-screen placement: `left`, `top` or `text-indent` at -1000px or further, or
 *   `clip: rect(0 0 0 0)`;
 * - inline white, transparent or near-white text when no element on the way down sets a
 *   background other than white, so white text on a dark band stays;
 * - the `sr-only`, `visually-hidden`, `visuallyhidden` and `screen-reader-text` classes;
 * - a `<template>` element, whose content is never shown.
 *
 * `aria-hidden="true"` is not hidden: sites often mark visible text that way next to a
 * screen-reader copy. Styles from a stylesheet class are not resolved, since that needs a
 * rendering engine; the phrase screener still reads what they hold.
 *
 * The parser is a forgiving tag scanner, not a full HTML parser. A closing tag closes the nearest
 * open element of its name and everything opened inside it; a stray closing tag is ignored, and
 * an element left open runs to the end of the input. Comments, scripts and styles must already be
 * removed.
 */

export type HiddenHtmlReason = "attribute" | "style" | "off-screen" | "white-text" | "class";

export interface HiddenHtmlText {
  readonly reason: HiddenHtmlReason;
  readonly text: string;
}

export interface VisibleHtml {
  /** The input with hidden elements removed. */
  readonly html: string;
  /** What the hidden elements held, as plain text, in page order; bounded, see below. */
  readonly hidden: readonly HiddenHtmlText[];
}

/** At most this many hidden texts are reported; more are dropped but not reported. */
export const maxReportedHiddenTexts = 20;
/** A reported hidden text is cut to this many characters. */
export const maxReportedHiddenTextCharacters = 400;
/** Fewer words than this is a menu label or an icon name, dropped but not reported. */
export const minReportedHiddenTextWords = 3;

const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const hiddenClasses = new Set([
  "sr-only",
  "visually-hidden",
  "visuallyhidden",
  "screen-reader-text",
]);

const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

interface OpenElement {
  readonly name: string;
  /** Set when this element or an ancestor sets a background other than white. */
  readonly background: boolean;
}

function attributeValue(attributes: string, name: string): string | undefined {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "iu",
  ).exec(attributes);
  if (match === null) return undefined;
  return decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

function hasBareAttribute(attributes: string, name: string): boolean {
  const names = attributes.replace(/"[^"]*"|'[^']*'/gu, '""');
  return new RegExp(`(?:^|\\s)${name}(?=\\s|=|/|$)`, "iu").test(names);
}

/** The declarations of an inline style, by lowercased property, last one winning. */
function styleDeclarations(style: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!important/iu, "")
      .trim()
      .toLowerCase();
    if (property !== "" && value !== "") declarations.set(property, value);
  }
  return declarations;
}

function isTinyFontSize(value: string): boolean {
  const match = /^(-?\d*\.?\d+)\s*(px|pt|em|rem|%)?$/u.exec(value);
  if (match === null) return false;
  const size = Number(match[1]);
  switch (match[2]) {
    case "em":
    case "rem":
      return size < 0.15;
    case "%":
      return size < 15;
    default:
      return size < 2;
  }
}

function isFarOffScreen(value: string | undefined): boolean {
  const match = /^-\s*(\d+(?:\.\d+)?)\s*(px|pt)?$/u.exec(value ?? "");
  return match !== null && Number(match[1]) >= 1000;
}

/** Red, green, blue and alpha of a CSS colour, or undefined for one this does not read. */
function parseColour(value: string): readonly [number, number, number, number] | undefined {
  const colour = value.trim();
  if (colour === "white") return [255, 255, 255, 1];
  if (colour === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/u.exec(colour)?.[1];
  if (hex !== undefined) {
    const digits =
      hex.length <= 4 ? [...hex].map((digit) => digit + digit) : (hex.match(/../gu) ?? []);
    const [r, g, b, a] = digits.map((pair) => Number.parseInt(pair, 16));
    return [r ?? 0, g ?? 0, b ?? 0, a === undefined ? 1 : a / 255];
  }
  const rgb =
    /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+)(%)?)?\s*\)$/u.exec(
      colour,
    );
  if (rgb !== null) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] === "%" ? 100 : 1);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  }
  return undefined;
}

function isInvisibleOnWhite(value: string): boolean {
  const colour = parseColour(value);
  if (colour === undefined) return false;
  const [r, g, b, a] = colour;
  return a < 0.1 || (r >= 240 && g >= 240 && b >= 240);
}

/** Whether a style sets a background other than white or transparent. */
function setsBackground(declarations: Map<string, string>): boolean {
  for (const property of ["background-color", "background"]) {
    const value = declarations.get(property);
    if (value === undefined) continue;
    if (property === "background" && /url\(|gradient\(/u.test(value)) return true;
    const colour = parseColour(property === "background" ? (value.split(/\s+/u)[0] ?? "") : value);
    if (colour === undefined) return property === "background-color";
    const [r, g, b, a] = colour;
    if (a >= 0.1 && !(r >= 240 && g >= 240 && b >= 240)) return true;
  }
  return false;
}

function hiddenReason(
  name: string,
  attributes: string,
  inheritedBackground: boolean,
): { readonly reason?: HiddenHtmlReason; readonly background: boolean } {
  if (name === "template") return { reason: "attribute", background: inheritedBackground };
  if (hasBareAttribute(attributes, "hidden")) {
    const value = attributeValue(attributes, "hidden");
    if (value?.toLowerCase() !== "until-found") {
      return { reason: "attribute", background: inheritedBackground };
    }
  }
  const classes = (attributeValue(attributes, "class") ?? "").toLowerCase().split(/\s+/u);
  if (classes.some((value) => hiddenClasses.has(value))) {
    return { reason: "class", background: inheritedBackground };
  }
  const style = attributeValue(attributes, "style");
  if (style === undefined) return { background: inheritedBackground };
  const declarations = styleDeclarations(style);
  const background = inheritedBackground || setsBackground(declarations);
  const display = declarations.get("display");
  const visibility = declarations.get("visibility");
  const opacity = declarations.get("opacity");
  const fontSize = declarations.get("font-size");
  if (
    display === "none" ||
    visibility === "hidden" ||
    visibility === "collapse" ||
    (opacity !== undefined && /^\d*\.?\d+$/u.test(opacity) && Number(opacity) < 0.1) ||
    (fontSize !== undefined && isTinyFontSize(fontSize))
  ) {
    return { reason: "style", background };
  }
  if (
    isFarOffScreen(declarations.get("left")) ||
    isFarOffScreen(declarations.get("top")) ||
    isFarOffScreen(declarations.get("text-indent")) ||
    /^rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)$/u.test(
      declarations.get("clip") ?? "",
    )
  ) {
    return { reason: "off-screen", background };
  }
  const colour = declarations.get("color");
  if (colour !== undefined && !background && isInvisibleOnWhite(colour)) {
    return { reason: "white-text", background };
  }
  return { background };
}

/** The text of a fragment: tags become spaces, and no angle bracket is left to read as markup. */
function plainText(html: string): string {
  return decodeHtmlEntities(html.replace(tagPattern, " ").replace(/[<>]/gu, " "))
    .replace(/[<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Removes the hidden elements of an HTML fragment and reports what they held. */
export function removeHiddenHtml(html: string): VisibleHtml {
  const stack: OpenElement[] = [];
  const hidden: HiddenHtmlText[] = [];
  let output = "";
  let copiedUpTo = 0;
  // While inside a hidden element: where it started, its depth on the stack, and why.
  let hiddenStart = -1;
  let hiddenDepth = -1;
  let hiddenWhy: HiddenHtmlReason = "attribute";

  const report = (end: number) => {
    const text = plainText(html.slice(hiddenStart, end));
    const words = text.split(" ").filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    if (words >= minReportedHiddenTextWords && hidden.length < maxReportedHiddenTexts) {
      hidden.push({ reason: hiddenWhy, text: text.slice(0, maxReportedHiddenTextCharacters) });
    }
    copiedUpTo = end;
    hiddenStart = -1;
    hiddenDepth = -1;
  };

  for (const match of html.matchAll(tagPattern)) {
    const [tag, closing, rawName, attributes = ""] = match;
    const name = (rawName ?? "").toLowerCase();
    const end = match.index + tag.length;
    if (closing === "/") {
      let index = stack.length - 1;
      while (index >= 0 && stack[index]?.name !== name) index -= 1;
      if (index < 0) continue;
      stack.length = index;
      if (hiddenStart >= 0 && index < hiddenDepth) {
        // An ancestor of the hidden element closed: its closing tag stays visible.
        report(match.index);
      } else if (hiddenStart >= 0 && index === hiddenDepth) {
        report(end);
      }
      continue;
    }
    if (voidElements.has(name) || /\/\s*$/u.test(attributes)) continue;
    const parentBackground = stack.at(-1)?.background ?? false;
    const { reason, background } = hiddenReason(name, attributes, parentBackground);
    if (hiddenStart < 0 && reason !== undefined) {
      output += html.slice(copiedUpTo, match.index);
      hiddenStart = match.index;
      hiddenDepth = stack.length;
      hiddenWhy = reason;
    }
    stack.push({ name, background });
  }
  if (hiddenStart >= 0) {
    report(html.length);
    return { html: output, hidden };
  }
  return { html: output + html.slice(copiedUpTo), hidden };
}
