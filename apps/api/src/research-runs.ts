import type { ResearchState } from "@draft-loop/run-queue";

/** One application's research run, as the API addresses it; the tenant is the request's. */
export interface ResearchRunAddress {
  readonly workspaceId: string;
  readonly applicationId: string;
}

/**
 * Research runs the candidate approved (#2560), queued for the worker. The deployment's queue
 * fills it; without one nothing is researched.
 */
export interface ResearchRuns {
  /** Queues the run: `waiting` when one for the application already waits or runs. */
  readonly queue: (
    job: ResearchRunAddress & {
      readonly windowMonths?: number;
      /** For an interview guide (#2632): its depth and whether pay is a topic. */
      readonly guide?: { readonly depth: "essential" | "extensive"; readonly salary?: boolean };
    },
  ) => Promise<"queued" | "waiting" | "unavailable">;
  /** Where the application's newest run stands; undefined when none was queued. */
  readonly state: (address: ResearchRunAddress) => Promise<ResearchState | undefined>;
}

/** A deployment that queues no research, as an application composed without a queue. */
export const noResearchRuns: ResearchRuns = {
  queue: async () => "unavailable",
  state: async () => undefined,
};
