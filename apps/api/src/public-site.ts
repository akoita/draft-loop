import type { FastifyInstance } from "fastify";

/**
 * How search engines may treat this deployment's public pages. Indexing is off unless the
 * deployment turns it on, so staging and self-hosted servers stay out of search results.
 */
export interface PublicSiteOptions {
  /** The service's public https origin, such as `https://example.com`, without a trailing slash. */
  readonly origin?: string;
  /** Whether search engines may index the public pages; needs `origin`. */
  readonly indexing: boolean;
}

/** The text the public pages carry where the deployment's origin belongs. */
export const siteOriginToken = "__SITE_ORIGIN__";

/** The public pages, each with its English and French address where one exists. */
const pageGroups: readonly { readonly en: string; readonly fr?: string }[] = [
  { en: "/" },
  { en: "/about/", fr: "/about/fr/" },
  { en: "/legal/en/terms", fr: "/legal/fr/terms" },
  { en: "/legal/en/privacy", fr: "/legal/fr/privacy" },
  { en: "/legal/en/notice", fr: "/legal/fr/notice" },
];

/** Pages with fictional sample data, kept out of search results in every deployment. */
const noindexPaths: ReadonlySet<string> = new Set(["/showcase/", "/showcase/index.html"]);

/** Static pages whose HTML holds `siteOriginToken`. */
const tokenPages: ReadonlySet<string> = new Set([
  "/",
  "/index.html",
  "/about/",
  "/about/index.html",
  "/about/fr/",
  "/about/fr/index.html",
]);

/**
 * Reads `DRAFT_LOOP_SEARCH_INDEXING` (`on` or unset) and the origin of `DRAFT_LOOP_PUBLIC_URL`.
 * Indexing on without a valid https public address throws, so a deployment never advertises
 * pages at a wrong address.
 */
export function readPublicSite(env: NodeJS.ProcessEnv): PublicSiteOptions {
  const flag = (env.DRAFT_LOOP_SEARCH_INDEXING ?? "").trim();
  if (flag !== "" && flag !== "on" && flag !== "off") {
    throw new Error("DRAFT_LOOP_SEARCH_INDEXING must be on or off.");
  }
  const origin = publicOrigin(env.DRAFT_LOOP_PUBLIC_URL);
  if (flag === "on" && origin === undefined) {
    throw new Error("DRAFT_LOOP_SEARCH_INDEXING=on needs an https DRAFT_LOOP_PUBLIC_URL.");
  }
  return { indexing: flag === "on", ...(origin === undefined ? {} : { origin }) };
}

function publicOrigin(text: string | undefined): string | undefined {
  if (text === undefined || text.trim() === "") return undefined;
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** robots.txt: the public pages and their sitemap when indexing is on, nothing otherwise. */
export function robotsText(site: PublicSiteOptions): string {
  if (!site.indexing || site.origin === undefined) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\nDisallow: /v1/\n\nSitemap: ${site.origin}/sitemap.xml\n`;
}

function alternates(origin: string, group: (typeof pageGroups)[number]) {
  const links = [{ hreflang: "x-default", href: `${origin}${group.en}` }];
  if (group.fr !== undefined) {
    links.push({ hreflang: "en", href: `${origin}${group.en}` });
    links.push({ hreflang: "fr", href: `${origin}${group.fr}` });
  }
  return links;
}

/** sitemap.xml: every public page, with its other language as an alternate. */
export function sitemapXml(origin: string): string {
  const urls = pageGroups.flatMap((group) =>
    [group.en, group.fr].flatMap((path) => {
      if (path === undefined) return [];
      const links =
        group.fr === undefined
          ? ""
          : alternates(origin, group)
              .map(
                (link) =>
                  `\n    <xhtml:link rel="alternate" hreflang="${link.hreflang}" href="${link.href}"/>`,
              )
              .join("");
      return [`  <url>\n    <loc>${origin}${path}</loc>${links}\n  </url>`];
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}

/** The `Link` header naming a public page's canonical address and its language versions. */
export function canonicalLinkHeader(origin: string, path: string): string | undefined {
  const canonicalPath = path.endsWith("/index.html") ? path.slice(0, -"index.html".length) : path;
  const group = pageGroups.find((g) => g.en === canonicalPath || g.fr === canonicalPath);
  if (group === undefined) return undefined;
  const links = [`<${origin}${canonicalPath}>; rel="canonical"`];
  if (group.fr !== undefined) {
    for (const link of alternates(origin, group)) {
      links.push(`<${link.href}>; rel="alternate"; hreflang="${link.hreflang}"`);
    }
  }
  return links.join(", ");
}

async function readPayload(payload: unknown): Promise<string | undefined> {
  if (typeof payload === "string") return payload;
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  if (payload !== null && typeof payload === "object" && Symbol.asyncIterator in payload) {
    const chunks: Buffer[] = [];
    for await (const chunk of payload as AsyncIterable<Buffer | string>) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return undefined;
}

/**
 * Serves `/robots.txt` and `/sitemap.xml`, and marks responses for search engines: `noindex`
 * everywhere while indexing is off, on the sample-data pages always, and canonical and language
 * links on the public pages. It also fills `siteOriginToken` in the public pages' HTML.
 */
export function registerPublicSite(app: FastifyInstance, site: PublicSiteOptions): void {
  const indexing = site.indexing && site.origin !== undefined;
  app.get("/robots.txt", { schema: { hide: true } }, async (_request, reply) =>
    reply
      .header("cache-control", "public, max-age=3600")
      .type("text/plain; charset=utf-8")
      .send(robotsText(site)),
  );
  app.get("/sitemap.xml", { schema: { hide: true } }, async (_request, reply) => {
    if (!indexing || site.origin === undefined) {
      return reply.code(404).send({ error: "not_found", message: "No sitemap here." });
    }
    return reply
      .header("cache-control", "public, max-age=3600")
      .type("application/xml; charset=utf-8")
      .send(sitemapXml(site.origin));
  });

  // Browsers and crawlers ask for this path before reading the page's own icon link.
  app.get("/favicon.ico", { schema: { hide: true } }, async (_request, reply) =>
    reply.redirect("/showcase/mark.svg", 301),
  );

  app.addHook("onSend", async (request, reply, payload) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!indexing || noindexPaths.has(path)) reply.header("x-robots-tag", "noindex, nofollow");
    if (indexing && site.origin !== undefined && reply.statusCode === 200) {
      const link = canonicalLinkHeader(site.origin, path);
      if (link !== undefined) reply.header("link", link);
    }
    const type = String(reply.getHeader("content-type") ?? "");
    if (!tokenPages.has(path) || !type.startsWith("text/html") || reply.statusCode !== 200) {
      return payload;
    }
    const html = await readPayload(payload);
    if (html === undefined) return payload;
    reply.removeHeader("content-length");
    return html.replaceAll(siteOriginToken, site.origin ?? "");
  });
}
