import type { ApplicationService, ApplicationView } from "@draft-loop/application";

import type { ApplicationSummaryView } from "../application-contract.js";
import type { WorkspaceReadiness } from "../model.js";

/**
 * Host-side projection of job applications (ADR 0010).
 *
 * Nothing here returns a stored job path, URL or text: the renderer learns the kind of job source
 * and counts, and opens an application by id.
 */

function newestRunId(view: ApplicationView): string | null {
  let newest: ApplicationView["runs"][number] | undefined;
  for (const run of view.runs) {
    if (newest === undefined || Date.parse(run.startedAt) >= Date.parse(newest.startedAt)) {
      newest = run;
    }
  }
  return newest?.id ?? null;
}

export function projectApplication(view: ApplicationView): ApplicationSummaryView {
  return {
    id: view.id,
    name: view.name,
    jobSourceKind: view.jobSource.kind,
    status: view.status,
    isDefault: view.isDefault,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    runCount: view.runs.length,
    briefCount: view.briefs.length,
    exportCount: view.exports.length,
    latestRunId: newestRunId(view),
  };
}

export async function listApplicationSummaries(
  service: ApplicationService,
  root: string,
): Promise<readonly ApplicationSummaryView[]> {
  return (await service.listApplications({ root })).map(projectApplication);
}

export async function createApplicationSummary(
  service: ApplicationService,
  root: string,
  name: string,
  jobText: string,
): Promise<ApplicationSummaryView> {
  const created = await service.createApplication({
    root,
    name,
    jobSource: { kind: "pasted-text", text: jobText },
  });
  return projectApplication(created);
}

/** An application a request is scoped to, with the run the review should open on. */
export interface ApplicationScope {
  readonly application: ApplicationView;
  /** The application's newest run; undefined before its first run. */
  readonly latestRunId: string | undefined;
  /** False for the default application, which reads the workspace's own job and brief. */
  readonly created: boolean;
}

/**
 * Resolves a scoped request: `undefined` when the request names no application, `null` when the
 * named application does not exist.
 */
export async function resolveApplicationScope(
  service: ApplicationService,
  root: string,
  applicationId: string | undefined,
): Promise<ApplicationScope | null | undefined> {
  if (applicationId === undefined) return undefined;
  const application = await service.getApplication({ root, applicationId });
  if (application === undefined) return null;
  return {
    application,
    latestRunId: newestRunId(application) ?? undefined,
    created: !application.isDefault,
  };
}

const jobStepPatterns = [/job description/iu, /role content/iu];

/**
 * Readiness for an application other than the default one. The workspace-level readiness reads
 * the workspace's own job file and reviewed brief, which belong to the default application, so a
 * created application is ready on its stored job text and starts from it, not from that brief.
 */
export function scopeSetupToApplication(
  setup: WorkspaceReadiness,
  application: ApplicationView,
): WorkspaceReadiness {
  const jobReady = application.jobSource.kind !== "approved-url";
  const nextSteps = setup.nextSteps.filter(
    (step) =>
      step !== setup.jobRequirementProblem &&
      !jobStepPatterns.some((pattern) => pattern.test(step)),
  );
  if (!jobReady) {
    nextSteps.unshift(
      "Create and review an opportunity brief for this application's job posting before starting.",
    );
  }
  const retrievalStatus =
    setup.retrievalStatus === "no-query" ? "not-indexed" : setup.retrievalStatus;
  return {
    ...setup,
    jobDescriptionReady: jobReady,
    reviewedOpportunity: null,
    pendingWritingPolicyOverride: null,
    jobRequirementProblem: null,
    retrievalStatus,
    nextSteps,
    ready:
      jobReady &&
      setup.evidenceSourceCount > 0 &&
      setup.writingPolicyStatus !== "unavailable" &&
      retrievalStatus !== "unavailable",
  };
}
