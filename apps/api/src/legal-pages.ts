import type { FastifyInstance } from "fastify";

import { legalTextsEn } from "./legal-text-en.js";
import { legalTextsFr } from "./legal-text-fr.js";

/**
 * The version of the terms and privacy policy a sign-up accepts (#2462), as the date it took
 * effect. Change it with any change that matters to users: the web screen's sign-up sends the
 * same literal, so its type check fails until it shows the new version.
 */
export const legalVersion = "2026-11-18";

export type LegalPageId = "terms" | "privacy" | "notice";
export type LegalLanguage = "en" | "fr";
export type LegalBlock = string | { readonly list: readonly string[] };

export interface LegalSection {
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  readonly title: string;
  /** One sentence for search results, under about 160 characters. */
  readonly description: string;
  readonly intro: readonly LegalBlock[];
  readonly sections: readonly LegalSection[];
}

/** One language's pages and labels; `{token}` fills from the publisher, `[label](href)` links. */
export interface LegalTexts {
  readonly languageName: string;
  readonly otherLanguage: string;
  readonly versionLabel: string;
  readonly prevails: string;
  readonly missing: string;
  readonly pages: Readonly<Record<LegalPageId, LegalDocument>>;
}

/**
 * Who publishes the service, filled at deploy time and never kept in the repository. Without it
 * the pages show a visible placeholder for each required detail.
 */
export interface LegalPublisher {
  readonly name: string;
  readonly email: string;
  /** The registered address; may be left out when `detailsUrl` gives it. */
  readonly address?: string;
  readonly director?: string;
  readonly registration?: string;
  readonly phone?: string;
  /** An https page where the company already publishes its full details, linked instead. */
  readonly detailsUrl?: string;
}

const texts: Readonly<Record<LegalLanguage, LegalTexts>> = { en: legalTextsEn, fr: legalTextsFr };
const pageIds: readonly LegalPageId[] = ["terms", "privacy", "notice"];
const requiredKeys = ["name", "email"] as const;
const optionalKeys = ["address", "director", "registration", "phone", "detailsUrl"] as const;

