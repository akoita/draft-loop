import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

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

const currentRequest = new AsyncLocalStorage<string>();

/** The id of the request whose work is running; undefined outside a request. */
export function currentRequestId(): string | undefined {
  return currentRequest.getStore();
}

/**
 * Keeps the request's id available to everything the request runs, so the run queue can carry it
 * without each route passing it along.
 */
export function registerRequestTrace(app: FastifyInstance): void {
  app.addHook("onRequest", (request, _reply, done) => {
    currentRequest.run(request.id, done);
  });
}
