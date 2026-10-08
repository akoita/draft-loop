import type { ApplicationService, ApplicationView } from "@draft-loop/application";

import type { ApplicationSummaryView } from "../application-contract.js";

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
  job: { readonly jobText: string } | { readonly jobUrl: string },
): Promise<ApplicationSummaryView> {
  const created = await service.createApplication({
    root,
    name,
    // The URL is stored with the person's approval to fetch it; nothing is fetched here.
    jobSource:
      "jobUrl" in job
        ? { kind: "approved-url", url: job.jobUrl, approved: true }
        : { kind: "pasted-text", text: job.jobText },
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

/** Where a created application's readiness reads its job from. */
export interface ApplicationReadinessScope {
  /** The stored job document (relative to the workspace or absolute); undefined for a URL job. */
  readonly jobDescriptionPath: string | undefined;
  /** True when the job is a URL: only an extracted and reviewed brief supplies its text. */
  readonly jobFromUrl: boolean;
}

export const urlJobBriefStep =
  "Extract and review requirements from this application's job posting before starting.";

/**
 * Readiness of a created application is computed from its own job and its own reviewed brief, not
 * the workspace's `job.md` and brief, which belong to the default application.
 */
export function applicationReadinessScope(application: ApplicationView): ApplicationReadinessScope {
  const source = application.jobSource;
  return {
    jobDescriptionPath:
      source.kind === "pasted-text"
        ? source.storedPath
        : source.kind === "local-file"
          ? source.path
          : undefined,
    jobFromUrl: source.kind === "approved-url",
  };
}

/**
 * The approved URL a created application's job points at, for the host only: it is handed to the
 * extraction as an approved-url source and never crosses the bridge.
 */
export function applicationJobUrl(application: ApplicationView): string | undefined {
  const source = application.jobSource;
  return source.kind === "approved-url" && source.approved ? source.url : undefined;
}
