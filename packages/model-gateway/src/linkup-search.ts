import type { CredentialResolver } from "./secret-credentials.js";

/**
 * Linkup web search (#2541), one of the research brief's providers. Linkup is a French search API
 * built for model grounding. The types below mirror `ResearchSearchPort` of
 * `@draft-loop/application/research-search`, which this package cannot import; the caller bounds
 * the sources with that module's `withBoundedResearchSources`.
 */

export interface LinkupSearchRequest {
  readonly query: string;
  readonly fromDate: string;
  readonly maxResults: number;
  readonly includeDomains?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface LinkupSearchSource {
  readonly url: string;
  readonly title: string;
  readonly excerpt: string;
}

export interface LinkupSearchReply {
  readonly sources: readonly LinkupSearchSource[];
  readonly costUsd: number;
  readonly provider: "linkup";
}

/** Linkup's list price for one standard search, €0.005, rounded up to dollars for the cap. */
export const linkupStandardSearchUsd = 0.006;
const endpoint = "https://api.linkup.so/v1/search";

export class LinkupSearchError extends Error {
  override readonly name = "LinkupSearchError";
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    // Content-free: never the key, the query or the provider's reply body.
    super(message);
    this.status = status;
  }
}

export interface LinkupSearchOptions {
  /** Reads the `linkup` key from Secret Manager or the server's key files. */
  readonly resolveCredential: CredentialResolver;
  readonly fetch?: typeof fetch;
}

export function createLinkupResearchSearch(options: LinkupSearchOptions): {
  search(request: LinkupSearchRequest): Promise<LinkupSearchReply>;
} {
  const transport = options.fetch ?? fetch;
  return {
    search: async (request) => {
      const key = await options.resolveCredential("linkup");
      if (key === undefined || key === "") {
        throw new LinkupSearchError("No Linkup key is configured.");
      }
      const body = {
        q: request.query,
        depth: "standard",
        outputType: "searchResults",
        fromDate: request.fromDate,
        maxResults: request.maxResults,
        ...(request.includeDomains === undefined || request.includeDomains.length === 0
          ? {}
          : { includeDomains: [...request.includeDomains] }),
      };
      const response = await transport(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      if (!response.ok) {
        throw new LinkupSearchError(
          `Linkup search failed with status ${response.status}.`,
          response.status,
        );
      }
      const reply = (await response.json()) as { results?: unknown };
      const results = Array.isArray(reply.results) ? reply.results : [];
      const sources: LinkupSearchSource[] = [];
      for (const result of results) {
        if (typeof result !== "object" || result === null) continue;
        const { type, name, url, content } = result as Record<string, unknown>;
        if (type !== undefined && type !== "text") continue;
        if (typeof url !== "string" || typeof content !== "string") continue;
        sources.push({ url, title: typeof name === "string" ? name : "", excerpt: content });
      }
      return { sources, costUsd: linkupStandardSearchUsd, provider: "linkup" };
    },
  };
}
