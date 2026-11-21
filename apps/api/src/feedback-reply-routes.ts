import {
  type FeedbackStore,
  maximumFeedbackReplies,
  maximumFeedbackReplyCharacters,
} from "@draft-loop/storage/feedback";
import { TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { writeAuditLine } from "./audit-line.js";
import { apiError, apiErrorSchema } from "./errors.js";
import {
  type FeedbackReplyMailer,
  feedbackReference,
  feedbackReplyLocale,
} from "./feedback-reply-mail.js";
import { noteSchema, toResponse } from "./feedback-routes.js";

export interface FeedbackReplyRoutesOptions {
  readonly feedback: FeedbackStore;
  /** Emails the reply; without it the route answers 503 `mail_unavailable`. */
  readonly mailer?: FeedbackReplyMailer;
  /** The address of a member, read on the server; undefined once the member is gone. */
  readonly memberEmail: (organisationId: string, memberId: string) => Promise<string | undefined>;
  readonly now?: () => Date;
}

const replyBody = z.strictObject({
  text: z
    .string()
    .max(maximumFeedbackReplyCharacters * 2)
    .describe(`The reply, ${maximumFeedbackReplyCharacters} characters at most once trimmed.`),
});

/**
 * The operator replies to a feedback note (#2878): the server finds the member who sent it,
 * emails the reply in their language and keeps it with the note. The operator presses Send; the
 * member's address never reaches the operator, a log or the response.
 */
export function registerFeedbackReplyRoutes(
  parent: FastifyInstance,
  options: FeedbackReplyRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { feedback, mailer, memberEmail } = options;
  const now = options.now ?? (() => new Date());

  app.post(
    "/v1/operator/feedback/:noteId/reply",
    {
      bodyLimit: 16 * 1024,
      schema: {
        summary: "Reply to the member who sent a feedback note",
        description: `Operator only. Emails the reply to the member who sent the note, in the language of their browser when known, and stores it with the note; the member's address stays on the server. A reply is an outward message: send it only on the operator's own action. 400 invalid_input for an empty reply, one over ${maximumFeedbackReplyCharacters} characters, or a note that already holds ${maximumFeedbackReplies} replies; 404 not_found for an unknown note, member_gone once the member's account is gone; 502 mail_failed when the mail provider refuses it (nothing is stored); 503 mail_unavailable where the server sends no mail.`,
        params: z.strictObject({ noteId: z.string().min(1).max(128) }),
        body: replyBody,
        response: {
          200: noteSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          502: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const text = request.body.text.trim();
      if (text === "" || text.length > maximumFeedbackReplyCharacters) {
        return reply
          .code(400)
          .send(
            apiError(
              "invalid_input",
              `A reply has 1 to ${maximumFeedbackReplyCharacters} characters.`,
            ),
          );
      }
      const note = await feedback.get(request.params.noteId);
      if (note === undefined) {
        return reply.code(404).send(apiError("not_found", "No such feedback note."));
      }
      if (note.replies.length >= maximumFeedbackReplies) {
        return reply
          .code(400)
          .send(
            apiError("invalid_input", `A note keeps at most ${maximumFeedbackReplies} replies.`),
          );
      }
      if (mailer === undefined) {
        return reply
          .code(503)
          .send(apiError("mail_unavailable", "This server sends no email, so it cannot reply."));
      }
      const email = await memberEmail(note.organisationId, note.memberId);
      if (email === undefined) {
        return reply
          .code(404)
          .send(apiError("member_gone", "The member who sent this note no longer has an account."));
      }
      const locale = feedbackReplyLocale(note.context?.browser?.language);
      const sent = await mailer({
        email,
        reference: feedbackReference(note.noteId),
        text,
        ...(locale === undefined ? {} : { locale }),
      });
      if (!sent) {
        return reply
          .code(502)
          .send(apiError("mail_failed", "The reply could not be emailed. Try again later."));
      }
      try {
        const updated = await feedback.addReply({ noteId: note.noteId, text, now: now() });
        if (updated === undefined) {
          return reply.code(404).send(apiError("not_found", "No such feedback note."));
        }
        // The log names the note, never the reply or the address.
        request.log.info({ event: "feedback_replied", noteId: note.noteId }, "feedback replied");
        writeAuditLine(request, "feedback_replied", {
          noteId: note.noteId,
          organisationId: note.organisationId,
        });
        return reply.code(200).send(toResponse(updated));
      } catch (error) {
        if (!(error instanceof TenantDirectoryError)) throw error;
        return reply.code(400).send(apiError("invalid_input", error.message));
      }
    },
  );
}
