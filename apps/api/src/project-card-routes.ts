import type { WorkJournalService } from "@draft-loop/application/work-journal";
import { projectCardInputSchema } from "@draft-loop/schemas/project-card";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiErrorSchema } from "./errors.js";
import type { IdempotencyStore } from "./idempotency.js";
import type { WorkJournalSignInChecks } from "./work-journal-sign-in.js";

/**
 * Project cards (#2895): what the MCP tool `add_project` sends. A card about one code repository
 * lands pending in the candidate's Work journal and becomes evidence only once they approve it.
 * The body is the card's fields only, never files or code; logs carry ids and statuses.
 */

export interface ProjectCardRouteOptions {
  readonly journal: WorkJournalService;
  readonly idempotency: IdempotencyStore;
  readonly requireWorkspace: (workspaceId: string) => Promise<void>;
  readonly signIn?: Pick<WorkJournalSignInChecks, "requireStorageConsent">;
}

const params = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

const headers = z.object({
  "idempotency-key": z
    .string()
    .regex(/^[A-Za-z0-9._:-]{8,128}$/u, "must be 8 to 128 safe characters")
    .optional(),
});

const resultSchema = z
  .object({
    card_id: z.string().optional().describe("The pending card's id, a work journal note id."),
    status: z.enum(["pending", "duplicate", "previously_discarded", "validated"]),
    duplicate_of: z.string().optional(),
    possible_duplicate_of: z.array(z.string()),
    screening: z.enum(["clear", "flagged", "unscreened"]).optional(),
    review_url: z.string().optional().describe("Where the candidate reviews the card."),
    message: z.string(),
  })
  .meta({ id: "ProjectCardResult" });

const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  413: apiErrorSchema,
  422: apiErrorSchema,
  429: apiErrorSchema,
  503: apiErrorSchema,
} as const;

/** A card is a few kilobytes; a larger body is someone sending files or code. */
export const maximumProjectCardBytes = 32_768;

export function registerProjectCardRoute(
  parent: FastifyInstance,
  options: ProjectCardRouteOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { journal, idempotency, requireWorkspace, signIn } = options;

  app.post(
    "/v1/workspaces/:workspaceId/work-journal/projects",
    {
      bodyLimit: maximumProjectCardBytes,
      // The body is checked by the journal itself, so a refusal is one content-free code.
      attachValidation: true,
      schema: {
        summary: "File a project card about one code repository, pending the candidate's review",
        description:
          "What the MCP tool add_project sends: a short, cited summary of one repository the agent read on the candidate's machine, never its code. Every number is counted from git. The card waits in the candidate's Work journal and becomes a project source only once they approve it. Refusals are content-free codes: invalid_card, secret_like_content, contributor_identity (an email address anywhere), private_card_with_links, link_not_https (422), not_consented (403), rate_limited (429) and a body over 32 KB (413); in sign-in mode, storage_consent_required (409). A repeat answers duplicate; a card the candidate discarded answers previously_discarded. dry_run validates without storing.",
        params,
        headers,
        body: projectCardInputSchema,
        response: { 200: resultSchema, 201: resultSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      await requireWorkspace(workspaceId);
      await signIn?.requireStorageConsent(workspaceId);
      const key = request.headers["idempotency-key"];
      const agentTokenId = request.agentToken?.id;
      const produce = () => journal.recordProject(workspaceId, request.body, { agentTokenId });
      const result =
        key === undefined
          ? await produce()
          : await idempotency.once(`project-card:${workspaceId}`, key, request.body, produce);
      request.log.info(
        { workspaceId, cardId: result.note_id, status: result.status, agentTokenId },
        "project card filed",
      );
      const { note_id: cardId, status, ...rest } = result;
      return reply.code(status === "pending" ? 201 : 200).send({
        ...rest,
        status: status === "amended" ? "pending" : status,
        possible_duplicate_of: [...result.possible_duplicate_of],
        ...(cardId === undefined ? {} : { card_id: cardId, review_url: "/#work-journal" }),
      });
    },
  );
}
