import type { MaterialReviewState } from "@draft-loop/run-queue";

/** One saved draft's critic pass, as the API addresses it; the tenant is the request's. */
export interface MaterialReviewAddress {
  readonly workspaceId: string;
  readonly materialId: string;
}

/**
 * The critic pass on saved cover letters (#2525), queued for the worker. The deployment's queue
 * fills it; without one no pass runs and drafts stand as written.
 */
export interface MaterialReviews {
  /** Queues the pass; false when one for the draft already waits or runs. */
  readonly queue: (
    job: MaterialReviewAddress & { readonly applicationId: string },
  ) => Promise<boolean>;
  /** Where the draft's pass stands; undefined when none was queued. */
  readonly state: (address: MaterialReviewAddress) => Promise<MaterialReviewState | undefined>;
}

/** A deployment that queues no pass, as an application composed without a queue. */
export const noMaterialReviews: MaterialReviews = {
  queue: async () => false,
  state: async () => undefined,
};
