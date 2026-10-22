/**
 * On Cloud Run the worker is a job that drains the queue and exits (ADR 0011, D4), so after the
 * API queues a run it starts the job. A scheduled sweep also starts it, so a failed wake only
 * delays the run: it is reported and never fails the request that queued it.
 */
export type WakeWorker = () => Promise<void>;

/** Queues the run, then wakes the worker; a wake failure goes to `onWakeError` only. */
export function enqueueThenWake(
  enqueue: (workspaceId: string, runId: string) => Promise<void>,
  wake: WakeWorker,
  onWakeError: (error: unknown) => void,
): (workspaceId: string, runId: string) => Promise<void> {
  return async (workspaceId, runId) => {
    await enqueue(workspaceId, runId);
    try {
      await wake();
    } catch (error) {
      onWakeError(error);
    }
  };
}

/** The local stack's worker serves the queue all the time, so there is nothing to wake. */
export const noWake: WakeWorker = async () => undefined;

export class WorkerWakeError extends Error {
  override readonly name = "WorkerWakeError";
}

const jobNamePattern =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/jobs\/[a-z][a-z0-9-]{0,62}$/u;

/** Whether a value is a Cloud Run job's full name, `projects/<p>/locations/<l>/jobs/<j>`. */
export function isCloudRunJobName(value: string): boolean {
  return jobNamePattern.test(value);
}

const metadataTokenUrl =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export interface CloudRunJobWakeOptions {
  /** The worker job's full name. */
  readonly jobName: string;
  readonly fetch?: typeof fetch;
}

/**
 * Starts one execution of the worker job through the Cloud Run Admin API, as the API's own service
 * identity: its access token comes from the metadata server, so no key exists.
 */
export function cloudRunJobWake(options: CloudRunJobWakeOptions): WakeWorker {
  if (!isCloudRunJobName(options.jobName)) {
    throw new WorkerWakeError("The worker job must be a full Cloud Run job name.");
  }
  const request = options.fetch ?? fetch;
  return async () => {
    const tokenResponse = await request(metadataTokenUrl, {
      headers: { "Metadata-Flavor": "Google" },
    });
    if (!tokenResponse.ok) {
      throw new WorkerWakeError(`The metadata server refused a token: ${tokenResponse.status}`);
    }
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
    if (typeof accessToken !== "string" || accessToken === "") {
      throw new WorkerWakeError("The metadata server returned no access token.");
    }
    const response = await request(`https://run.googleapis.com/v2/${options.jobName}:run`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) {
      throw new WorkerWakeError(`Cloud Run refused to start the worker job: ${response.status}`);
    }
  };
}
