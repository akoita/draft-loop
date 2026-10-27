import type { IngestionIssueCode } from "@draft-loop/ingestion";

/**
 * What the person reads when an approved job page cannot be read, by the fetcher's issue code
 * (#1836). Each answer says what to do next; none repeats the address or the page.
 */
export function jobPageFetchRefusal(code: IngestionIssueCode | undefined): string {
  switch (code) {
    case "unsafe-url":
    case "approval-required":
      return "DraftLoop only fetches public https pages, and this address is not one. Paste the job text instead.";
    case "fetch-timeout":
      return "The job page took too long to answer. Try again, or paste the job text instead.";
    case "response-too-large":
    case "source-too-large":
    case "extracted-content-too-large":
      return "The job page is too large to read. Paste the job text instead.";
    case "unsupported-content-type":
    case "unsupported-media-type":
      return "The address is not a web page DraftLoop can read. Paste the job text instead.";
    case "redirect-limit":
      return "The job page redirected too many times. Check the address, or paste the job text instead.";
    case "empty-content":
    case "parse-failure":
    case "extracted-content-invalid":
      return "DraftLoop found no job text on this page. Paste the job text instead.";
    default:
      return "DraftLoop could not reach this job page. Check the address, or paste the job text instead.";
  }
}

/** The host of an address for a log line, never its path or query; null when it does not parse. */
export function jobPageHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
