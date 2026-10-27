import type { UrlFetcher } from "@draft-loop/ingestion";
import { createRemoteUrlFetcher } from "@draft-loop/ingestion/remote-url-fetcher";

const metadataIdentityUrl =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

export class PageFetcherIdentityError extends Error {
  override readonly name = "PageFetcherIdentityError";
}

export interface HostedJobPageFetcherOptions {
  /** The page fetcher's address, from `DRAFT_LOOP_PAGE_FETCHER_URL`. */
  readonly endpoint: string;
  readonly fetch?: typeof fetch;
}

/**
 * The job page fetcher the hosted API uses when a separate page fetcher is deployed (#1837). The
 * API has no route to the internet; the fetcher makes each hop and intake still checks it. Over
 * https, each call carries a Google identity token for the fetcher's address, from the metadata
 * server, which Cloud Run's IAM check verifies, so no key exists. The local stack's http address
 * takes none.
 */
export function hostedJobPageFetcher(options: HostedJobPageFetcherOptions): UrlFetcher {
  const request = options.fetch ?? fetch;
  const { origin, protocol } = new URL(options.endpoint);
  const authorization = async (): Promise<string> => {
    const response = await request(
      `${metadataIdentityUrl}?audience=${encodeURIComponent(origin)}`,
      { headers: { "Metadata-Flavor": "Google" } },
    );
    if (!response.ok) {
      throw new PageFetcherIdentityError(
        `The metadata server refused an identity token: ${response.status}`,
      );
    }
    const token = (await response.text()).trim();
    if (token === "") throw new PageFetcherIdentityError("The metadata server returned no token.");
    return `Bearer ${token}`;
  };
  return createRemoteUrlFetcher({
    endpoint: options.endpoint,
    ...(protocol === "https:" ? { authorization } : {}),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