/** An https address with no characters that could end a link early or break out of it. */
function isDetailsUrl(text: string): boolean {
  if (!/^https:\/\/[^\s()<>"'\\]+$/u.test(text)) return false;
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Reads `DRAFT_LOOP_LEGAL_PUBLISHER`, a JSON object with `name` and `email`, and either `address`
 * or `detailsUrl` (an https page with the company's full details), plus optionally `director`,
 * `registration` and `phone`. Unset gives undefined; malformed throws, so a deployment never
 * publishes half its details.
 */
export function readLegalPublisher(env: NodeJS.ProcessEnv): LegalPublisher | undefined {
  const text = env.DRAFT_LOOP_LEGAL_PUBLISHER ?? "";
  if (text.trim() === "") return undefined;
  const fail = (): never => {
    throw new Error(
      "DRAFT_LOOP_LEGAL_PUBLISHER must be a JSON object with name, email, and address or an https detailsUrl, and optionally director, registration and phone, each a short text.",
    );
  };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  const known = new Set<string>([...requiredKeys, ...optionalKeys]);
  if (!Object.keys(record).every((key) => known.has(key))) return fail();
  const field = (key: string): string | undefined => {
    const item = record[key];
    if (item === undefined) return undefined;
    if (typeof item !== "string" || item.trim() === "" || item.length > 300) return fail();
    return item.trim();
  };
  const [name, email] = requiredKeys.map(field);
  if (name === undefined || email === undefined) return fail();
  const optional = Object.fromEntries(
    optionalKeys.flatMap((key) => {
      const item = field(key);
      return item === undefined ? [] : [[key, item]];
    }),
  ) as Partial<Record<(typeof optionalKeys)[number], string>>;
  if (optional.detailsUrl !== undefined && !isDetailsUrl(optional.detailsUrl)) return fail();
  if (optional.address === undefined && optional.detailsUrl === undefined) return fail();
  return { name, email, ...optional };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Fills `{token}`s; undefined when an optional detail is missing, so the line is left out. */
function fill(
  text: string,
  values: Readonly<Record<string, string | undefined>>,
  missing: string,
): string | undefined {
  let out = "";
  let from = 0;
  for (;;) {
    const open = text.indexOf("{", from);
    const close = open === -1 ? -1 : text.indexOf("}", open);
    if (open === -1 || close === -1) return out + text.slice(from);
    const key = text.slice(open + 1, close);
    const value = values[key];
    if (value === undefined && (optionalKeys as readonly string[]).includes(key)) return undefined;
    out += text.slice(from, open) + (value ?? missing);
    from = close + 1;
  }
}

/** Escapes a line and turns each `[label](href)` into a link; site paths gain the language. */
function inline(text: string, language: LegalLanguage): string {
  let html = "";
  let from = 0;
  for (;;) {
    const open = text.indexOf("[", from);
    const middle = open === -1 ? -1 : text.indexOf("](", open);
    const close = middle === -1 ? -1 : text.indexOf(")", middle);
    if (open === -1 || middle === -1 || close === -1) return html + escapeHtml(text.slice(from));
    const label = text.slice(open + 1, middle);
    const target = text.slice(middle + 2, close);
    const href = target.startsWith("/legal/")
      ? `/legal/${language}/${target.slice("/legal/".length)}`
      : target;
    html += `${escapeHtml(text.slice(from, open))}<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    from = close + 1;
  }
}

function blocksHtml(
  blocks: readonly LegalBlock[],
  language: LegalLanguage,
  values: Readonly<Record<string, string | undefined>>,
  missing: string,
): string {
  return blocks
    .map((block) => {
      if (typeof block === "string") {
        const text = fill(block, values, missing);
        return text === undefined ? "" : `<p>${inline(text, language)}</p>`;
      }
      const items = block.list
        .map((item) => fill(item, values, missing))
        .filter((item): item is string => item !== undefined)
        .map((item) => `<li>${inline(item, language)}</li>`);
      return items.length === 0 ? "" : `<ul>${items.join("")}</ul>`;
    })
    .join("\n");
}

/** One legal page as a complete HTML document, readable without JavaScript or sign-in. */
export function renderLegalPage(
  page: LegalPageId,
  language: LegalLanguage,
  publisher: LegalPublisher | undefined,
): string {
  const strings = texts[language];
  const document = strings.pages[page];
  const values: Record<string, string | undefined> = {
    publisher: publisher?.name,
    address: publisher?.address,
    email: publisher?.email,
    director: publisher?.director,
    registration: publisher?.registration,
    phone: publisher?.phone,
    detailsUrl: publisher?.detailsUrl,
    version: legalVersion,
  };
  const other: LegalLanguage = language === "en" ? "fr" : "en";
  const sections = document.sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.heading)}</h2>\n${blocksHtml(section.blocks, language, values, strings.missing)}</section>`,
    )
    .join("\n");
  const nav = pageIds
    .map((id) =>
      id === page
        ? `<span aria-current="page">${escapeHtml(strings.pages[id].title)}</span>`
        : `<a href="/legal/${language}/${id}">${escapeHtml(strings.pages[id].title)}</a>`,
    )
    .join(" · ");
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.title)} · DraftLoop</title>
<meta name="description" content="${escapeHtml(document.description)}">
<link rel="icon" href="/showcase/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="/legal/legal.css">
</head>
<body>
<header><a href="/">DraftLoop</a><nav>${nav}</nav><a href="/legal/${other}/${page}" lang="${other}">${escapeHtml(strings.otherLanguage)}</a></header>
<main>
<h1>${escapeHtml(document.title)}</h1>
<p class="version">${escapeHtml(fill(strings.versionLabel, values, strings.missing) ?? "")}. ${escapeHtml(strings.prevails)}</p>
${blocksHtml(document.intro, language, values, strings.missing)}
${sections}
</main>
</body>
</html>
`;
}

const legalCss = `:root{color-scheme:light dark;--bg:#fdfdfc;--fg:#1d1d1b;--muted:#5f5f5a;--link:#1f5fbf;--line:#deded8}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ececea;--muted:#a3a39d;--link:#8db4f2;--line:#33332f}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;padding:12px 16px;border-bottom:1px solid var(--line)}
header nav{flex:1}
main{max-width:46rem;margin:0 auto;padding:16px 16px 48px}
a{color:var(--link)}
h1{font-size:1.75rem;margin:16px 0 4px}
h2{font-size:1.15rem;margin:28px 0 8px}
.version{color:var(--muted);font-size:.9rem}
li{margin:4px 0}
`;

/** The language a visitor's browser prefers among the two, English unless French comes first. */
export function preferredLegalLanguage(acceptLanguage: string | undefined): LegalLanguage {
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("fr") ? "fr" : "en";
}

/**
 * Serves the terms, privacy policy and legal notice at `/legal/en/<page>` and `/legal/fr/<page>`
 * (#2462); `/legal/<page>` picks the browser's language. Public, like the web screen's files.
 */
export function registerLegalPages(
  app: FastifyInstance,
  options: { readonly publisher?: LegalPublisher },
): void {
  app.get("/legal/legal.css", { schema: { hide: true } }, async (_request, reply) =>
    reply.header("cache-control", "no-cache").type("text/css; charset=utf-8").send(legalCss),
  );
  for (const page of pageIds) {
    app.get(`/legal/${page}`, { schema: { hide: true } }, async (request, reply) =>
      reply
        .header("vary", "accept-language")
        .redirect(
          `/legal/${preferredLegalLanguage(request.headers["accept-language"])}/${page}`,
          302,
        ),
    );
    for (const language of ["en", "fr"] as const) {
      app.get(`/legal/${language}/${page}`, { schema: { hide: true } }, async (_request, reply) =>
        reply
          .header("cache-control", "no-cache")
          .type("text/html; charset=utf-8")
          .send(renderLegalPage(page, language, options.publisher)),
      );
    }
  }
}
