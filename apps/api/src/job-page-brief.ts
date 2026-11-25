import {
  type ApplicationService,
  CliUserError,
  type OpportunitySourceInput,
} from "@draft-loop/application";
import {
  type IngestionIssueCode,
  type IngestionResult,
  ingestUrl,
  type UrlFetcher,
} from "@draft-loop/ingestion";
import {
  type ApplicationJobPage,
  applicationPastedJobMaxLength,
} from "@draft-loop/schemas/application";
import type { FastifyBaseLogger } from "fastify";

import {
  jobPageFetchRefusal,
  jobPageHost,
  jobPageTooShortRefusal,
} from "./job-page-fetch-issue.js";

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
  readonly page: () => ApplicationJobPage | undefined;
  /** The fetcher's first issue code once the fetch has ended, or undefined. */
  readonly issueCode: () => IngestionIssueCode | undefined;
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
 * How long the API waits for each hop of a job page. A deployment makes the hop through the
 * separate page fetcher, which bounds the site itself at 15 s and answers its own `fetch-timeout`;
 * the wait covers that and the fetcher's cold start, so a scaled-to-zero fetcher does not refuse
 * the page (#1853).
 */
export const jobPageHopTimeoutMs = 25_000;

/** How long the API waits before fetching a timed-out job page again (#3113). */
export const jobPageRetryDelayMs = 2_000;

/** A fetch that timed out with no text: the page fetcher was likely still starting. */
function timedOut(result: IngestionResult): boolean {
  return (result.source?.text.trim() ?? "") === "" && result.issues[0]?.code === "fetch-timeout";
}

/**
 * One fetch of an approved job page through the pinned fetcher (#1811), whose result both the
 * brief's provenance and the application's kept text come from. A fetch that timed out is made
 * once more after a short wait, since a scaled-to-zero fetcher can miss the first (#3113); any
 * other refusal is final.
 */
export function jobPageFetch(
  fetcher?: UrlFetcher,
  retryDelayMs: number = jobPageRetryDelayMs,
): JobPageFetch {
  let fetched: Promise<IngestionResult> | undefined;
  let result: IngestionResult | undefined;
  const ingest: IngestUrl = (url, options) => {
    const once = () =>
      ingestUrl(url, {
        ...options,
        ...(fetcher === undefined ? {} : { fetcher }),
        timeoutMs: jobPageHopTimeoutMs,
        maxExtractedCharacters: applicationPastedJobMaxLength,
      });
    fetched ??= once()
      .then(async (first) => {
        if (!timedOut(first)) return first;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return once();
      })
      .then((value) => {
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
      // What the page hid from its reader, kept so the Job tab can show it (#3336).
      const hiddenText = (source?.hiddenText ?? [])
        .map(({ reason, text: hidden }) => ({ reason, text: hidden.trim() }))
        .filter(({ text: hidden }) => hidden !== "")
        .slice(0, 20);
      return {
        text,
        finalUrl: provenance.finalUrl,
        fetchedAt: provenance.fetchedAt,
        ...(hiddenText.length === 0 ? {} : { hiddenText }),
      };
    },
    issueCode: () => result?.issues[0]?.code,
  };
}

/**
 * Fetches the approved page before the brief is made, so a page that cannot be read is refused
 * without saving a brief. The brief's intake then reuses this one result.
 */
export async function fetchApprovedJobPage(
  pageFetch: JobPageFetch,
  sources: readonly OpportunitySourceInput[],
  log?: Pick<FastifyBaseLogger, "warn">,
): Promise<void> {
  const source = sources.find((candidate) => candidate.kind === "approved-url");
  if (source === undefined) return;
  const started = Date.now();
  // The options the brief's intake fetches a job posting with.
  await pageFetch.ingest(source.url, {
    preferJobPostingData: true,
    approved: true,
    approval: true,
  });
  const page = pageFetch.page();
  if (page === undefined) {
    // The issue code, host and duration only: never the path, the query or the page (#1836).
    const issueCode = pageFetch.issueCode() ?? "empty-content";
    log?.warn(
      { issueCode, host: jobPageHost(source.url), durationMs: Date.now() - started },
      "job page fetch failed",
    );
    throw new CliUserError(jobPageFetchRefusal(issueCode));
  }
  // A page that rendered its posting with JavaScript can give little more than a title. It is
  // refused before any brief is saved or model called, so no empty application is left (#2857).
  const words = wordCount(page.text);
  if (words < minimumJobPageWords) {
    log?.warn(
      { issueCode: "too-little-text", words, host: jobPageHost(source.url) },
      "job page fetch failed",
    );
    throw new CliUserError(jobPageTooShortRefusal(words));
  }
}

/** Fewer words than this on a fetched job page is a title or a cookie banner, not a posting. */
export const minimumJobPageWords = 40;

function wordCount(text: string): number {
  return text.split(/\s+/u).filter((word) => /\p{L}/u.test(word)).length;
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
