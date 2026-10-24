import {
  type ApplicationService,
  listHostedKnowledgeSources,
  quarantinedRunMaterial,
} from "@draft-loop/application";
import type { RunJob } from "@draft-loop/run-queue";
import type { PostgresTenancy } from "@draft-loop/storage-postgres";

import type { QuarantinedRunInput } from "./run-job-handler.js";

export interface TenantQuarantineOptions {
  readonly tenancy: Pick<PostgresTenancy, "forTenant">;
  readonly serviceFor: (
    tenantId: string,
  ) => Pick<ApplicationService, "readWorkspace" | "getOpportunity" | "readRunInputs">;
  readonly workspaceRoot: (job: RunJob) => string;
}

/**
 * The job's run material that injection screening quarantined and nobody released (ADR 0011,
 * phase 2d), read from the job's tenant's stored results as each job is claimed. It asks what the
 * API's run gate asks, with the same shared check: every source of the run's brief, and the latest
 * version of each source in the knowledge bases the record's workspace selects. A run begun
 * without a brief has no job sources to check. The answer is content-free: kinds, result ids and
 * signal codes.
 */
export function tenantRunQuarantine(
  options: TenantQuarantineOptions,
): (job: RunJob) => Promise<readonly QuarantinedRunInput[]> {
  return async (job) => {
    const service = options.serviceFor(job.tenantId);
    if (service.readRunInputs === undefined) {
      throw new Error("Checking a run's quarantined material needs the run inputs call.");
    }
    const root = options.workspaceRoot(job);
    const inputs = await service.readRunInputs({ root, runId: job.runId });
    const brief =
      inputs?.brief == null
        ? undefined
        : await service.getOpportunity({
            root,
            briefId: inputs.brief.briefId,
            version: inputs.brief.version,
          });
    const workspace = await service.readWorkspace(root);
    const storage = options.tenancy.forTenant(job.tenantId);
    const quarantined = await quarantinedRunMaterial(
      {
        store: storage.contentScreening,
        listSources: (knowledgeBaseId) => listHostedKnowledgeSources(storage, knowledgeBaseId),
      },
      {
        brief,
        knowledgeBaseIds: (workspace.candidateKnowledgeSelection ?? []).map(
          (entry) => entry.knowledgeBaseId,
        ),
      },
    );
    return quarantined.map((status) => ({
      kind: status.subject.kind,
      resultId: status.id,
      signals: [...status.result.signals],
    }));
  };
}
