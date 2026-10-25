import type {
  ApplicationBriefExtractionOutcome,
  ApplicationService,
} from "@draft-loop/application";
import type { BriefExtractionJob, BriefExtractionJobHandler } from "@draft-loop/run-queue";

/** What one brief extraction job did; ids and this word are all the worker logs. */
export type BriefExtractionJobOutcome =
  | ApplicationBriefExtractionOutcome
  /** The brief's candidate record is erased or being erased: the job ends without a provider call. */
  | "record-erased"
  /**
   * The record's current provider transmission consent does not cover the workspace's providers:
   * the job ends without a provider call, and the person can still edit the brief by hand.
   */
  | "consent-required";

export interface BriefExtractionHandlerOptions {
  /** The application over the job's tenant: each job names its own (ADR 0011, D3). */
  readonly serviceFor: (
    job: BriefExtractionJob,
  ) => Pick<ApplicationService, "extractApplicationBrief">;
  /** The driver's reference for the job's workspace, as the API resolves it. */
  readonly workspaceRoot: (job: BriefExtractionJob) => string;
  /** Whether the job text may go to the author's company, from the deployment's consent policy. */
  readonly allowProviderData: boolean;
  /** In sign-in deployments, the record's current consent, checked as each job is claimed. */
  readonly consentFor?: (job: BriefExtractionJob) => Promise<boolean>;
  /** Whether the job's candidate record is erased or being erased, checked before anything else. */
  readonly recordErased?: (job: BriefExtractionJob) => Promise<boolean>;
  readonly onOutcome?: (job: BriefExtractionJob, outcome: BriefExtractionJobOutcome) => void;
}

/**
 * Extracts one queued live brief through `ApplicationService`. A job can arrive twice or after the
 * person edited the brief, so the service checks the brief's version and the job text's checksum
 * and does nothing when either moved on; the erasure and consent checks run first.
 */
export function createBriefExtractionHandler(
  options: BriefExtractionHandlerOptions,
): BriefExtractionJobHandler {
  const extract = async (job: BriefExtractionJob): Promise<BriefExtractionJobOutcome> => {
    if (options.recordErased !== undefined && (await options.recordErased(job))) {
      return "record-erased";
    }
    if (options.consentFor !== undefined && !(await options.consentFor(job))) {
      return "consent-required";
    }
    const service = options.serviceFor(job);
    if (service.extractApplicationBrief === undefined) {
      throw new Error("Extracting a brief needs the hosted application driver.");
    }
    const result = await service.extractApplicationBrief({
      root: options.workspaceRoot(job),
      applicationId: job.applicationId,
      briefId: job.briefId,
      expectedVersion: job.version,
      allowProviderData: options.allowProviderData,
    });
    return result.outcome;
  };
  return async (job) => {
    const outcome = await extract(job);
    options.onOutcome?.(job, outcome);
  };
}
