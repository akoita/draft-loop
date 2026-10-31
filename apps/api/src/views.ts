import {
  type ApplicationView,
  runStepRoutes,
  type WorkspaceDescriptor,
} from "@draft-loop/application";
import { choosableModelProfileEfforts } from "@draft-loop/application/model-profile-catalog";
import { type RunSnapshot, runFailureStages } from "@draft-loop/orchestrator";
import { opportunityBriefSchema } from "@draft-loop/schemas";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";
import { z } from "zod";

import { opportunityScreeningSchema } from "./content-screening-views.js";
import { failedCallView, failedCallViewSchema } from "./failed-call-view.js";

/**
 * What the API returns: bounded projections of the application service's records. They leave out
 * driver references and file paths, and keep only what a client needs to show and act.
 */

const modelSchema = z.object({ company: z.string(), model: z.string() });

export const workspaceViewSchema = z
  .object({
    id: z.string(),
    language: z.string(),
    requiredSections: z.array(z.string()),
    maxRounds: z.number().int(),
    maxCostUsd: z
      .number()
      .optional()
      .describe("The run cost limit in US dollars; absent when the deployment's ceiling applies."),
    maxDurationMs: z
      .number()
      .int()
      .optional()
      .describe("The run duration limit; absent when the deployment's ceiling applies."),
    author: modelSchema,
    critic: modelSchema,
    fixtureMode: z.boolean(),
    autopilot: z
      .boolean()
      .describe(
        "Whether a run keeps revising through blocking findings up to its round limit; on for a new workspace.",
      ),
    knowledgeBaseIds: z
      .array(z.string())
      .describe("The knowledge bases the workspace's runs use; empty until one is selected."),
  })
  .meta({ id: "Workspace" });

/** A workspace by the id in its path: the driver's own id is a reference clients never send. */
export function workspaceView(
  workspaceId: string,
  descriptor: WorkspaceDescriptor,
): z.infer<typeof workspaceViewSchema> {
  return {
    id: workspaceId,
    language: descriptor.language,
    requiredSections: [...descriptor.requiredSections],
    maxRounds: descriptor.maxRounds,
    ...(descriptor.maxCostUsd === undefined ? {} : { maxCostUsd: descriptor.maxCostUsd }),
    ...(descriptor.maxDurationMs === undefined ? {} : { maxDurationMs: descriptor.maxDurationMs }),
    author: { company: descriptor.author.company, model: descriptor.author.model },
    critic: { company: descriptor.critic.company, model: descriptor.critic.model },
    fixtureMode: descriptor.fixtureMode,
    autopilot: descriptor.autopilot === true,
    knowledgeBaseIds: (descriptor.candidateKnowledgeSelection ?? []).map(
      ({ knowledgeBaseId }) => knowledgeBaseId,
    ),
  };
}

export const opportunityViewSchema = z
  .object({
    workspaceId: z.string(),
    checksum: z.string(),
    brief: opportunityBriefSchema,
    screening: opportunityScreeningSchema
      .optional()
      .describe("Injection screening of the brief's sources; present when it is created."),
    extraction: z
      .enum(["pending", "failed"])
      .optional()
      .describe(
        "The worker's extraction of this version: pending while it waits or runs, failed after its retries. Absent when none is outstanding; a finished extraction is the next version.",
      ),
  })
  .meta({ id: "Opportunity" });

export function opportunityView(
  record: OpportunityBriefVersionRecord,
): z.infer<typeof opportunityViewSchema> {
  return { workspaceId: record.workspaceId, checksum: record.checksum, brief: record.brief };
}

const profileReferenceViewSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  effort: z
    .enum(choosableModelProfileEfforts)
    .optional()
    .describe("The chosen reasoning level; absent uses the profile's own level."),
});

export const applicationViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    nameChosen: z.boolean(),
    status: z.string(),
    isDefault: z.boolean(),
    jobMissing: z
      .boolean()
      .describe("True for the original application while its workspace has no job text."),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    briefs: z.array(
      z.object({
        briefId: z.string(),
        latestVersion: z.number().int(),
        status: z.string(),
        createdAt: z.string(),
      }),
    ),
    runs: z.array(
      z.object({ id: z.string(), state: z.string(), startedAt: z.string(), updatedAt: z.string() }),
    ),
    chosenRunId: z.string().nullable(),
    jobSourceKind: z
      .enum(["pasted-text", "approved-url", "local-file"])
      .describe("Where the job came from; a hosted application's pasted text is kept with it."),
    suggestedName: z
      .string()
      .nullable()
      .describe("A name read from the newest brief's role and employer, until one is chosen."),
    exportCount: z.number().int(),
    modelProfiles: z
      .object({
        author: profileReferenceViewSchema,
        critic: profileReferenceViewSchema,
      })
      .nullable()
      .describe("The application's own model pair; null uses the workspace's."),
  })
  .meta({ id: "Application" });

