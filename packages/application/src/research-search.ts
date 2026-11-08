/**
 * Web search for an application's research brief (#2541), behind one port so the provider is a
 * deployment setting. Every provider returns the same sources; what happens after the search
 * (the freshness window, injection screening, findings, citations and the cost cap) is shared and
 * does not depend on the provider.
 */

/** One public source a search returned. Its excerpt is third-party text: data, never instructions. */
export interface ResearchSource {
  readonly url: string;
  readonly title: string;
  /** A short passage from the page, as the provider gave it. */
  readonly excerpt: string;
  /** When the page was published or last updated, `YYYY-MM-DD`; absent when the provider gives none. */
  readonly publishedOn?: string;
}

export interface ResearchSearchRequest {
  /** One plain-language query, such as an employer's name and the role. */
  readonly query: string;
  /** The oldest publication date to keep, `YYYY-MM-DD`. */
  readonly fromDate: string;
  readonly maxResults: number;
  /** Domains to search only, such as the employer's own site; every domain when absent. */
  readonly includeDomains?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface ResearchSearchReply {
  readonly sources: readonly ResearchSource[];
  /** What the search cost, in US dollars, for the brief's cap. */
  readonly costUsd: number;
  /** Who searched, recorded with the brief. */
  readonly provider: string;
}

/** Anything that searches the web for research: a provider adapter or a scripted fake. */
export interface ResearchSearchPort {
  search(request: ResearchSearchRequest): Promise<ResearchSearchReply>;
}

/** The providers a deployment can pick with `DRAFT_LOOP_RESEARCH_SEARCH`; `off` searches nothing. */
export const researchSearchProviders = ["claude", "linkup", "off"] as const;
export type ResearchSearchProvider = (typeof researchSearchProviders)[number];

/** The default when the setting is absent: Claude's search, which needs no other account. */
export const defaultResearchSearchProvider: ResearchSearchProvider = "claude";

/** The most results one search keeps, whatever the request asks. */
export const maximumResearchSearchResults = 10;
const maximumExcerptCharacters = 1_200;
const maximumTitleCharacters = 300;

export class ResearchSearchSettingError extends Error {
  override readonly name = "ResearchSearchSettingError";
}

/** Reads `DRAFT_LOOP_RESEARCH_SEARCH`; an unknown value is a startup error, never a silent default. */
export function readResearchSearchProvider(
  env: Readonly<Record<string, string | undefined>>,
): ResearchSearchProvider {
  const value = (env.DRAFT_LOOP_RESEARCH_SEARCH ?? "").trim();
  if (value === "") return defaultResearchSearchProvider;
  if ((researchSearchProviders as readonly string[]).includes(value)) {
    return value as ResearchSearchProvider;
  }
  throw new ResearchSearchSettingError(
    `DRAFT_LOOP_RESEARCH_SEARCH must be one of ${researchSearchProviders.join(", ")}.`,
  );
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

/** A publication date as `YYYY-MM-DD`, or undefined when the text names no valid date. */
export function researchDateOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return undefined;
  const day = parsed.toISOString().slice(0, 10);
  return datePattern.test(day) ? day : undefined;
}

/**
 * The sources a provider returned, made safe to keep: only http(s) links, one per URL, trimmed
 * titles and excerpts, at most the requested count. A provider's adapter calls this, so every
 * provider's sources look the same.
 */
export function boundedResearchSources(
  sources: readonly ResearchSource[],
  maxResults: number,
): ResearchSource[] {
  const limit = Math.max(1, Math.min(maxResults, maximumResearchSearchResults));
  const kept: ResearchSource[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    url.hash = "";
    const key = url.toString();
    if (seen.has(key)) continue;
    const excerpt = source.excerpt.replace(/\s+/gu, " ").trim().slice(0, maximumExcerptCharacters);
    if (excerpt === "") continue;
    seen.add(key);
    const publishedOn = researchDateOf(source.publishedOn);
    kept.push({
      url: key,
      title: source.title.replace(/\s+/gu, " ").trim().slice(0, maximumTitleCharacters) || url.host,
      excerpt,
      ...(publishedOn === undefined ? {} : { publishedOn }),
    });
    if (kept.length === limit) break;
  }
  return kept;
}

/**
 * A provider's search with its sources bounded, so a provider adapter that cannot import this
 * module still returns sources shaped like every other provider's.
 */
export function withBoundedResearchSources(port: ResearchSearchPort): ResearchSearchPort {
  return {
    search: async (request) => {
      const reply = await port.search(request);
      return { ...reply, sources: boundedResearchSources(reply.sources, request.maxResults) };
    },
  };
}

/** A search that answers each request with the next scripted reply, for tests and the dev stack. */
export function createScriptedResearchSearch(
  replies: readonly (readonly ResearchSource[])[],
  options: { readonly costUsd?: number } = {},
): ResearchSearchPort & { readonly requests: ResearchSearchRequest[] } {
  const queue = [...replies];
  const requests: ResearchSearchRequest[] = [];
  return {
    requests,
    search: async (request) => {
      requests.push(request);
      return {
        sources: boundedResearchSources(queue.shift() ?? [], request.maxResults),
        costUsd: options.costUsd ?? 0,
        provider: "scripted",
      };
    },
  };
}
