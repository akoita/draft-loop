import { createHash } from "node:crypto";

import type {
  ApplicationService,
  ApplicationView,
  HostedKnowledgeIntake,
  RunWritingPolicyProjection as RecordedRunWritingPolicy,
  RunReview,
  WorkspaceDescriptor,
  WritingPolicyVersionView,
} from "@draft-loop/application";
import { defaultModelProfileRegistry } from "@draft-loop/application/model-profiles";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import {
  emptyReviewState,
  executingRunStates,
  independentReviewView,
  type ReviewDecisions,
  reviewState,
} from "@draft-loop/review-state";
import { createApplicationRunRowsReader } from "@draft-loop/review-state/application-runs";
import { withCoverageKinds } from "@draft-loop/review-state/review-coverage";
import { workspaceReadinessFrom } from "@draft-loop/review-state/workspace-readiness";
import { applicationIdSchema } from "@draft-loop/schemas/application";
import { newestApplicationRunId } from "@draft-loop/ui/application-run-order";
import { exportFileName } from "@draft-loop/ui/export-file-name";
import type {
  DesktopReviewState,
  OpportunityBriefSelection,
  ProviderTransmissionPolicy,
  ProviderTransmissionPreflight,
  RunWritingPolicyProjection,
  WorkspaceReadiness,
  WritingPolicyVersionMetadata,
} from "@draft-loop/ui/model";
import { type RunAuthorInputView, runAuthorInputView } from "@draft-loop/ui/run-author-input";
import {
  normalizeRunEvidenceMode,
  type RunEvidenceModeView,
} from "@draft-loop/ui/run-evidence-mode";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import { runApplicationName } from "./export-routes.js";

export interface ReviewStateRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  /** The tenant's knowledge intake, which counts the selected bases' sources; none counts zero. */
  readonly knowledgeIntake?: HostedKnowledgeIntake;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const workspaceParams = z.strictObject({ workspaceId: identifierSchema });
const reviewStateQuery = z.strictObject({
  applicationId: applicationIdSchema
    .optional()
    .describe("The job application to show; its newest run when no run is named."),
  runId: identifierSchema
    .optional()
    .describe("The run to show; the workspace's or the application's newest when absent."),
});

/**
 * The shared screens' review state. Its fields are the desktop's `DesktopReviewState`, which the
 * web's bridge validates field by field, so the document is only checked here for its identity.
 */
const reviewStateSchema = z
  .looseObject({
    workspaceId: z.string(),
    runId: z.string().describe("`pending` before the first run."),
    state: z.string(),
  })
  .meta({ id: "ReviewState" });

/** What a hosted run sends, as the desktop's preflight names it; the full corpus never leaves. */
const transmissionScope = [
  "job description and requirements",
  "candidate source manifest",
  "selected candidate-source excerpts",
  "candidate-approved writing policy when configured",
  "current draft and structured findings",
] as const;

/** Where the model gateway sends each company's calls (ADR 0011, D7). */
function hostedEndpoint(company: string, fixtureMode: boolean): string {
  if (fixtureMode) return "scripted fixture (no provider call)";
  if (company === "anthropic") return "Claude on Vertex AI, EU location";
  if (company === "openai") return "OpenAI EU endpoint";
  return "not served by the hosted service";
}

/**
 * The hosted preflight. Live runs need it, and it reads as acknowledged: the server itself
 * refuses a provider call without the candidate's recorded consent, so the screen asks nothing
 * more. Providers are held to zero retention, so the request is ephemeral.
 */
function hostedPreflight(descriptor: WorkspaceDescriptor): ProviderTransmissionPreflight {
  const identity = ({ company, model }: WorkspaceDescriptor["author"]) => ({
    company,
    model,
    endpoint: hostedEndpoint(company, descriptor.fixtureMode),
  });
  const policy: ProviderTransmissionPolicy = {
    dataClass: descriptor.fixtureMode
      ? "synthetic-demo-material"
      : "candidate-application-material",
    transmissionScope,
    excludedScope: ["complete candidate corpus"],
    author: identity(descriptor.author),
    critic: identity(descriptor.critic),
    retentionPreference: descriptor.fixtureMode ? "not-allowed" : "ephemeral-request",
    budget: {
      maxRounds: descriptor.maxRounds,
      maxCostUsd: descriptor.maxCostUsd ?? null,
      maxDurationMs: descriptor.maxDurationMs ?? null,
    },
  };
  return {
    ...policy,
    required: !descriptor.fixtureMode,
    fingerprint: createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
    acknowledged: true,
    acknowledgedAt: null,
  };
}

