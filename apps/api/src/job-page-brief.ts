import {
  type ApplicationService,
  CliUserError,
  type OpportunitySourceInput,
} from "@draft-loop/application";
import { type IngestionResult, ingestUrl, type UrlFetcher } from "@draft-loop/ingestion";
import { applicationPastedJobMaxLength } from "@draft-loop/schemas/application";

type IngestUrl = typeof ingestUrl;

function sameUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
}

/** The approved job page a brief is being made from, fetched at most once (#1812). */
export interface JobPageFetch {
  /** Fetches the page the first time it is called and answers that result after. */
  readonly ingest: IngestUrl;
  /**
   * The page's text and where and when it was fetched, or undefined when nothing was read. The
   * text is bounded to what an application keeps as pasted text.
   */
  readonly page: () =>
    | { readonly text: string; readonly finalUrl: string; readonly fetchedAt: string }
    | undefined;
}

/**
 * Checks that every approved-URL source in a brief is the job page its application was created
 * with, under the approval recorded then. Nothing is fetched here; a URL that was not approved
 * with the application is refused, so a client cannot make the service fetch another address.
 */
export async function assertApprovedJobPage(input: {
  readonly service: Pick<ApplicationService, "getApplication">;
  readonly root: string;
  readonly applicationId: string | undefined;
  readonly sources: readonly OpportunitySourceInput[];
}): Promise<boolean> {
  const pages = input.sources.filter((source) => source.kind === "approved-url");
  if (pages.length === 0) return false;
  const refusal = new CliUserError(
    "Only the job page approved when this application was created can be fetched.",
  );
  if (pages.length > 1 || input.applicationId === undefined) throw refusal;
  const application = await input.service.getApplication({
    root: input.root,
    applicationId: input.applicationId,
  });
  const job = application?.jobSource;
  const [page] = pages;
  if (
    job?.kind !== "approved-url" ||
    page === undefined ||
    page.classification !== "job-posting" ||
    !page.approved ||
    !sameUrl(page.url, job.url)
  ) {
    throw refusal;
  }
  return true;
}

/**
 * One fetch of an approved job page through the pinned fetcher (#1811), whose result both the
 * brief's provenance and the application's kept text come from.
 */
export function jobPageFetch(fetcher?: UrlFetcher): JobPageFetch {
  let fetched: Promise<IngestionResult> | undefined;
  let result: IngestionResult | undefined;
  const ingest: IngestUrl = (url, options) => {
    fetched ??= ingestUrl(url, {
      ...options,
      ...(fetcher === undefined ? {} : { fetcher }),
      maxExtractedCharacters: applicationPastedJobMaxLength,
    }).then((value) => {
      result = value;
      return value;
    });
    return fetched;
  };
  return {
    ingest,
    page: () => {
      const source = result?.source;
      const provenance = source?.url ?? source?.source.url;
      const text = source?.text.trim() ?? "";
      if (provenance === undefined || text === "") return undefined;
      return { text, finalUrl: provenance.finalUrl, fetchedAt: provenance.fetchedAt };
    },
  };
}

/**
 * Fetches the approved page before the brief is made, so a page that cannot be read is refused
 * without saving a brief. The brief's intake then reuses this one result.
 */
export async function fetchApprovedJobPage(
  pageFetch: JobPageFetch,
  sources: readonly OpportunitySourceInput[],
): Promise<void> {
  const source = sources.find((candidate) => candidate.kind === "approved-url");
  if (source === undefined) return;
  // The options the brief's intake fetches a job posting with.
  await pageFetch.ingest(source.url, {
    preferJobPostingData: true,
    approved: true,
    approval: true,
  });
  if (pageFetch.page() === undefined) {
    throw new CliUserError(
      "DraftLoop could not fetch this job page. Check the address, or paste the job text instead.",
    );
  }
}

/** Keeps the fetched page's text with its application, for the worker's extraction. */
export async function keepJobPage(
  service: Pick<ApplicationService, "recordApplicationJobPage">,
  command: Parameters<NonNullable<ApplicationService["recordApplicationJobPage"]>>[0],
): Promise<void> {
  if (service.recordApplicationJobPage === undefined) {
    throw new CliUserError("Fetching a job page is not available in this service.");
  }
  await service.recordApplicationJobPage(command);
}

/**
 * The brief's sources as screening reads them: an approved job page is screened by the text it
 * gave, as pasted job text is, before the worker's model may see it.
 */
export function screenedSources(
  sources: readonly OpportunitySourceInput[],
  page: ReturnType<JobPageFetch["page"]>,
): readonly OpportunitySourceInput[] {
  return sources.flatMap((source): OpportunitySourceInput[] => {
    if (source.kind !== "approved-url") return [source];
    if (page === undefined) return [];
    const { id, classification } = source;
    return [{ id, kind: "pasted-content", classification, content: page.text }];
  });
}
