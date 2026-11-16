import {
  type FeedbackCategory,
  type FeedbackStore,
  feedbackCategories,
  maximumFeedbackCharacters,
  maximumFeedbackScreenCharacters,
} from "@draft-loop/storage/feedback";
import { TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

export interface FeedbackRoutesOptions {
  readonly feedback: FeedbackStore;
  readonly now?: () => Date;
}

const categorySchema = z.enum(feedbackCategories as unknown as [FeedbackCategory]);

const noteSchema = z
  .object({
    noteId: z.string(),
    organisationId: z.string(),
    memberId: z.string(),
    category: categorySchema.nullable(),
    screen: z.string(),
    text: z.string(),
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
});

const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * Feedback notes (#2828): a signed-in member sends a short note about DraftLoop from any screen or
 * through their agent, and the operator reads every note. Notes are data for a person to read:
 * no model reads them, so they are not screened.
 */
export function registerFeedbackRoutes(
  parent: FastifyInstance,
  options: FeedbackRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { feedback } = options;
  const now = options.now ?? (() => new Date());

  const send = async (
    request: FastifyRequest<{ Body: z.infer<typeof sendBody> }>,
    reply: FastifyReply,
  ) => {
    const { caller } = request;
    if (caller === undefined) {
      return reply.code(401).send(apiError("unauthorized", "A credential is required."));
    }
    if (caller.kind !== "member") {
      return reply.code(404).send(apiError("not_found", "No such route."));
    }
    try {
      const note = await feedback.send({
        organisationId: caller.tenantId,
        memberId: caller.memberId,
        category: request.body.category ?? null,
        screen: request.body.screen,
        text: request.body.text,
        now: now(),
      });
      // The log names the note, never its text.
      request.log.info({ event: "feedback_sent", noteId: note.noteId }, "feedback sent");
      return reply.code(201).send(note);
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
  };

  app.post(
    "/v1/feedback",
    {
      bodyLimit: 16 * 1024,
      schema: {
        summary: "Send feedback about DraftLoop to the operator",
        description: `Members only: owner-token mode has no members and answers 404. Stores the trimmed note in the caller's organisation for the operator to read. 400 invalid_input for an empty note or one over ${maximumFeedbackCharacters} characters.`,
        body: sendBody,
        response: sendResponses,
      },
    },
    send,
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
          "As `POST /v1/feedback`, for an agent token of a member with the `journal` scope, which a token gets unless issued without it. The record in the path only admits the token; the note belongs to the organisation.",
        params: z.strictObject({ workspaceId: z.string().min(1).max(256) }),
        body: sendBody,
        response: sendResponses,
      },
    },
    send,
  );

  app.get(
    "/v1/operator/feedback",
    {
      schema: {
        summary: "List members' feedback notes, newest first",
        description: "Operator only. At most `limit` notes, 100 by default.",
        querystring: listQuery,
        response: {
          200: z.object({ notes: z.array(noteSchema) }),
          401: apiErrorSchema,
          403: apiErrorSchema,
        },
      },
    },
    async (request) => ({ notes: [...(await feedback.listNewest(request.query.limit))] }),
  );
}
