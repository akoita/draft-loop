const namedEntities: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  laquo: "«",
  ldquo: "“",
  lt: "<",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
  shy: "-",
};

function codePointText(codePoint: number, entity: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
  return String.fromCodePoint(codePoint);
}

/** Decodes the small set of named entities and every numeric entity found in fetched HTML. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, value: string) => {
    if (value.toLowerCase().startsWith("#x")) {
      return codePointText(Number.parseInt(value.slice(2), 16), entity);
    }
    if (value.startsWith("#")) {
      return codePointText(Number.parseInt(value.slice(1), 10), entity);
    }
    return namedEntities[value.toLowerCase()] ?? entity;
  });
}

const blockBoundaryTags =
  /<\/?(address|article|aside|blockquote|br|dd|div|dl|dt|footer|header|hr|main|nav|ol|p|pre|section|table|td|th|tr|ul)\b[^>]*>/gi;

/**
 * Converts an HTML fragment to readable Markdown-flavoured text: headings become `#` lines, list
 * items become `- ` bullets, block elements become line breaks and every other tag is dropped.
 */
export function htmlFragmentToMarkdown(html: string): string {
  const withoutInactive = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const structured = withoutInactive
    .replace(/<h([1-6])\b[^>]*>/gi, (_match, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(blockBoundaryTags, "\n");
  return decodeHtmlEntities(structured.replace(/<[^>]*>/g, ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/^(-|#{1,6})\n+(?=\S)/gm, "$1 ")
    .replace(/^(- [^\n]*)\n{2,}(?=- )/gm, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
