import { decodeHtmlEntities, htmlFragmentToMarkdown } from "./html-text.js";

/** Largest embedded state that is parsed; a larger one is skipped, not truncated. */
const maxEmbeddedStateCharacters = 2_000_000;
const maxSearchDepth = 12;
const maxJobPostTextCharacters = 60_000;

/**
 * Every script element's attributes and body, found by plain string search rather than a regular
 * expression, so no input can make the scan backtrack. A body ends at the first `</script`.
 */
function* scriptElements(html: string): Generator<{ attributes: string; body: string }> {
  const lower = html.toLowerCase();
  let from = 0;
  for (;;) {
    const open = lower.indexOf("<script", from);
    if (open === -1) return;
    const next = lower.charAt(open + 7);
    const openEnd = lower.indexOf(">", open);
    if (openEnd === -1) return;
    if (next !== ">" && next !== " " && next !== "\t" && next !== "\n" && next !== "\r") {
      from = open + 7;
      continue;
    }
    const close = lower.indexOf("</script", openEnd);
    if (close === -1) return;
    yield { attributes: html.slice(open + 7, openEnd), body: html.slice(openEnd + 1, close) };
    from = close + 8;
  }
}

/**
 * The script assignments job boards render their route data into, such as Greenhouse's
 * `window.__remixContext = {...};`. Only the already fetched page is read.
 */
const stateAssignments = [
  "window.__remixContext",
  "window.__NEXT_DATA__",
  "window.__INITIAL_STATE__",
];

/** The JSON a script holds as page state, or undefined when it holds none. */
function stateJson(attributes: string, body: string): string | undefined {
  const trimmed = body.trim();
  if (attributes.includes("__NEXT_DATA__")) return trimmed;
  const assignment = stateAssignments.find((name) => trimmed.startsWith(name));
  if (assignment === undefined) return undefined;
  const value = trimmed.slice(assignment.length).trimStart();
  if (!value.startsWith("=")) return undefined;
  const json = value.slice(1).trim();
  return json.endsWith(";") ? json.slice(0, -1).trimEnd() : json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? decodeHtmlEntities(value).replace(/\s+/gu, " ").trim() : "";
}

/** A job post object: a title and an HTML `content` or `description` of some length. */
function jobPostOf(node: Record<string, unknown>): Record<string, unknown> | null {
  const body = node.content ?? node.description;
  if (typeof body !== "string" || body.length < 200) return null;
  if (text(node.title) === "") return null;
  return node;
}

/** The first job post in the state: under a `jobPost` key first, then any matching object. */
function findJobPost(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > maxSearchDepth) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findJobPost(entry, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (isRecord(value.jobPost)) {
    const post = jobPostOf(value.jobPost);
    if (post !== null) return post;
  }
  const own = jobPostOf(value);
  if (own !== null) return own;
  for (const child of Object.values(value)) {
    const found = findJobPost(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** HTML that some boards entity-escape whole, such as `&lt;p&gt;`, unescaped first. */
function bodyMarkdown(value: unknown): string {
  if (typeof value !== "string") return "";
  const html =
    !value.includes("<") && /&lt;\s*\/?[a-z]/iu.test(value) ? decodeHtmlEntities(value) : value;
  return htmlFragmentToMarkdown(html);
}

function parsedStates(html: string): unknown[] {
  const states: unknown[] = [];
  for (const { attributes, body } of scriptElements(html)) {
    if (body.length === 0 || body.length > maxEmbeddedStateCharacters) continue;
    const json = stateJson(attributes, body);
    if (json === undefined) continue;
    try {
      states.push(JSON.parse(json));
    } catch {
      // Not plain JSON (a function call or a template); the visible text stays the fallback.
    }
  }
  return states;
}

/**
 * The job post a JavaScript job board embeds in its page state, such as a Greenhouse job board's
 * route data, as Markdown headed by the role and company; `null` when the page embeds none. The
 * visible HTML of such a page holds little more than the title (#2857).
 */
export function extractEmbeddedJobPostText(html: string): string | null {
  for (const state of parsedStates(html)) {
    const post = findJobPost(state);
    if (post === null) continue;
    const description = bodyMarkdown(post.content ?? post.description);
    if (description === "") continue;
    const title = text(post.title);
    const company = text(post.company_name ?? post.companyName);
    const location = text(
      isRecord(post.location) ? post.location.name : (post.job_post_location ?? post.location),
    );
    const parts = [
      `# ${title}`,
      company === "" ? "" : `Company: ${company}`,
      location === "" ? "" : `Location: ${location}`,
      description,
    ].filter((part) => part !== "");
    const joined = parts.join("\n\n");
    return joined.length > maxJobPostTextCharacters
      ? joined.slice(0, maxJobPostTextCharacters).trimEnd()
      : joined;
  }
  return null;
}
