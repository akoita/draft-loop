/**
 * Marks Word heading paragraphs with Markdown ATX markers before the DOCX XML is flattened to
 * text, so downstream structure-aware planning can cut at headings.
 */

type StyleLevels = ReadonlyMap<string, number>;

const paragraphStart =
  /<w:p(?:\s[^>]*?)?(?<!\/)>(?:\s*<w:pPr(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/w:pPr>)?/gu;
const styleBlock = /<w:style\b([^>]*?)(?<!\/)>([\s\S]*?)<\/w:style>/gu;

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "u").exec(tag);
  return match?.[2];
}

/** Returns the heading level of a direct `w:outlineLvl`, `null` for body text, `undefined` if absent. */
function outlineLevel(properties: string): number | null | undefined {
  const tag = /<w:outlineLvl\b[^>]*>/u.exec(properties)?.[0];
  if (tag === undefined) return undefined;
  const value = Number(attribute(tag, "w:val"));
  return Number.isInteger(value) && value >= 0 && value <= 5 ? value + 1 : null;
}

function withoutRevisionHistory(properties: string): string {
  return properties.replace(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/gu, "");
}

/** Maps style ids to heading levels using the built-in English style name or the style outline level. */
function headingStyleLevels(stylesXml: string): StyleLevels {
  const levels = new Map<string, number>();
  for (const match of stylesXml.matchAll(styleBlock)) {
    const styleId = attribute(match[1] ?? "", "w:styleId");
    if (styleId === undefined) continue;
    const content = match[2] ?? "";
    const nameTag = /<w:name\b[^>]*>/u.exec(content)?.[0] ?? "";
    const named = /^heading\s*([1-6])$/iu.exec(attribute(nameTag, "w:val") ?? "");
    const level = named?.[1] === undefined ? outlineLevel(content) : Number(named[1]);
    if (typeof level === "number") levels.set(styleId, level);
  }
  return levels;
}

function paragraphLevel(properties: string, styles: StyleLevels): number | null {
  const direct = outlineLevel(properties);
  if (direct !== undefined) return direct;
  const styleTag = /<w:pStyle\b[^>]*>/u.exec(properties)?.[0];
  const styleId = styleTag === undefined ? undefined : attribute(styleTag, "w:val");
  if (styleId === undefined) return null;
  const mapped = styles.get(styleId);
  if (mapped !== undefined) return mapped;
  const fallback = /^Heading([1-6])$/iu.exec(styleId);
  return fallback?.[1] === undefined ? null : Number(fallback[1]);
}

function paragraphHasText(xml: string, from: number): boolean {
  const end = xml.indexOf("</w:p>", from);
  return /\S/u.test(xml.slice(from, end === -1 ? undefined : end).replace(/<[^>]*>/gu, ""));
}

/** Inserts `#` markers (levels 1-6) at the start of each non-empty heading paragraph. */
export function markDocxHeadings(documentXml: string, stylesXml?: string): string {
  const styles =
    stylesXml === undefined ? new Map<string, number>() : headingStyleLevels(stylesXml);
  return documentXml.replace(
    paragraphStart,
    (opening: string, properties: string | undefined, offset: number) => {
      const level = paragraphLevel(withoutRevisionHistory(properties ?? ""), styles);
      if (level === null || !paragraphHasText(documentXml, offset + opening.length)) return opening;
      return `${opening}${"#".repeat(level)} `;
    },
  );
}
