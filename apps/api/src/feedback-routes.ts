import {
  type FeedbackContext,
  feedbackClientContextSchema,
  feedbackContextSchema,
  feedbackStatuses,
  feedbackTriageSchema,
} from "@draft-loop/schemas/feedback";
import {
  type FeedbackCategory,
  type FeedbackNote,
  type FeedbackStore,
  feedbackCategories,
  maximumFeedbackCharacters,
  maximumFeedbackNotesPerDay,
  maximumFeedbackScreenCharacters,
} from "@draft-loop/storage/feedback";
import { TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { TenantEntitlementsFor } from "./entitlement-gate.js";
import { apiError, apiErrorSchema } from "./errors.js";
import { operatorPageQuery } from "./operator-page-query.js";

export interface FeedbackRoutesOptions {
  readonly feedback: FeedbackStore;
  /** Sign-in mode's plans: the plan a note names is read here, never taken from the client. */
  readonly entitlementsFor?: TenantEntitlementsFor;
  /** The release this server runs, recorded with each note; `null` when it is not known. */
  readonly serverRelease?: string | null;
  readonly now?: () => Date;
}

const categorySchema = z.enum(feedbackCategories as unknown as [FeedbackCategory]);

const noteSchema = z
  .object({
    noteId: z.string(),
    kind: z
      .enum(["note", "support"])
      .describe(
        "`note` from Send feedback; `support` when a member handed a support conversation to a person.",
      ),
    organisationId: z.string(),
    memberId: z.string(),
    category: categorySchema.nullable(),
    screen: z.string(),
    text: z.string().describe("The note, or a support ticket's summary."),
    transcript: z
      .array(z.object({ role: z.enum(["member", "assistant"]), text: z.string() }))
      .nullable()
      .describe(
        "The conversation the member agreed to share with a support ticket; null for a note.",
      ),
    context: feedbackContextSchema
      .nullable()
      .describe("The technical facts sent with a note; null for a ticket or an older note."),
    status: z.enum(feedbackStatuses),
    issueUrl: z.string().nullable().describe("The GitHub issue the note led to."),
    triagedAt: z.string().nullable(),
    sentAt: z.string(),
  })
  .meta({ id: "FeedbackNote" });

const sendBody = z.strictObject({
  text: z
    .string()
    .max(maximumFeedbackCharacters * 2)
    .describe(`The note, ${maximumFeedbackCharacters} characters at most once trimmed.`),
  category: categorySchema.optional().describe("Bug, idea or other; leave it out when unsure."),
  screen: z
    .string()
    .min(1)
    .max(maximumFeedbackScreenCharacters)
    .regex(/^[A-Za-z0-9._:/-]+$/u)
    .describe("Where the note was written: the screen's name, or `agent`."),
  context: feedbackClientContextSchema
    .optional()
    .describe(
      "Technical facts for the operator: the route, build, ids in view, recent API errors and coarse browser facts. Never page text, a CV or a job description.",
    ),
});

const listQuery = operatorPageQuery.extend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  status: z.enum(feedbackStatuses).optional().describe("Only notes with this status."),
});

const dayMs = 24 * 60 * 60 * 1000;

const toResponse = (note: FeedbackNote) => ({
  ...note,
  transcript: note.transcript === null ? null : [...note.transcript],
});

/**
 * Feedback notes (#2828): a signed-in member sends a short note about DraftLoop from any screen or
 * through their agent, and the operator reads and triages every note (#2877). Notes are data for
 * a person to read: no model reads them, so they are not screened. A note's context (#2875)
 * carries technical facts only; the server adds the source, its release and the plan itself.
 */
