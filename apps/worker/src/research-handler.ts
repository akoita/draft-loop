import type { ApplicationService } from "@draft-loop/application";
import {
  type ResearchFindingsPort,
  type ResearchScreen,
  runResearch,
} from "@draft-loop/application/research-run";
import type { ResearchSearchPort } from "@draft-loop/application/research-search";
import type { ResearchJob, ResearchJobHandler, ResearchJobResult } from "@draft-loop/run-queue";
import type { ResearchBriefStore } from "@draft-loop/storage/research-briefs";

/** The providers one research run uses; scripted fakes in tests. */
export interface ResearchPorts {
  readonly search: ResearchSearchPort;
  readonly screen: ResearchScreen;
  readonly findings: ResearchFindingsPort;
  /** What the findings call has cost so far, from the host's cost guard. */
  readonly findingsSpentUsd: () => number;
}

export interface ResearchHandlerOptions {
  /** The application over the job's tenant: each job names its own (ADR 0011, D3). */
  readonly serviceFor: (
    job: ResearchJob,
  ) => Pick<ApplicationService, "readWorkspace" | "getApplication" | "getOpportunity">;
  /** The tenant's research briefs. */
  readonly briefsFor: (job: ResearchJob) => ResearchBriefStore;
  readonly workspaceRoot: (job: ResearchJob) => string;
  /** Whether material may go to the providers, from the deployment's consent policy. */
  readonly allowProviderData: boolean;
  /** In sign-in deployments, the record's current consent, checked as each job is claimed. */
  readonly consentFor?: (job: ResearchJob) => Promise<boolean>;
  /** Whether the job's candidate record is erased or being erased, checked before anything else. */
  readonly recordErased?: (job: ResearchJob) => Promise<boolean>;
  /** The run's providers; undefined when the deployment searches nothing or has no key. */
  readonly portsFor: (job: ResearchJob) => ResearchPorts | undefined;
  readonly newId: () => string;
  readonly now?: () => Date;
  /** Ids, counts, cost and the outcome's word only: never the sources or findings. */
  readonly onOutcome?: (
    job: ResearchJob,
    result: ResearchJobResult,
    detail: {
      readonly sources: number;
      readonly findings: number;
      readonly dropped: number;
      readonly costUsd: number;
    },
  ) => void;
}

const none = { sources: 0, findings: 0, dropped: 0, costUsd: 0 };

/**
 * Researches one application the candidate approved (#2560). The erasure and consent checks run
 * first, then the application's newest job brief names the employer and role; nothing about the
 * candidate is read. A deployment that searches nothing ends as `unavailable` without a call.
 */
export function createResearchHandler(options: ResearchHandlerOptions): ResearchJobHandler {
  const research = async (
    job: ResearchJob,
  ): Promise<{ result: ResearchJobResult; detail: typeof none }> => {
    const refused = (outcome: ResearchJobResult["outcome"]) => ({
      result: { outcome },
      detail: none,
    });
    if (options.recordErased !== undefined && (await options.recordErased(job))) {
      return refused("record-erased");
    }
    if (options.consentFor !== undefined && !(await options.consentFor(job))) {
      return refused("consent-required");
    }
    const service = options.serviceFor(job);
    const root = options.workspaceRoot(job);
    const application = await service.getApplication({ root, applicationId: job.applicationId });
    if (application === undefined) return refused("missing");
    const briefId = application.briefs.at(-1)?.briefId;
    const opportunity =
      briefId === undefined ? undefined : await service.getOpportunity({ root, briefId });
    const employer = opportunity?.brief.employer?.value?.trim() ?? "";
    if (employer === "") return refused("no-employer");
    const workspace = await service.readWorkspace(root);
    if (!options.allowProviderData || workspace.fixtureMode) return refused("unavailable");
    const ports = options.portsFor(job);
    if (ports === undefined) return refused("unavailable");
    let brief: Awaited<ReturnType<typeof runResearch>>;
    try {
      brief = await runResearch({
        workspaceId: job.workspaceId,
        applicationId: job.applicationId,
        subject: { employer, role: opportunity?.brief.role?.value ?? "" },
        language: application.language ?? workspace.language,
        ...(job.windowMonths === undefined ? {} : { windowMonths: job.windowMonths }),
        search: ports.search,
        screen: ports.screen,
        findings: ports.findings,
        findingsSpentUsd: ports.findingsSpentUsd,
        newId: options.newId,
        now: options.now ?? (() => new Date()),
      });
    } catch (error) {
      // A search provider with no key configured is a deployment state, not a failure to retry.
      if (hasCode(error, "no_key")) return refused("unavailable");
      throw error;
    }
    await options.briefsFor(job).insert(brief);
    return {
      result: { outcome: "researched", briefId: brief.id },
      detail: {
        sources: brief.sources.length,
        findings: brief.findings.length,
        dropped: brief.dropped.flagged + brief.dropped.outdated,
        costUsd: brief.cost_usd,
      },
    };
  };
  return async (job) => {
    const { result, detail } = await research(job);
    options.onOutcome?.(job, result, detail);
    return result;
  };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}
