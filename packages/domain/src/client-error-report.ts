/**
 * Browser error reports (#2464): what a crash in the web screen may tell the server. A report
 * carries the error's shape and where it happened, never what the person typed or read. Both the
 * web screen and the API apply these rules, so a report is content-free even from an old screen.
 */

export const clientErrorKinds = ["error", "unhandled_rejection"] as const;

export type ClientErrorKind = (typeof clientErrorKinds)[number];

export interface ClientErrorReport {
  readonly kind: ClientErrorKind;
  /** The error's message, with quoted text, addresses and numbers removed. */
  readonly message: string;
  /** Stack frames only: function, file path, line and column. */
  readonly stack: readonly string[];
  /** The screen's path, with every id replaced by `:id`. */
  readonly route: string;
  /** The entry script the tab runs, which names the build. */
  readonly build: string;
}

export const clientErrorMessageMaxLength = 200;
export const clientErrorStackMaxFrames = 20;
const frameMaxLength = 200;
const routeMaxLength = 200;
const buildMaxLength = 120;

/** Removes text a message may quote: strings in quotes, addresses, URLs' queries and numbers. */
export function scrubErrorMessage(message: string): string {
  const scrubbed = message
    .replace(/(["'`«“‘])[\s\S]*?(["'`»”’])/gu, "…")
    .replace(/[^\s@]+@[^\s@]+/gu, "[address]")
    .replace(/\b(https?:\/\/[^\s?#]+)[?#]\S*/gu, "$1")
    .replace(/\d{2,}/gu, "#")
    .replace(/\s+/gu, " ")
    .trim();
  return scrubbed.length <= clientErrorMessageMaxLength
    ? scrubbed
    : `${scrubbed.slice(0, clientErrorMessageMaxLength - 1)}…`;
}

// Chrome: "    at name (url:1:2)" or "    at url:1:2". Firefox and Safari: "name@url:1:2".
const chromeFrame = /^\s*at\s+(?:([\w$.<>[\] ]{1,80}?)\s+\()?(\S+?):(\d+):(\d+)\)?\s*$/u;
const geckoFrame = /^\s*([\w$.<>/[\]]{0,80})@(\S+?):(\d+):(\d+)\s*$/u;
// A frame this module already wrote, as the API receives it from the screen.
const scrubbedFrame = /^([\w$.<>/[\]]{1,80} )?(\S+?):(\d+):(\d+)$/u;

/** Only a script's path: no origin, query or fragment, and nothing that is not a file path. */
function framePath(location: string): string {
  let path = location;
  try {
    const url = new URL(location);
    path = url.pathname;
  } catch {
    path = location.replace(/[?#].*$/u, "");
  }
  return /^[\w./@-]{1,160}$/u.test(path) ? path : "?";
}

/** Keeps the stack's frames, rewritten as `name path:line:col`, and drops every other line. */
export function scrubErrorStack(stack: string | undefined): string[] {
  if (stack === undefined) return [];
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const match = chromeFrame.exec(line) ?? geckoFrame.exec(line) ?? scrubbedFrame.exec(line);
    if (match === null) continue;
    const [, name, location = "", row, column] = match;
    const trimmed = name?.trim().replace(/\s+/gu, ".") ?? "";
    const label = trimmed === "" ? "" : `${trimmed} `;
    frames.push(`${label}${framePath(location)}:${row}:${column}`.slice(0, frameMaxLength));
    if (frames.length >= clientErrorStackMaxFrames) break;
  }
  return frames;
}

/** The path only, each segment that is not a plain lowercase word replaced by `:id`. */
export function scrubErrorRoute(route: string): string {
  const path = route.replace(/[?#].*$/u, "");
  const segments = path
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => (/^[a-z][a-z-]{0,30}$/u.test(segment) ? segment : ":id"));
  return `/${segments.join("/")}`.slice(0, routeMaxLength);
}

/** The build's entry script path, or `unknown` when it does not look like one. */
export function scrubErrorBuild(build: string): string {
  const path = framePath(build);
  return path !== "?" && path.length <= buildMaxLength ? path : "unknown";
}

export interface ClientErrorInput {
  readonly kind: ClientErrorKind;
  readonly message: string;
  readonly stack?: string | readonly string[] | undefined;
  readonly route: string;
  readonly build: string;
}

/** The content-free report for one error. */
export function clientErrorReport(input: ClientErrorInput): ClientErrorReport {
  const stack =
    typeof input.stack === "string" || input.stack === undefined
      ? scrubErrorStack(input.stack)
      : scrubErrorStack(input.stack.join("\n"));
  return {
    kind: input.kind,
    message: scrubErrorMessage(input.message),
    stack,
    route: scrubErrorRoute(input.route),
    build: scrubErrorBuild(input.build),
  };
}
