import type { ApplicationService } from "@draft-loop/application";
import {
  type ApplicationMaterialRecordService,
  applicationMaterialRecordInput,
} from "@draft-loop/application/application-material-input";
import type { FactUsageService } from "@draft-loop/application/fact-usage";
import {
  type MaterialReviewOutcome,
  reviewableMaterial,
  reviewSavedApplicationMaterial,
} from "@draft-loop/application/material-review";
import type {
  MaterialReviewPorts,
  MaterialReviewPortsOptions,
} from "@draft-loop/application/material-review-ports";
import type { WritingSamplesService } from "@draft-loop/application/writing-samples";
import type {
  MaterialReviewJob,
  MaterialReviewJobHandler,
  MaterialReviewJobOutcome,
} from "@draft-loop/run-queue";
import type { SavedApplicationMaterialStore } from "@draft-loop/storage/saved-application-material";

export interface MaterialReviewHandlerOptions {
  /** The application over the job's tenant: each job names its own (ADR 0011, D3). */
  readonly serviceFor: (
    job: MaterialReviewJob,
  ) => ApplicationMaterialRecordService &
    Pick<ApplicationService, "readWorkspace" | "getApplication">;
  /** The tenant's saved drafts. */
  readonly draftsFor: (job: MaterialReviewJob) => SavedApplicationMaterialStore;
  /** The record's writing samples and fact usage, read as the API reads them. */
  readonly settingsFor?: (job: MaterialReviewJob) => {
    readonly writingSamples?: Pick<WritingSamplesService, "read">;
    readonly factUsage?: Pick<FactUsageService, "read">;
  };
  readonly workspaceRoot: (job: MaterialReviewJob) => string;
  /** Whether the letter may go to the providers, from the deployment's consent policy. */
  readonly allowProviderData: boolean;
  /** In sign-in deployments, the record's current consent, checked as each job is claimed. */
  readonly consentFor?: (job: MaterialReviewJob) => Promise<boolean>;
  /** Whether the job's candidate record is erased or being erased, checked before anything else. */
  readonly recordErased?: (job: MaterialReviewJob) => Promise<boolean>;
  /** The author and critic over the deployment's routes; scripted fakes in tests. */
  readonly portsFor: (
    job: MaterialReviewJob,
    models: Pick<
      MaterialReviewPortsOptions,
      "author" | "critic" | "applicationId" | "allowProviderData"
    >,
  ) => MaterialReviewPorts;
  readonly newId: () => string;
  readonly now?: () => Date;
  /** Ids, counts and the outcome's word only: never the letter. */
  readonly onOutcome?: (
    job: MaterialReviewJob,
    outcome: MaterialReviewJobOutcome,
    detail: { readonly findings: number; readonly costUsd: number; readonly revisionId?: string },
  ) => void;
}

/**
 * Runs the critic pass on one saved cover letter (#2525). The erasure and consent checks run
 * first, then a draft nobody may review is skipped without a call. A pass needs a critic from
 * another company than the draft's author; without one the first draft stands.
 */
export function createMaterialReviewHandler(
  options: MaterialReviewHandlerOptions,
): MaterialReviewJobHandler {
  const review = async (
    job: MaterialReviewJob,
  ): Promise<{
    outcome: MaterialReviewJobOutcome;
    findings: number;
    costUsd: number;
    revisionId?: string;
  }> => {
    const none = { findings: 0, costUsd: 0 };
    if (options.recordErased !== undefined && (await options.recordErased(job))) {
      return { outcome: "record-erased", ...none };
    }
    if (options.consentFor !== undefined && !(await options.consentFor(job))) {
      return { outcome: "consent-required", ...none };
    }
    const drafts = options.draftsFor(job);
    const base = await drafts.get(job.workspaceId, job.materialId);
    if (base === undefined || base.application_id !== job.applicationId) {
      return { outcome: "missing", ...none };
    }
    if (!reviewableMaterial(base)) return { outcome: "skipped", ...none };
    const service = options.serviceFor(job);
    const root = options.workspaceRoot(job);
    const workspace = await service.readWorkspace(root);
    const author = { company: base.model.provider, model: base.model.model };
    if (
      !options.allowProviderData ||
      workspace.fixtureMode ||
      workspace.critic.company === author.company
    ) {
      return { outcome: "unavailable", ...none };
    }
    const application = await service.getApplication({ root, applicationId: job.applicationId });
    if (application === undefined) return { outcome: "missing", ...none };
    const settings = options.settingsFor?.(job) ?? {};
    const input = await applicationMaterialRecordInput({
      service,
      root,
      briefId: application.briefs.at(-1)?.briefId,
      writingSamples: settings.writingSamples,
      factUsage: settings.factUsage,
    });
    const ports = options.portsFor(job, {
      author,
      critic: workspace.critic,
      applicationId: job.applicationId,
      allowProviderData: true,
    });
    const result = await reviewSavedApplicationMaterial({
      drafts,
      workspaceId: job.workspaceId,
      applicationId: job.applicationId,
      materialId: job.materialId,
      input,
      language: application.language ?? workspace.language,
      critic: ports.critic,
      author: ports.author,
      newId: options.newId,
      now: options.now ?? (() => new Date()),
      spentUsd: ports.spentUsd,
    });
    const outcome: MaterialReviewOutcome = result.outcome;
    return {
      outcome,
      findings: result.findings,
      costUsd: ports.spentUsd(),
      ...(result.record === undefined ? {} : { revisionId: result.record.id }),
    };
  };
  return async (job) => {
    const { outcome, ...detail } = await review(job);
    options.onOutcome?.(job, outcome, detail);
    return outcome;
  };
}
