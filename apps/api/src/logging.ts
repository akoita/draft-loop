import type { FastifyBaseLogger, FastifyServerOptions } from "fastify";

import { traceFields } from "./request-trace.js";

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

/**
 * Error Reporting groups a structured line by a `stack_trace` it can parse (#3239). The trace is
 * rebuilt from the error's type, code and frames, never from its message, which may quote what a
 * person sent. An error with no frames gets nothing.
 */
export function errorReportFields(err: unknown): Record<string, unknown> {
  if (typeof err !== "object" || err === null) return {};
  const { type, code, frames } = err as { type?: unknown; code?: unknown; frames?: unknown };
  const lines = Array.isArray(frames)
    ? frames.filter((frame): frame is string => typeof frame === "string")
    : [];
  if (lines.length === 0) return {};
  const name = typeof type === "string" && /^[A-Za-z][A-Za-z0-9_]*$/u.test(type) ? type : "Error";
  const label = typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(code) ? code : "error";
  return { stack_trace: [`${name}: ${label}`, ...lines.map((frame) => `    ${frame}`)].join("\n") };
}

type LoggerOptions = Exclude<
  FastifyServerOptions["logger"],
  boolean | FastifyBaseLogger | undefined
>;

/**
 * Fastify's logger options for Cloud Logging; `stream` lets tests read the lines. With the
 * deployment's project, each request's lines carry Cloud Logging's trace field (#3110), so the
 * log viewer groups them with the worker's lines for the same request.
 */
export function cloudLoggingOptions(
  stream?: { write: (line: string) => void },
  project?: string,
): LoggerOptions {
  return {
    messageKey: "message",
    base: null,
    formatters: {
      level: (label) => ({ severity: severities[label] ?? "DEFAULT" }),
      // An error line carries a stack trace Error Reporting can group (#3239).
      log: (fields) => ({ ...fields, ...errorReportFields(fields.err) }),
    },
    // A request's child logger is bound to its id; each of its lines gets the trace field.
    mixin: (_merge: object, _level: number, logger: { bindings: () => { reqId?: unknown } }) => {
      const requestId = logger.bindings().reqId;
      return typeof requestId === "string" ? traceFields(requestId, project) : {};
    },
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
