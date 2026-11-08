import type { PgBoss, Queue } from "pg-boss";
import { z } from "zod";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);

export const materialReviewQueueName = "draft-loop-material-reviews";

/**
 * What a queued critic pass on a saved cover letter carries (#2525): ids only, never the letter.
 * The worker reads the draft and the record when it claims the job.
 */
export const materialReviewJobSchema = z.strictObject({
  tenantId: identifierSchema,
  workspaceId: identifierSchema,
  applicationId: identifierSchema,
  materialId: z.string().regex(/^amd_[A-Za-z0-9_-]{8,64}$/u),
});

export type MaterialReviewJob = z.infer<typeof materialReviewJobSchema>;

/** One pass per saved draft: the key the queue deduplicates on. */
export function materialReviewJobKey(
  job: Pick<MaterialReviewJob, "tenantId" | "workspaceId" | "materialId">,
): string {
  return `${job.tenantId}/${job.workspaceId}/${job.materialId}`;
}

/**
 * How one claimed pass ended, kept as the job's output: a word from the application's outcomes,
 * or the worker's refusals before any provider call.
 */
export const materialReviewOutcomes = [
  "revised",
  "clean",
  "kept",
  "missing",
  "skipped",
  "superseded",
  "consent-required",
  "record-erased",
  "unavailable",
] as const;

export type MaterialReviewJobOutcome = (typeof materialReviewOutcomes)[number];

/** Where a draft's pass stands, as the panel polls it. */
export type MaterialReviewState =
  | { readonly status: "pending" }
  | { readonly status: "done"; readonly outcome: MaterialReviewJobOutcome }
  /** The pass failed its retries, as after provider errors; the first draft stands. */
  | { readonly status: "failed" };

/**
 * How passes are retried: two provider calls each, so a short expiry and one retry, which keeps a
 * failing provider from repeating the spend. The first draft is already saved either way.
 */
export const materialReviewQueueSettings: Omit<Queue, "name"> = {
  policy: "exclusive",
  retryLimit: 1,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 300,
  heartbeatSeconds: 60,
  expireInSeconds: 10 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};

/** The producer side of critic passes, as the API uses it. */
export interface MaterialReviewQueue {
  /** Queues the pass; false when one for the same draft already waits or runs. */
  readonly enqueueMaterialReview: (job: MaterialReviewJob) => Promise<boolean>;
  /** Where the draft's newest pass stands; undefined when none was queued. */
  readonly materialReviewState: (
    key: Pick<MaterialReviewJob, "tenantId" | "workspaceId" | "materialId">,
  ) => Promise<MaterialReviewState | undefined>;
}

const outstanding: ReadonlySet<string> = new Set(["created", "retry", "active"]);
const outputSchema = z.object({ outcome: z.enum(materialReviewOutcomes) });

/** @internal Shared with the run queue; not part of the package's exports. */
export function materialReviewQueue(boss: PgBoss): MaterialReviewQueue {
  return {
    enqueueMaterialReview: async (job) => {
      const data = materialReviewJobSchema.parse(job);
      const id = await boss.send(materialReviewQueueName, data, {
        singletonKey: materialReviewJobKey(data),
      });
      return id !== null;
    },
    materialReviewState: async (key) => {
      const [newest] = (
        await boss.findJobs(materialReviewQueueName, { key: materialReviewJobKey(key) })
      ).sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime());
      if (newest === undefined) return undefined;
      if (outstanding.has(newest.state)) return { status: "pending" };
      const output = outputSchema.safeParse(newest.output);
      if (newest.state !== "completed" || !output.success) return { status: "failed" };
      return { status: "done", outcome: output.data.outcome };
    },
  };
}