export function registerFeedbackRoutes(
  parent: FastifyInstance,
  options: FeedbackRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { feedback, entitlementsFor } = options;
  const serverRelease = options.serverRelease?.slice(0, 64) || null;
  const now = options.now ?? (() => new Date());

  const planOf = async (tenantId: string): Promise<string | null> => {
    if (entitlementsFor === undefined) return null;
    const assignment = await entitlementsFor(tenantId).assignment();
    return assignment?.planId.slice(0, 64) ?? null;
  };

  const send =
    (source: FeedbackContext["source"]) =>
    async (request: FastifyRequest<{ Body: z.infer<typeof sendBody> }>, reply: FastifyReply) => {
      const { caller } = request;
      if (caller === undefined) {
        return reply.code(401).send(apiError("unauthorized", "A credential is required."));
      }
      if (caller.kind !== "member") {
        return reply.code(404).send(apiError("not_found", "No such route."));
      }
      const at = now();
      const sent = await feedback.notesSentSince({
        organisationId: caller.tenantId,
        memberId: caller.memberId,
        since: new Date(at.getTime() - dayMs),
      });
      if (sent >= maximumFeedbackNotesPerDay) {
        request.log.warn({ event: "feedback_cap_reached" }, "feedback cap reached");
        return reply
          .code(429)
          .header("retry-after", String(60 * 60))
          .send(
            apiError(
              "feedback_cap_reached",
              `You have sent ${maximumFeedbackNotesPerDay} notes in the last 24 hours, the most a member can send. Try again later.`,
            ),
          );
      }
      try {
        const context: FeedbackContext = {
          ...request.body.context,
          source,
          serverRelease,
          plan: await planOf(caller.tenantId),
        };
        const note = await feedback.send({
          organisationId: caller.tenantId,
          memberId: caller.memberId,
          category: request.body.category ?? null,
          screen: request.body.screen,
          text: request.body.text,
          context,
          now: at,
        });
        // The log names the note, never its text.
        request.log.info({ event: "feedback_sent", noteId: note.noteId }, "feedback sent");
        return reply.code(201).send(toResponse(note));
      } catch (error) {
        if (!(error instanceof TenantDirectoryError)) throw error;
        return reply.code(400).send(apiError("invalid_input", error.message));
      }
    };

  const sendResponses = {
    201: noteSchema,
    400: apiErrorSchema,
    401: apiErrorSchema,
    403: apiErrorSchema,
    404: apiErrorSchema,
    429: apiErrorSchema,
  };

  app.post(
    "/v1/feedback",
    {
      bodyLimit: 16 * 1024,
      schema: {
        summary: "Send feedback about DraftLoop to the operator",
        description: `Members only: owner-token mode has no members and answers 404. Stores the trimmed note in the caller's organisation for the operator to read, with its context and the server's own facts: source \`web\`, the server release and the plan. 400 invalid_input for an empty note, one over ${maximumFeedbackCharacters} characters or a context over its bounds. 429 feedback_cap_reached, with Retry-After, once the member has sent ${maximumFeedbackNotesPerDay} notes in 24 hours.`,
        body: sendBody,
        response: sendResponses,
      },
    },
    send("web"),
  );

  // The same note through a candidate record's address, the only kind an agent token reaches; the
  // note still belongs to the organisation (#2843).
  app.post(
    "/v1/workspaces/:workspaceId/feedback",
    {
      bodyLimit: 16 * 1024,
      schema: {
        summary: "Send feedback about DraftLoop to the operator, from an agent",
        description:
          "As `POST /v1/feedback`, for an agent token of a member with the `journal` scope, which a token gets unless issued without it. The record in the path only admits the token; the note belongs to the organisation. Its context's source is `agent`.",
        params: z.strictObject({ workspaceId: z.string().min(1).max(256) }),
        body: sendBody,
        response: sendResponses,
      },
    },
    send("agent"),
  );

  app.get(
    "/v1/operator/feedback",
    {
      schema: {
        summary: "List members' feedback notes, newest first",
        description:
          "Operator only. At most `limit` notes and support tickets, 100 by default, after skipping `offset`, of one `status` when it is given. `q` keeps notes whose text, screen or category contains it, without case. `total` counts every matching note; `counts` gives each status's count for the search. Support tickets are deleted 90 days after they were sent.",
        querystring: listQuery,
        response: {
          200: z.object({
            notes: z.array(noteSchema),
            total: z.number().int(),
            counts: z.object({
              new: z.number().int(),
              triaged: z.number().int(),
              issue: z.number().int(),
              closed: z.number().int(),
            }),
          }),
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const { limit, offset, q, status } = request.query;
      const [notes, counts] = await Promise.all([
        feedback.listNewest(limit, status, { offset, ...(q === undefined ? {} : { query: q }) }),
        feedback.statusCounts(q),
      ]);
      const total =
        status === undefined
          ? Object.values(counts).reduce((sum, count) => sum + count, 0)
          : counts[status];
      return { notes: notes.map(toResponse), total, counts };
    },
  );

  app.get(
    "/v1/operator/feedback/:noteId",
    {
      schema: {
        summary: "Read one feedback note",
        description:
          "Operator only. The note or support ticket with this id, in any organisation; the alert email links to it. 404 for an unknown note.",
        params: z.strictObject({ noteId: z.string().min(1).max(128) }),
        response: {
          200: noteSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const note = await feedback.get(request.params.noteId);
      if (note === undefined) {
        return reply.code(404).send(apiError("not_found", "No such feedback note."));
      }
      return reply.code(200).send(toResponse(note));
    },
  );

  app.patch(
    "/v1/operator/feedback/:noteId",
    {
      schema: {
        summary: "Triage a feedback note",
        description:
          "Operator only. Sets the note's status (`new`, `triaged`, `issue`, `closed`) and its GitHub issue link: a link replaces the stored one, null clears it, leaving it out keeps it. 400 invalid_input for status `issue` without a link or a link that is not an https GitHub issue address; 404 for an unknown note.",
        params: z.strictObject({ noteId: z.string().min(1).max(128) }),
        body: feedbackTriageSchema,
        response: {
          200: noteSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const note = await feedback.triage({
          noteId: request.params.noteId,
          status: request.body.status,
          ...(request.body.issueUrl === undefined ? {} : { issueUrl: request.body.issueUrl }),
          now: now(),
        });
        if (note === undefined) {
          return reply.code(404).send(apiError("not_found", "No such feedback note."));
        }
        request.log.info(
          { event: "feedback_triaged", noteId: note.noteId, status: note.status },
          "feedback triaged",
        );
        return reply.code(200).send(toResponse(note));
      } catch (error) {
        if (!(error instanceof TenantDirectoryError)) throw error;
        return reply.code(400).send(apiError("invalid_input", error.message));
      }
    },
  );
}
