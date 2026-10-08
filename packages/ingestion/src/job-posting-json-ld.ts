import { decodeHtmlEntities, htmlFragmentToMarkdown } from "./html-text.js";

/** Largest JSON-LD block that is parsed; a larger block is skipped, not truncated. */
const maxJsonLdBlockCharacters = 1_000_000;
const maxJsonLdBlocks = 32;
const maxGraphDepth = 6;
/** Longest JobPosting text kept, so one page cannot exceed the opportunity intake bounds. */
export const maxJobPostingTextCharacters = 60_000;

const jsonLdScriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonLdScript(attributes: string): boolean {
  return /\btype\s*=\s*(?:"application\/ld\+json[^"]*"|'application\/ld\+json[^']*'|application\/ld\+json)/i.test(
    attributes,
  );
}

function hasJobPostingType(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (entry) => typeof entry === "string" && /(?:^|[/#:])JobPosting$/u.test(entry.trim()),
  );
}

/** The first JobPosting in a parsed JSON-LD value, looking through arrays and `@graph`. */
function findJobPosting(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > maxGraphDepth) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findJobPosting(entry, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (hasJobPostingType(value)) return value;
  return findJobPosting(value["@graph"], depth + 1);
}

function plainText(value: unknown): string {
  return typeof value === "string" ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : "";
}

function organizationName(value: unknown): string {
  if (typeof value === "string") return plainText(value);
  if (Array.isArray(value)) return organizationName(value[0]);
  return isRecord(value) ? plainText(value["name"]) : "";
}

/** A description is HTML; some publishers entity-escape the whole fragment, so unescape it first. */
function descriptionMarkdown(value: unknown): string {
  if (typeof value !== "string") return "";
  const html =
    !value.includes("<") && /&lt;\s*\/?[a-z]/i.test(value) ? decodeHtmlEntities(value) : value;
  return htmlFragmentToMarkdown(html);
}

/**
 * The text of the page's schema.org `JobPosting` JSON-LD, or `null` when the page has none.
 *
 * Job boards that render with JavaScript still publish the full posting here for search engines.
 * This reads only the already fetched page: nothing is fetched or followed. The result is a
 * Markdown heading naming the role and company, followed by the description with its headings
 * and list items kept, so requirement bullets survive.
 */
export function extractJobPostingText(html: string): string | null {
  let blocks = 0;
  for (const match of html.matchAll(jsonLdScriptPattern)) {
    if (!isJsonLdScript(match[1] ?? "")) continue;
    blocks += 1;
    if (blocks > maxJsonLdBlocks) return null;
    const body = (match[2] ?? "").trim();
    if (body.length === 0 || body.length > maxJsonLdBlockCharacters) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    const posting = findJobPosting(parsed);
    if (posting === null) continue;
    const title = plainText(posting["title"] ?? posting["name"]);
    const company = organizationName(posting["hiringOrganization"]);
    const description = descriptionMarkdown(posting["description"]);
    if (description === "") continue;
    const heading = title === "" ? "" : `# ${title}`;
    const text = [heading, company === "" ? "" : `Company: ${company}`, description]
      .filter((part) => part !== "")
      .join("\n\n");
    return text.length > maxJobPostingTextCharacters
      ? text.slice(0, maxJobPostingTextCharacters).trimEnd()
      : text;
  }
  return null;
}
