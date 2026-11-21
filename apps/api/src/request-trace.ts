import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

/**
 * One id per request (#3110), carried from the browser through the API and the run queue to the
 * worker's log lines and run spans. It is the W3C trace id of an incoming `traceparent` header,
 * which Cloud Run's front end sets, or a new random one: 32 lowercase hex characters either way,
 * so Cloud Logging groups the API's lines, the worker's lines and its own request log by it.
 */
const traceparentPattern = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/u;
const zeroTraceId = "0".repeat(32);

/** The trace id of a valid `traceparent` value, or a new random id. */
export function requestIdFrom(traceparent: unknown): string {
  if (typeof traceparent === "string") {
    const traceId = traceparentPattern.exec(traceparent.trim().toLowerCase())?.[1];
    if (traceId !== undefined && traceId !== zeroTraceId) return traceId;
  }
  return randomUUID().replaceAll("-", "");
}

/** Cloud Logging's trace field for a request id, when the deployment names its project. */
export function traceFields(
  requestId: string,
  project: string | undefined,
): Record<string, string> {
  return project === undefined || project === ""
    ? {}
    : { "logging.googleapis.com/trace": `projects/${project}/traces/${requestId}` };
}

const zeroSpanId = "0".repeat(16);
const fullTraceparentPattern = /^00-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/u;

/**
 * The `traceparent` the request's queued work continues (#3238): the incoming header when it names
 * this request's trace, or a new parent span in it. Version 00 only, lowercase.
 */
export function traceparentFor(requestId: string, header: unknown): string | undefined {
  if (!/^[\da-f]{32}$/u.test(requestId) || requestId === zeroTraceId) return undefined;
  if (typeof header === "string") {
    const value = header.trim().toLowerCase();
    const match = fullTraceparentPattern.exec(value);
    if (match?.[1] === requestId && match[2] !== zeroSpanId) return value;
  }
  return `00-${requestId}-${randomBytes(8).toString("hex")}-01`;
}

interface RequestTrace {
  readonly id: string;
  readonly traceparent: string | undefined;
}

const currentRequest = new AsyncLocalStorage<RequestTrace>();

/** The id of the request whose work is running; undefined outside a request. */
export function currentRequestId(): string | undefined {
  return currentRequest.getStore()?.id;
}

/** The `traceparent` of the request whose work is running; undefined outside a request. */
export function currentTraceparent(): string | undefined {
  return currentRequest.getStore()?.traceparent;
}

/**
 * Keeps the request's id available to everything the request runs, so the run queue can carry it
 * without each route passing it along.
 */
export function registerRequestTrace(app: FastifyInstance): void {
  app.addHook("onRequest", (request, _reply, done) => {
    currentRequest.run(
      { id: request.id, traceparent: traceparentFor(request.id, request.headers.traceparent) },
      done,
    );
  });
}
