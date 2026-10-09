// Content-free summary of an error's `cause` for the local host-error log. Only the cause's
// class name and validation issue locations (field paths and issue codes, with array indices
// removed) are kept. Values, free-form messages, stacks and candidate content are never logged.

const maximumCauseDetails = 5;
const maximumCauseDetailCharacters = 200;
const maximumIssuesScanned = 50;
const causeClassPattern = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;
const quoteCharacters = /["'`]/u;

export interface HostErrorCauseSummary {
  readonly causeClass: string;
  readonly causeDetails: readonly string[];
}

function readProperty(value: unknown, property: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function withoutIndices(text: string): string {
  return text.replace(/\[\d+\]/gu, "[]");
}

function describePath(path: readonly unknown[]): string | undefined {
  let text = "";
  for (const segment of path) {
    if (typeof segment === "number") text += "[]";
    else if (typeof segment === "string") text += text === "" ? segment : `.${segment}`;
    else return undefined;
  }
  return withoutIndices(text);
}

function describeIssue(issue: unknown): string | undefined {
  const field = readProperty(issue, "field");
  const message = readProperty(issue, "message");
  if (typeof field === "string" && typeof message === "string") {
    return withoutIndices(`${field}: ${message}`);
  }
  const code = readProperty(issue, "code");
  const path = readProperty(issue, "path");
  if (typeof code === "string" && Array.isArray(path)) {
    const described = describePath(path as readonly unknown[]);
    return described === undefined ? undefined : `${code} at ${described}`;
  }
  return undefined;
}

function isSafeDetail(detail: string): boolean {
  return detail.length <= maximumCauseDetailCharacters && !quoteCharacters.test(detail);
}

function causeDetailsOf(cause: Error): readonly string[] {
  const issues = readProperty(cause, "issues");
  if (!Array.isArray(issues)) return [];
  const details: string[] = [];
  for (const issue of (issues as readonly unknown[]).slice(0, maximumIssuesScanned)) {
    if (details.length >= maximumCauseDetails) break;
    const detail = describeIssue(issue);
    if (detail !== undefined && isSafeDetail(detail)) details.push(detail);
  }
  return details;
}

/** Summarize an `Error` cause, or return `undefined` when the error has none. */
export function summarizeHostErrorCause(error: unknown): HostErrorCauseSummary | undefined {
  const cause = readProperty(error, "cause");
  if (!isError(cause)) return undefined;
  const name = readProperty(cause, "name");
  return {
    causeClass: typeof name === "string" && causeClassPattern.test(name) ? name : "UnknownError",
    causeDetails: causeDetailsOf(cause),
  };
}
