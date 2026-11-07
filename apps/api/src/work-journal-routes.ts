import type {
  ApplicationService,
  HostedKnowledgeIntake,
  HostedSensitivityRules,
} from "@draft-loop/application";
import type { WorkJournalService } from "@draft-loop/application/work-journal";
import { createWorkJournalPublisher } from "@draft-loop/application/work-journal-source";
import {
  workJournalApprovalSchema,
  workJournalNoteContentSchema,
  workJournalNoteIdSchema,
  workJournalNoteInputSchema,
  workJournalNoteListItemSchema,
  workJournalNoteStatuses,
  workJournalStoredNoteSchema,
} from "@draft-loop/schemas/work-journal";
import type { SourceEvidenceKindStoragePort } from "@draft-loop/storage";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { ContentScreeningHooks } from "./content-screening-routes.js";
import { apiErrorSchema } from "./errors.js";
import type { IdempotencyStore } from "./idempotency.js";

export interface WorkJournalRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly journal: WorkJournalService;
  readonly idempotency: IdempotencyStore;
  /** Where approval writes a note (#2022); without all three, approve answers 503. */
  readonly knowledge?: {
    readonly intake: HostedKnowledgeIntake;
    readonly rules: HostedSensitivityRules;
    readonly evidenceKinds: SourceEvidenceKinds;
  };
  /** Screens the approved note's source like an upload. */
  readonly screening?: Pick<ContentScreeningHooks, "screenUpload">;
  /** Whether this server issues agent tokens, which the screen's setup steps need (#2427). */
  readonly agentTokens?: boolean;
}

/** The tenant's evidence-kind overrides, through which approval marks a note's source. */
export type SourceEvidenceKinds = Pick<
  SourceEvidenceKindStoragePort,
  "appendCandidateKnowledgeSourceEvidenceKindOverride"
>;

const workspaceParams = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

const noteParams = workspaceParams.extend({ noteId: workJournalNoteIdSchema });

const idempotencyHeaders = z.object({
  "idempotency-key": z
    .string()
    .regex(/^[A-Za-z0-9._:-]{8,128}$/u, "must be 8 to 128 safe characters")
    .optional(),
});

const recordResultSchema = z
  .object({
    note_id: z.string().optional(),
    status: z.enum(["pending", "amended", "duplicate", "previously_discarded", "validated"]),
    duplicate_of: z.string().optional(),
    possible_duplicate_of: z.array(z.string()),
    screening: z.enum(["clear", "flagged", "unscreened"]).optional(),
    review_url: z.string().optional().describe("Where the candidate reviews the note."),
    message: z.string(),
  })
  .meta({ id: "WorkJournalRecordResult" });

const listQuery = z.strictObject({
  status: z.enum(workJournalNoteStatuses).optional(),
  project: z.string().trim().min(1).max(120).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  agent_token_id: z
    .string()
    .regex(/^dlat_[A-Za-z0-9_-]{8,64}$/u)
    .optional()
    .describe("Only the notes this agent token filed or amended, such as after revoking it."),
  fields: z
    .enum(["titles", "summary"])
    .optional()
    .describe(
      "titles (default) for agents; summary returns whole notes for the candidate's review.",
    ),
});

const listResultSchema = z
  .object({
    notes: z.array(workJournalNoteListItemSchema).optional(),
    full: z.array(workJournalStoredNoteSchema).optional(),
  })
  .meta({ id: "WorkJournalNoteList" });

const reviewBody = z
  .discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("approve"),
      knowledge_base_id: z.string().trim().min(1).max(200),
      tier: workJournalApprovalSchema.shape.tier.optional(),
    }),
    z.strictObject({ action: z.literal("edit"), content: workJournalNoteContentSchema }),
    z.strictObject({
      action: z.literal("merge"),
      into: workJournalNoteIdSchema,
      keep_summary: z.enum(["into", "this"]).optional(),
    }),
    z.strictObject({ action: z.literal("discard") }),
  ])
  .meta({ id: "WorkJournalReview" });

const intakeSchema = z
  .object({
    enabled: z.boolean(),
    changed_at: z.string().optional(),
    agent_tokens: z
      .boolean()
      .describe(
        "Whether this server issues agent tokens, so the screen can offer a coding agent's setup.",
      ),
  })
  .meta({ id: "WorkJournalIntake" });

const intakeBody = z.strictObject({ enabled: z.boolean() });

const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  422: apiErrorSchema,
  429: apiErrorSchema,
  503: apiErrorSchema,
} as const;

/**
 * The work journal (ADR 0011 D17, #2018): an agent records notes through the MCP server, and the
 * candidate reviews them. Bodies and answers carry the note only where the caller sent it or the
 * candidate reviews it; logs carry ids, statuses and counts.
 */
