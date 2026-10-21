import {
  type ApplicationView,
  runStepRoutes,
  type WorkspaceDescriptor,
} from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import { opportunityBriefSchema } from "@draft-loop/schemas";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";
import { z } from "zod";

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
    author: modelSchema,
    critic: modelSchema,
    fixtureMode: z.boolean(),
  })
  .meta({ id: "Workspace" });

export function workspaceView(
  descriptor: WorkspaceDescriptor,
): z.infer<typeof workspaceViewSchema> {
  return {
    id: descriptor.id,
    language: descriptor.language,
    requiredSections: [...descriptor.requiredSections],
    maxRounds: descriptor.maxRounds,
    author: { company: descriptor.author.company, model: descriptor.author.model },
    critic: { company: descriptor.critic.company, model: descriptor.critic.model },
    fixtureMode: descriptor.fixtureMode,
  };
}

export const opportunityViewSchema = z
  .object({ workspaceId: z.string(), checksum: z.string(), brief: opportunityBriefSchema })
  .meta({ id: "Opportunity" });

export function opportunityView(
  record: OpportunityBriefVersionRecord,
): z.infer<typeof opportunityViewSchema> {
  return { workspaceId: record.workspaceId, checksum: record.checksum, brief: record.brief };
}

export const applicationViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    nameChosen: z.boolean(),
    status: z.string(),
    isDefault: z.boolean(),
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
  })
  .meta({ id: "Application" });

export function applicationView(view: ApplicationView): z.infer<typeof applicationViewSchema> {
  return {
    id: view.id,
    name: view.name,
    nameChosen: view.nameChosen,
    status: view.status,
    isDefault: view.isDefault,
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
      })
      .nullable()
      .describe("Content-free: the error's code, never its provider message."),
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
          },
  };
}
