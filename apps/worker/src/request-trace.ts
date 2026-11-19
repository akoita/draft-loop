import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The id of the API request that queued the running job (#3110). Every log line the job writes
 * carries it, and Cloud Logging's trace field where the deployment names its project, so the
 * log viewer shows the API's and the worker's lines of one request together.
 */
const currentRequest = new AsyncLocalStorage<string | undefined>();

/** Runs a job's work with its request id on every line it logs; none leaves lines as they were. */
export function withRequestId<Result>(
  requestId: string | undefined,
  work: () => Promise<Result>,
): Promise<Result> {
  return currentRequest.run(requestId, work);
}

/** The running job's request fields: its id and, with a project, Cloud Logging's trace. */
export function requestFields(
  project: string | undefined = process.env.GOOGLE_CLOUD_PROJECT?.trim(),
): Record<string, string> {
  const requestId = currentRequest.getStore();
  if (requestId === undefined) return {};
  return project === undefined || project === ""
    ? { requestId }
    : { requestId, "logging.googleapis.com/trace": `projects/${project}/traces/${requestId}` };
}
