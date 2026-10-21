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
});

export type RunJob = z.infer<typeof runJobSchema>;

/** One queued job per run at a time: the key the queue deduplicates on. */
export function runJobKey(job: RunJob): string {
  return `${job.tenantId}/${job.workspaceId}/${job.runId}`;
}
