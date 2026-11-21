import { z } from "zod";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);

/**
 * What a queued run carries: ids only. The worker reads everything else from tenant-scoped
 * storage, so candidate material never sits in the queue's tables.
 */
export const runJobSchema = z.strictObject({
  tenantId: identifierSchema,
  workspaceId: identifierSchema,
  runId: identifierSchema,
  /**
   * The id of the API request that queued the job (#3110), so the worker's lines and spans for it
   * share the API's id. Optional: a job queued before it existed, or by a requeue, may lack one.
   */
  requestId: z
    .string()
    .regex(/^[\da-f]{32}$/u)
    .optional(),
  /**
   * The W3C `traceparent` of the API request that queued the job (#3238), so the worker's exported
   * spans continue that request's trace. Ids and flags only, like the rest of the payload.
   */
  traceparent: z
    .string()
    .regex(/^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/u)
    .optional(),
});

export type RunJob = z.infer<typeof runJobSchema>;

/** One queued job per run at a time: the key the queue deduplicates on. */
export function runJobKey(job: RunJob): string {
  return `${job.tenantId}/${job.workspaceId}/${job.runId}`;
}