export function registerWorkJournalRoutes(
  parent: FastifyInstance,
  options: WorkJournalRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, journal, idempotency, knowledge, screening } = options;
  const publisherFor = (request: FastifyRequest) =>
    knowledge === undefined
      ? undefined
      : createWorkJournalPublisher({
          intake: knowledge.intake,
          rules: knowledge.rules,
          setEvidenceKind: async (knowledgeBaseId, sourceId, kind) => {
            await knowledge.evidenceKinds.appendCandidateKnowledgeSourceEvidenceKindOverride(
              knowledgeBaseId,
              sourceId,
              { kind, createdAt: new Date().toISOString() },
            );
          },
          ...(screening === undefined
            ? {}
            : {
                screen: async (added, bytes) => {
                  await screening.screenUpload(request, {
                    knowledgeBaseId: added.source.knowledgeBaseId,
                    sourceId: added.source.id,
                    sourceVersionId: added.latestVersion.id,
                    name: added.source.displayName,
                    mediaType: added.latestVersion.mediaType,
                    bytes,
                  });
                },
              }),
        });
  const requireWorkspace = async (workspaceId: string) => {
    await service.readWorkspace(workspaceRoot(workspaceId));
  };

  app.post(
    "/v1/workspaces/:workspaceId/work-journal/notes",
    {
      // The body is checked by the journal itself, so a refusal is one content-free code.
      attachValidation: true,
      schema: {
        summary: "Record a note about notable work, pending the candidate's review",
        description:
          "What the MCP tool record_work sends. The note waits in the candidate's Work journal inbox; nothing becomes career evidence until they approve it. Refusals are content-free codes: invalid_note, secret_like_content, link_not_https, metric_without_how_measured, amend_not_pending, not_consented (403) and rate_limited (429). A repeat answers duplicate with the earlier note, and work the candidate discarded answers previously_discarded. dry_run validates without storing.",
        params: workspaceParams,
        headers: idempotencyHeaders,
        body: workJournalNoteInputSchema,
        response: { 200: recordResultSchema, 201: recordResultSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      await requireWorkspace(workspaceId);
      const key = request.headers["idempotency-key"];
      const agentTokenId = request.agentToken?.id;
      const produce = () => journal.record(workspaceId, request.body, { agentTokenId });
      const result =
        key === undefined
          ? await produce()
          : await idempotency.once(`work-journal:${workspaceId}`, key, request.body, produce);
      request.log.info(
        {
          workspaceId,
          noteId: result.note_id,
          status: result.status,
          screening: result.screening,
          agentTokenId,
        },
        "work journal note recorded",
      );
      return reply.code(result.status === "pending" ? 201 : 200).send({
        ...result,
        possible_duplicate_of: [...result.possible_duplicate_of],
        ...(result.note_id === undefined ? {} : { review_url: "/#work-journal" }),
      });
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/work-journal/notes",
    {
      schema: {
        summary: "List work journal notes",
        description:
          "The default view lists titles, dates, technologies and status only, which is what list_work returns to an agent. fields=summary returns whole notes for the candidate's review on the web and the CLI.",
        params: workspaceParams,
        querystring: listQuery,
        response: { 200: listResultSchema, ...errors },
      },
    },
    async (request) => {
      const { workspaceId } = request.params;
      await requireWorkspace(workspaceId);
      const { fields, agent_token_id: agentTokenId, ...rest } = request.query;
      const listOptions = { ...rest, ...(agentTokenId === undefined ? {} : { agentTokenId }) };
      if (fields === "summary") return { full: await journal.listFull(workspaceId, listOptions) };
      return { notes: await journal.list(workspaceId, listOptions) };
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/work-journal/notes/:noteId",
    {
      schema: {
        summary: "Read one work journal note for review",
        params: noteParams,
        response: { 200: workJournalStoredNoteSchema, ...errors },
      },
    },
    async (request) => {
      const { workspaceId, noteId } = request.params;
      await requireWorkspace(workspaceId);
      return journal.get(workspaceId, noteId);
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/work-journal/notes/:noteId/review",
    {
      schema: {
        summary: "Approve, edit, merge or discard a pending note",
        description:
          "approve writes the note into the knowledge base as a work-journal source with the tier confirmed (sensitive by default unless the project is public); a note held by screening (note_quarantined) cannot be approved. edit replaces the content and screens it again. merge folds this note into another pending note. discard keeps only the note's key once 30 days pass.",
        params: noteParams,
        body: reviewBody,
        response: { 200: workJournalStoredNoteSchema, ...errors },
      },
    },
    async (request) => {
      const { workspaceId, noteId } = request.params;
      await requireWorkspace(workspaceId);
      const publish = publisherFor(request);
      const note = await journal.review(
        workspaceId,
        noteId,
        request.body,
        publish === undefined ? undefined : { publish },
      );
      request.log.info(
        { workspaceId, noteId, action: request.body.action, status: note.status },
        "work journal note reviewed",
      );
      return note;
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/work-journal/intake",
    {
      schema: {
        summary: 'Read the "Accept notes from coding agents" switch',
        params: workspaceParams,
        response: { 200: intakeSchema, ...errors },
      },
    },
    async (request) => {
      const { workspaceId } = request.params;
      await requireWorkspace(workspaceId);
      const intake = await journal.intake(workspaceId);
      return {
        enabled: intake.enabled,
        ...(intake.changedAt === undefined ? {} : { changed_at: intake.changedAt }),
        agent_tokens: options.agentTokens === true,
      };
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/work-journal/intake",
    {
      schema: {
        summary: 'Turn "Accept notes from coding agents" on or off',
        description:
          "Intake is off until the candidate turns it on. Turning it off refuses new notes and deletes the pending ones.",
        params: workspaceParams,
        body: intakeBody,
        response: { 200: intakeSchema, ...errors },
      },
    },
    async (request) => {
      const { workspaceId } = request.params;
      await requireWorkspace(workspaceId);
      const intake = await journal.setIntake(workspaceId, request.body.enabled);
      request.log.info({ workspaceId, enabled: intake.enabled }, "work journal intake changed");
      return {
        enabled: intake.enabled,
        ...(intake.changedAt === undefined ? {} : { changed_at: intake.changedAt }),
        agent_tokens: options.agentTokens === true,
      };
    },
  );
}
