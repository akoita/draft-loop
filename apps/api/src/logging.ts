import type { FastifyBaseLogger, FastifyServerOptions } from "fastify";

/**
 * The API's logs, as Cloud Logging reads them: one JSON object a line with a `severity` and a
 * `message`. They stay content-free (ADR 0011, D16): a request is logged by its method, route
 * pattern, status and duration, never its headers, body, query or client address, and an error by
 * its type, code and stack frames, never its message, which may quote what a person sent.
 */
const severities: Readonly<Record<string, string>> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

interface LoggedRequest {
  readonly id?: unknown;
  readonly method?: unknown;
  readonly routeOptions?: { readonly url?: unknown };
}

interface LoggedError {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly statusCode?: unknown;
  readonly stack?: unknown;
}

/** The stack's frames only: its first line repeats the message. */
export function stackFrames(stack: unknown): readonly string[] {
  if (typeof stack !== "string") return [];
  return stack
    .split("\n")
    .filter((line) => line.startsWith("    at "))
    .map((line) => line.trim());
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return { type: typeof error };
  const { name, code, statusCode, stack } = error as LoggedError;
  return {
    type: typeof name === "string" ? name : "Error",
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof statusCode === "number" ? { statusCode } : {}),
    frames: stackFrames(stack),
  };
}

type LoggerOptions = Exclude<
  FastifyServerOptions["logger"],
  boolean | FastifyBaseLogger | undefined
>;

/** Fastify's logger options for Cloud Logging; `stream` lets tests read the lines. */
export function cloudLoggingOptions(stream?: { write: (line: string) => void }): LoggerOptions {
  return {
    messageKey: "message",
    base: null,
    formatters: { level: (label) => ({ severity: severities[label] ?? "DEFAULT" }) },
    // Fastify types each serializer's output for its default fields; these keep fewer on purpose.
    serializers: {
      req: (request: LoggedRequest) => ({
        id: request.id,
        method: request.method,
        route: request.routeOptions?.url ?? "unmatched",
      }),
      res: (reply: { readonly statusCode?: unknown }) => ({ statusCode: reply.statusCode }),
      err: errorFields,
    } as unknown as NonNullable<LoggerOptions["serializers"]>,
    ...(stream === undefined ? {} : { stream }),
  };
}