/** The workspace with the application's own model pair, when it has one, as its runs use. */
function pairDescriptor(
  descriptor: WorkspaceDescriptor,
  application: ApplicationView | undefined,
): WorkspaceDescriptor {
  const pair = application?.modelProfiles;
  if (pair === null || pair === undefined) return descriptor;
  const author = defaultModelProfileRegistry.resolve(pair.author.id, pair.author.version, "author");
  const critic = defaultModelProfileRegistry.resolve(pair.critic.id, pair.critic.version, "critic");
  return {
    ...descriptor,
    author: { company: author.provider, model: author.modelId },
    critic: { company: critic.provider, model: critic.modelId },
  };
}

/** The projection as the response schema types it: its own fields, any number of them. */
const reviewStateView = (state: DesktopReviewState): z.infer<typeof reviewStateSchema> => ({
  ...state,
});

const policyMetadata = (view: WritingPolicyVersionView): WritingPolicyVersionMetadata => ({
  checksum: view.checksum,
  version: view.version,
  schemaVersion: view.schemaVersion,
  createdAt: view.createdAt,
  priorChecksum: view.priorChecksum,
});

/** The policy a run recorded, as metadata only: identities and lineage, never its content. */
const runPolicyView = (recorded: RecordedRunWritingPolicy): RunWritingPolicyProjection => ({
  effective: policyMetadata(recorded.effective),
  lineage:
    recorded.lineage.kind === "workspace"
      ? { kind: "workspace" }
      : {
          kind: "opportunity-override",
          base: {
            version: recorded.lineage.base.version,
            checksum: recorded.lineage.base.checksum,
          },
          override: {
            version: recorded.lineage.override.version,
            checksum: recorded.lineage.override.checksum,
          },
        },
  ...(recorded.base === undefined ? {} : { base: policyMetadata(recorded.base) }),
  ...(recorded.override === undefined ? {} : { override: policyMetadata(recorded.override) }),
});

/** The application's newest brief, when its latest version is reviewed. */
function reviewedBrief(application: ApplicationView | undefined): OpportunityBriefSelection | null {
  const newest = [...(application?.briefs ?? [])].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0];
  if (newest?.status !== "reviewed") return null;
  return { briefId: newest.briefId, version: newest.latestVersion };
}

/** The person's decisions and edits as the run recorded them; the hosted run keeps no rationale. */
function recordedDecisions(review: RunReview | undefined, workspaceName: string): ReviewDecisions {
  const decisions: Record<string, ReviewDecisions["decisions"][string]> = {};
  const edits: Record<string, string> = {};
  for (const finding of review?.findings ?? []) decisions[finding.id] = finding.decision;
  for (const section of review?.draft?.sections ?? []) {
    for (const block of section.blocks) if (block.edited) edits[block.id] = block.text;
  }
  return { decisions, rationales: {}, edits, history: [], workspaceName };
}

/**
 * The review state the shared screens open on, projected on the server from the same run the
 * desktop host projects (ADR 0011, D9): the run, its decisions and edits, and whether the
 * workspace can start another.
 */
