import type { PgBoss, Queue } from "pg-boss";
import { z } from "zod";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);

export const researchQueueName = "draft-loop-research";

/**
 * What a queued research run carries (#2560): ids and the window only, never the job's text. The
 * candidate approved the run before it was queued; the worker reads the application when it
 * claims the job.
 */
export const researchJobSchema = z.strictObject({
  tenantId: identifierSchema,
  workspaceId: identifierSchema,
  applicationId: identifierSchema,
  windowMonths: z.number().int().min(1).max(36).optional(),
});

export type ResearchJob = z.infer<typeof researchJobSchema>;

/** One run per application at a time: the key the queue deduplicates on. */
export function researchJobKey(
  job: Pick<ResearchJob, "tenantId" | "workspaceId" | "applicationId">,
): string {
  return `${job.tenantId}/${job.workspaceId}/${job.applicationId}`;
}

/**
 * How one claimed run ended, kept as the job's output: `researched` saved a brief; the rest are
 * the worker's refusals before any provider call.
 */
export const researchOutcomes = [
  "researched",
  "missing",
  "no-employer",
  "consent-required",
  "record-erased",
  "unavailable",
] as const;

export type ResearchJobOutcome = (typeof researchOutcomes)[number];

export interface ResearchJobResult {
  readonly outcome: ResearchJobOutcome;
  /** The brief the run saved, when it researched. */
  readonly briefId?: string;
}

/** Where an application's newest research run stands, as the panel polls it. */
export type ResearchState =
  | { readonly status: "pending" }
  | ({ readonly status: "done" } & ResearchJobResult)
  /** The run failed its retry, as after provider errors; nothing was saved. */
  | { readonly status: "failed" };

/**
 * How runs are retried: a few paid searches and one model call each, so one retry keeps a failing
 * provider from repeating the spend.
 */
export const researchQueueSettings: Omit<Queue, "name"> = {
  policy: "exclusive",
  retryLimit: 1,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 300,
  heartbeatSeconds: 60,
  expireInSeconds: 10 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};

/** The producer side of research runs, as the API uses it. */
export interface ResearchQueue {
  /** Queues the run; false when one for the same application already waits or runs. */
  readonly enqueueResearch: (job: ResearchJob) => Promise<boolean>;
  /** Where the application's newest run stands; undefined when none was queued. */
  readonly researchState: (
    key: Pick<ResearchJob, "tenantId" | "workspaceId" | "applicationId">,
  ) => Promise<ResearchState | undefined>;
}

const outstanding: ReadonlySet<string> = new Set(["created", "retry", "active"]);
const outputSchema = z.object({
  outcome: z.enum(researchOutcomes),
  briefId: z.string().optional(),
});

/** @internal Shared with the run queue; not part of the package's exports. */
export function researchQueue(boss: PgBoss): ResearchQueue {
  return {
    enqueueResearch: async (job) => {
      const data = researchJobSchema.parse(job);
      const id = await boss.send(researchQueueName, data, { singletonKey: researchJobKey(data) });
      return id !== null;
    },
    researchState: async (key) => {
      const [newest] = (await boss.findJobs(researchQueueName, { key: researchJobKey(key) })).sort(
        (a, b) => b.createdOn.getTime() - a.createdOn.getTime(),
      );
      if (newest === undefined) return undefined;
      if (outstanding.has(newest.state)) return { status: "pending" };
      const output = outputSchema.safeParse(newest.output);
      if (newest.state !== "completed" || !output.success) return { status: "failed" };
      return {
        status: "done",
        outcome: output.data.outcome,
        ...(output.data.briefId === undefined ? {} : { briefId: output.data.briefId }),
      };
    },
  };
}
