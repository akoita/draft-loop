import type { ApiSchemas } from "./api-types.generated.js";

/**
 * The technical facts a feedback note carries (#2875): what the screen saw, never what it showed.
 * The API client records each failed call's code, message and request id here, and the ids of
 * the record, application and run it last called for; no request or answer body is kept. Each
 * value is built within the API's bounds (`FeedbackClientContext` in the OpenAPI document).
 */

export type FeedbackClientContext = ApiSchemas["FeedbackClientContextInput"];

/** The API's bounds: the errors a context keeps and its size, in characters of JSON. */
const maximumFeedbackRecentErrors = 5;
const maximumContextCharacters = 3_072;

type RecentError = NonNullable<FeedbackClientContext["recentErrors"]>[number];
type ViewIds = NonNullable<FeedbackClientContext["ids"]>;

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const codePattern = /^[A-Za-z0-9_.:-]{1,64}$/u;

const recentErrors: RecentError[] = [];
let lastFailedRequestId: string | undefined;
let viewIds: { recordId?: string; applicationId?: string; runId?: string } = {};

function safeId(value: string | null | undefined): string | undefined {
  return value !== null && value !== undefined && idPattern.test(value) ? value : undefined;
}

/** Keeps a failed call's content-free code and message, and its request id when it has one. */
export function recordApiFailure(
  failure: { readonly code: string; readonly message: string; readonly requestId?: string | null },
  at: Date = new Date(),
): void {
  recentErrors.push({
    code: codePattern.test(failure.code) ? failure.code : "unknown",
    message: failure.message.slice(0, 200),
    at: at.toISOString(),
  });
  while (recentErrors.length > maximumFeedbackRecentErrors) recentErrors.shift();
  const requestId = safeId(failure.requestId);
  if (requestId !== undefined) lastFailedRequestId = requestId;
}

/** Remembers the record, application and run a call was for, from its path parameters. */
export function recordApiPath(path: Readonly<Record<string, string>> | undefined): void {
  const recordId = safeId(path?.workspaceId);
  if (recordId === undefined) return;
  // Another record: what was in view of the last one no longer is.
  if (recordId !== viewIds.recordId) viewIds = { recordId };
  const applicationId = safeId(path?.applicationId);
  const runId = safeId(path?.runId);
  if (applicationId !== undefined) viewIds.applicationId = applicationId;
  if (runId !== undefined) viewIds.runId = runId;
}

/** Forgets every recorded failure and id; for tests. */
export function resetFeedbackContext(): void {
  recentErrors.length = 0;
  lastFailedRequestId = undefined;
  viewIds = {};
}

/** The browser family from a user agent, never the user agent itself. */
export function browserFamily(userAgent: string): string {
  if (/\bEdg\//u.test(userAgent)) return "Edge";
  if (/\bOPR\//u.test(userAgent)) return "Opera";
  if (/\b(?:Firefox|FxiOS)\//u.test(userAgent)) return "Firefox";
  if (/\b(?:Chrome|CriOS|Chromium)\//u.test(userAgent)) return "Chrome";
  if (/\bSafari\//u.test(userAgent)) return "Safari";
  return "Other";
}

/** The operating system family from a user agent. */
export function osFamily(userAgent: string): string {
  if (/\b(?:iPhone|iPad|iPod)\b/u.test(userAgent)) return "iOS";
  if (/\bAndroid\b/u.test(userAgent)) return "Android";
  if (/\bWindows\b/u.test(userAgent)) return "Windows";
  if (/\bCrOS\b/u.test(userAgent)) return "ChromeOS";
  if (/\b(?:Macintosh|Mac OS X)\b/u.test(userAgent)) return "macOS";
  if (/\bLinux\b/u.test(userAgent)) return "Linux";
  return "Other";
}

/** What the page tells about itself; `collectFeedbackContext` reads it from the browser. */
export interface FeedbackPage {
  readonly pathname: string;
  readonly hash: string;
  /** The entry script's address, which names the build. */
  readonly entryScript: string | null;
  readonly userAgent: string;
  readonly width: number;
  readonly height: number;
  readonly language: string;
  readonly theme: string | null;
}

/** The build id in an entry script's address, such as `index-a1b2c3` in `/assets/index-a1b2c3.js`. */
export function webBuildOf(entryScript: string | null): string | undefined {
  const name = entryScript
    ?.split("/")
    .pop()
    ?.replace(/\.m?js$/u, "")
    .replace(/[^A-Za-z0-9._-]/gu, "")
    .slice(0, 64);
  return name === undefined || name === "" ? undefined : name;
}

function contextFrom(page: FeedbackPage, withErrors: boolean): FeedbackClientContext {
  // A query, even inside the fragment, can hold values; the route keeps what comes before it.
  const route = `${page.pathname.split("?")[0]}${page.hash.split("?")[0]}`
    .replace(/[^A-Za-z0-9._:/#-]/gu, "")
    .slice(0, 200);
  const webBuild = webBuildOf(page.entryScript);
  const ids: ViewIds = { ...viewIds };
  const language =
    page.language.length <= 35 && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(page.language)
      ? page.language
      : "und";
  return {
    route,
    ...(webBuild === undefined ? {} : { webBuild }),
    ...(Object.keys(ids).length === 0 ? {} : { ids }),
    ...(withErrors && recentErrors.length > 0 ? { recentErrors: [...recentErrors] } : {}),
    ...(withErrors && lastFailedRequestId !== undefined ? { lastFailedRequestId } : {}),
    browser: {
      family: browserFamily(page.userAgent),
      os: osFamily(page.userAgent),
      viewport: `${Math.max(0, Math.min(99_999, Math.round(page.width)))}x${Math.max(0, Math.min(99_999, Math.round(page.height)))}`,
      language,
      theme: page.theme === "light" ? "light" : "dark",
    },
  };
}

/**
 * The context a note sends, exactly as the dialog lists it. Should the errors push it past its
 * bound, they are left out; should it still not fit, nothing is sent.
 */
export function feedbackContextFor(page: FeedbackPage): FeedbackClientContext | undefined {
  for (const withErrors of [true, false]) {
    const context = contextFrom(page, withErrors);
    if (JSON.stringify(context).length <= maximumContextCharacters) return context;
  }
  return undefined;
}

/** The current page's facts, in a browser. */
export function currentFeedbackPage(): FeedbackPage {
  return {
    pathname: window.location.pathname,
    hash: window.location.hash,
    entryScript: document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? null,
    userAgent: navigator.userAgent,
    width: window.innerWidth,
    height: window.innerHeight,
    language: navigator.language,
    theme: document.documentElement.getAttribute("data-theme"),
  };
}