export function registerReviewStateRoutes(
  parent: FastifyInstance,
  options: ReviewStateRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, knowledgeIntake } = options;

  const applicationRunRows = createApplicationRunRowsReader(service);

  /** What the run recorded about its evidence and its latest author step, for the run details. */
  const runDetails = async (
    root: string,
    runId: string,
    requirementTexts: ReadonlyMap<string, string>,
  ): Promise<{
    readonly evidenceMode: RunEvidenceModeView | null;
    readonly authorInput: RunAuthorInputView | null;
    readonly writingPolicy: RunWritingPolicyProjection | undefined;
  }> => {
    const mode = await service.readRunEvidenceMode?.({ root, runId });
    const input = await service.readRunAuthorInput?.({ root, runId });
    // The policy the run used, so its details never read "no policy" when one applied (#1968).
    const policy = await service.readRunWritingPolicy?.({ root, runId });
    return {
      writingPolicy: policy === undefined ? undefined : runPolicyView(policy),
      evidenceMode: mode === undefined ? null : (normalizeRunEvidenceMode(mode) ?? null),
      authorInput:
        input === undefined ? null : (runAuthorInputView(input, requirementTexts) ?? null),
    };
  };

  /**
   * A hosted export has no path on this machine: the screen names the newest one's downloaded
   * file instead, so an exported run never reads as a file not found.
   */
  const newestExportName = async (root: string, runId: string): Promise<string | null> => {
    const exports = (await service.listRunExports?.({ root, runId })) ?? [];
    const newest = [...exports].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )[0];
    if (newest === undefined) return null;
    return exportFileName({
      ...newest,
      applicationName: await runApplicationName(service, root, runId),
    });
  };

  /** The selected knowledge bases' sources, the evidence a hosted run reads. */
  const evidenceSourceCount = async (descriptor: WorkspaceDescriptor): Promise<number> => {
    if (knowledgeIntake === undefined) return 0;
    let count = 0;
    for (const { knowledgeBaseId } of descriptor.candidateKnowledgeSelection ?? []) {
      count += (await knowledgeIntake.listSources(knowledgeBaseId)).length;
    }
    return count;
  };

  const readiness = async (
    root: string,
    descriptor: WorkspaceDescriptor,
    application: ApplicationView | undefined,
  ): Promise<WorkspaceReadiness> => {
    const source = application?.jobSource;
    const jobDescription = source?.kind === "stored-text" ? source.text.trim() : "";
    const reviewedOpportunity = reviewedBrief(application);
    const active = await service.getWritingPolicy?.({ root, includeContent: false });
    const history = await service.listWritingPolicyVersions?.({ root, includeContent: false });
    return workspaceReadinessFrom({
      descriptor,
      jobDescription,
      jobDescriptionReady: jobDescription.length > 0,
      briefSuppliesJob: source?.kind === "approved-url" && reviewedOpportunity !== null,
      evidenceSourceCount: await evidenceSourceCount(descriptor),
      // A hosted run reads only its selected knowledge bases; there is no evidence folder.
      knowledgeSelected: true,
      writingPolicy: active === undefined ? undefined : policyMetadata(active),
      writingPolicyHistory: (history ?? []).map(policyMetadata),
      writingPolicyStatus: active === undefined ? "none" : "active",
      // Retrieval indexes the selected sources when a run starts, never ahead of it.
      retrieval: {
        status: "not-indexed",
        indexedEvidenceChunkCount: 0,
        selectedEvidenceChunkCount: 0,
        selectedEvidenceSourceCount: 0,
      },
      reviewedOpportunity: reviewedOpportunity ?? undefined,
      pendingWritingPolicyOverride: undefined,
      missingJobStep:
        source?.kind === "approved-url"
          ? "Extract and review requirements from this application's job posting before starting."
          : "Add a target job description.",
    });
  };

  app.get(
    "/v1/workspaces/:workspaceId/review-state",
    {
      schema: {
        summary: "Read the review state the shared screens open on",
        description:
          "The run on screen with its draft, findings, decisions and edits, the workspace's readiness for the next run, and what a live run sends to which provider. Without a run it is the workspace's start state, with `runId` `pending`.",
        params: workspaceParams,
        querystring: reviewStateQuery,
        response: { 200: reviewStateSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const { applicationId, runId } = request.query;
      const root = workspaceRoot(workspaceId);
      const workspace = await service.readWorkspace(root);
      const scope =
        applicationId === undefined
          ? undefined
          : await service.getApplication?.({ root, applicationId });
      if (applicationId !== undefined && scope === undefined) {
        return reply.code(404).send(apiError("not_found", "No such application."));
      }
      if (scope !== undefined && runId !== undefined && !scope.runs.some((r) => r.id === runId)) {
        return reply
          .code(404)
          .send(apiError("not_found", "That run does not belong to this application."));
      }
      // Without an application, the job is the default application's: it is always listed first.
      const jobApplication = scope ?? (await service.listApplications?.({ root }))?.[0];
      // The screens address the workspace by the id in the path, never the driver's own.
      const descriptor = { ...pairDescriptor(workspace, scope), id: workspaceId };
      const setup = await readiness(root, descriptor, jobApplication);
      const preflight = hostedPreflight(descriptor);
      const shownRunId =
        runId ?? (scope === undefined ? undefined : newestApplicationRunId(scope.runs));
      const snapshot: RunSnapshot | undefined =
        shownRunId === null
          ? undefined
          : await service.status({
              root,
              ...(shownRunId === undefined ? {} : { runId: shownRunId }),
            });
      if (snapshot === undefined) {
        if (runId !== undefined) return reply.code(404).send(apiError("not_found", "No such run."));
        const decisions = recordedDecisions(undefined, workspaceId);
        return reviewStateView(emptyReviewState(descriptor, setup, preflight, decisions));
      }
      const review = await service.readRunReview?.({ root, runId: snapshot.runId });
      const requirements = await service.readRunRequirements?.({ root, runId: snapshot.runId });
      const requirementTexts = new Map((requirements ?? []).map(({ id, text }) => [id, text]));
      const details = await runDetails(root, snapshot.runId, requirementTexts);
      return reviewStateView(
        withCoverageKinds(
          reviewState(
            descriptor,
            snapshot,
            independentReviewView(review?.independentReview ?? undefined),
            recordedDecisions(review, workspaceId),
            await newestExportName(root, snapshot.runId),
            setup,
            preflight,
            // The worker retries a failed step itself (#1763), so the screen never offers it.
            { running: executingRunStates.has(snapshot.state), retriedByHost: true },
            details.writingPolicy,
            requirementTexts,
            details.evidenceMode,
            details.authorInput,
            // The application's runs for the run list and the comparison, as the desktop lists them.
            scope === undefined
              ? null
              : await applicationRunRows(
                  root,
                  scope,
                  newestApplicationRunId(scope.runs) ?? undefined,
                ),
          ),
          requirements,
        ),
      );
    },
  );
}
