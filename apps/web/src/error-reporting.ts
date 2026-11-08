/**
 * Reports a crash in this tab to the API as a content-free report (#2464): the error's message
 * with quoted text, addresses and numbers removed, its stack frames, the screen's path with ids
 * replaced, and the build. Never what the person typed, a query string or a token.
 */

import {
  type ClientErrorKind,
  type ClientErrorReport,
  clientErrorReport,
} from "@draft-loop/domain/client-error-report";

/** Reports one tab sends at most; a loop that throws on every frame stops after these. */
export const maxReportsPerTab = 5;

export interface ErrorReportingTarget {
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "unhandledrejection",
    listener: (event: PromiseRejectionEvent) => void,
  ): void;
}

export interface ErrorReportingOptions {
  readonly target: ErrorReportingTarget;
  readonly send: (report: ClientErrorReport) => void;
  /** The screen's path now. */
  readonly route: () => string;
  /** The entry script this tab runs, which names the build. */
  readonly build: string;
}

function described(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return reason.stack === undefined
      ? { message: `${reason.name}: ${reason.message}` }
      : { message: `${reason.name}: ${reason.message}`, stack: reason.stack };
  }
  // A rejection with a value that is not an error says nothing safe beyond its type.
  return { message: `Non-error rejection (${reason === null ? "null" : typeof reason})` };
}

/** Listens for uncaught errors and rejected promises, and sends each distinct one once. */
export function installErrorReporting(options: ErrorReportingOptions): void {
  const seen = new Set<string>();
  const report = (kind: ClientErrorKind, reason: unknown, fallback?: string) => {
    if (seen.size >= maxReportsPerTab) return;
    const { message, stack } =
      reason === undefined || reason === null
        ? { message: fallback ?? "Unknown error" }
        : described(reason);
    const built = clientErrorReport({
      kind,
      message,
      stack,
      route: options.route(),
      build: options.build,
    });
    const key = `${built.kind}|${built.message}|${built.stack[0] ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    try {
      options.send(built);
    } catch {
      // Reporting must never raise a second error.
    }
  };
  options.target.addEventListener("error", (event) =>
    report("error", event.error, typeof event.message === "string" ? event.message : undefined),
  );
  options.target.addEventListener("unhandledrejection", (event) =>
    report("unhandled_rejection", event.reason),
  );
}

/** Posts a report to the API; `keepalive` lets it leave even while the page unloads. */
export function sendErrorReport(fetchImpl: typeof fetch = fetch) {
  return (report: ClientErrorReport): void => {
    void fetchImpl("/v1/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  };
}
