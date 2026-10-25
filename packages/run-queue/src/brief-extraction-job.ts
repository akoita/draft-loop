import { z } from "zod";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);

/**
 * What a queued brief extraction carries: ids and the brief version it was queued for, never the
 * job text. The worker reads the text from the application's record and checks it against the
 * brief's source checksum, so a job queued before an edit or a new job text does nothing.
 */
export const briefExtractionJobSchema = z.strictObject({
  tenantId: identifierSchema,
  workspaceId: identifierSchema,
  applicationId: identifierSchema,
  briefId: identifierSchema,
  version: z.number().int().positive(),
});

export type BriefExtractionJob = z.infer<typeof briefExtractionJobSchema>;

/** One job per brief version: the key the queue deduplicates on. */
export function briefExtractionJobKey(
  job: Pick<BriefExtractionJob, "tenantId" | "workspaceId" | "briefId" | "version">,
): string {
  return `${job.tenantId}/${job.workspaceId}/${job.briefId}@${job.version}`;
}

/** Where a brief version's extraction stands: waiting or running, or failed after its retries. */
export type BriefExtractionState = "pending" | "failed";
