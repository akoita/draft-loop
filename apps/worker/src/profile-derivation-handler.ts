import {
  type ApplicationService,
  userFixableProfileDerivationMessage,
} from "@draft-loop/application";
import type {
  ProfileDerivationJob,
  ProfileDerivationJobHandler,
  ProfileDerivationOutcome,
  ProfileDerivationUsage,
} from "@draft-loop/run-queue";

import { currentJobUsage } from "./model-call-log.js";

export interface ProfileDerivationHandlerOptions {
  /** The application over the job's tenant: each job names its own (ADR 0011, D3). */
  readonly serviceFor: (
    job: ProfileDerivationJob,
  ) => Pick<ApplicationService, "deriveCanonicalCandidateProfile">;
  /** The driver's reference for the job's workspace, as the API resolves it. */
  readonly workspaceRoot: (job: ProfileDerivationJob) => string;
  /** Whether candidate material may go to the author's company, from the deployment's policy. */
  readonly allowProviderData: boolean;
  /** In sign-in deployments, the record's current consent, checked as each job is claimed. */
  readonly consentFor?: (job: ProfileDerivationJob) => Promise<boolean>;
  /** Whether the workspace's candidate record is erased or being erased, checked first. */
  readonly recordErased?: (job: ProfileDerivationJob) => Promise<boolean>;
  readonly onOutcome?: (job: ProfileDerivationJob, outcome: ProfileDerivationOutcome) => void;
  /** What the job's model calls used so far; the worker's meter by default (#2815). */
  readonly usage?: () => ProfileDerivationUsage | undefined;
}

/**
 * Derives one queued career profile through `ApplicationService`, as the desktop does in its own
 * process: the same selected evidence, sensitivity exclusions and extractor, a fixture extractor in
 * a fixture workspace. Evidence goes to a provider only when both the deployment and the person
 * allowed it. A cancel aborts the job's signal, which stops the derivation before its next provider
 * call and saves no version. A failure the person can fix ends the job with its fixed message; any
 * other throw fails the attempt for the queue to retry.
 */
export function createProfileDerivationHandler(
  options: ProfileDerivationHandlerOptions,
): ProfileDerivationJobHandler {
  const usage = options.usage ?? currentJobUsage;
  // What the derivation's calls used, failed ones included, rides on its outcome.
  const used = () => {
    const total = usage();
    return total === undefined ? {} : { usage: total };
  };
  const derive: ProfileDerivationJobHandler = async (job, control) => {
    if (options.recordErased !== undefined && (await options.recordErased(job))) {
      return { outcome: "record-erased" };
    }
    if (options.consentFor !== undefined && !(await options.consentFor(job))) {
      return { outcome: "consent-required" };
    }
    try {
      const record = await options.serviceFor(job).deriveCanonicalCandidateProfile({
        root: options.workspaceRoot(job),
        profileId: job.profileId,
        allowProviderData: options.allowProviderData && job.providerDataApproved,
        ...(job.fullExtraction === true ? { fullExtraction: true } : {}),
        signal: control.signal,
        onProgress: control.reportProgress,
      });
      return {
        outcome: "derived",
        version: record.profile.version,
        ...(record.reusedSourceCount === undefined || record.extractedSourceCount === undefined
          ? {}
          : {
              reusedSourceCount: record.reusedSourceCount,
              extractedSourceCount: record.extractedSourceCount,
            }),
        ...used(),
      };
    } catch (error) {
      // A cancelled derivation saves nothing, whatever shape the abort took on its way up.
      if (control.signal.aborted) return { outcome: "cancelled", ...used() };
      const message = userFixableProfileDerivationMessage(error);
      if (message === undefined) throw error;
      return { outcome: "failed", message, ...used() };
    }
  };
  return async (job, control) => {
    const outcome = await derive(job, control);
    options.onOutcome?.(job, outcome);
    return outcome;
  };
}