export function applicationView(view: ApplicationView): z.infer<typeof applicationViewSchema> {
  return {
    id: view.id,
    name: view.name,
    nameChosen: view.nameChosen,
    status: view.status,
    isDefault: view.isDefault,
    jobMissing: view.jobMissing === true,
    archivedAt: view.archivedAt,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    briefs: view.briefs.map(({ briefId, latestVersion, status, createdAt }) => ({
      briefId,
      latestVersion,
      status,
      createdAt,
    })),
    runs: view.runs.map(({ id, state, startedAt, updatedAt }) => ({
      id,
      state,
      startedAt,
      updatedAt,
    })),
    chosenRunId: view.chosenRun?.runId ?? null,
    jobSourceKind: view.jobSource.kind === "stored-text" ? "pasted-text" : view.jobSource.kind,
    suggestedName: view.suggestedName,
    exportCount: view.exports.length,
    modelProfiles: view.modelProfiles,
  };
}

export const runViewSchema = z
  .object({
    runId: z.string(),
    workspaceId: z.string(),
    state: z.string(),
    round: z.number().int(),
    currentStep: z.enum(["author", "critic", "revision"]).nullable(),
    approval: z.enum(["pending", "approved", "rejected"]),
    totalCostUsd: z.number(),
    routes: z
      .array(
        z.object({
          step: z.enum(["author", "critic", "revision"]),
          route: z.string(),
          fallback: z
            .object({ from: z.string(), cause: z.string() })
            .optional()
            .describe("Present when these calls fell back from their primary route."),
        }),
      )
      .describe("The endpoint behind each step's completed calls, in first-use order."),
    findingCount: z.number().int(),
    hasDraft: z.boolean(),
    startedAt: z.string(),
    updatedAt: z.string(),
    lastError: z
      .object({
        code: z.string(),
        retryable: z.boolean(),
        usageLimitResetsAt: z.string().nullable(),
        failedCall: failedCallViewSchema.optional(),
        failureStage: z
          .enum(runFailureStages)
          .nullable()
          .describe("Where a rejected output failed, such as artifact schema validation."),
        diagnostics: z
          .array(z.object({ code: z.string(), path: z.string() }))
          .describe("The first issues of a rejected output: codes and field paths, never values."),
        diagnosticCounts: z
          .array(z.object({ code: z.string(), count: z.number().int() }))
          .describe("How many issues of each code the whole rejection held."),
      })
      .nullable()
      .describe(
        "Content-free: the error's code and, for a rejected output, where and why it failed, never its provider message or values.",
      ),
  })
  .meta({ id: "Run" });

export function runView(snapshot: RunSnapshot): z.infer<typeof runViewSchema> {
  return {
    runId: snapshot.runId,
    workspaceId: snapshot.workspaceId,
    state: snapshot.state,
    round: snapshot.round,
    currentStep: snapshot.currentStep,
    approval: snapshot.approval,
    totalCostUsd: snapshot.totalCostUsd,
    routes: runStepRoutes(snapshot),
    findingCount: snapshot.findings.length,
    hasDraft: snapshot.artifact !== null,
    startedAt: snapshot.startedAt,
    updatedAt: snapshot.updatedAt,
    lastError:
      snapshot.lastError === null
        ? null
        : {
            code: snapshot.lastError.code,
            retryable: snapshot.lastError.retryable,
            usageLimitResetsAt: snapshot.lastError.usageLimitResetsAt ?? null,
            ...failedCallView(snapshot.lastError.failedCall),
            failureStage: snapshot.lastError.failureStage ?? null,
            diagnostics: (snapshot.lastError.diagnostics ?? []).map(({ code, path }) => ({
              code,
              path,
            })),
            diagnosticCounts: (snapshot.lastError.diagnosticCounts ?? []).map(
              ({ code, count }) => ({ code, count }),
            ),
          },
  };
}
