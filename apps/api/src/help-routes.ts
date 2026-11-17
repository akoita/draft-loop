import { helpGuideResponseSchema } from "@draft-loop/schemas/help-guide";
import { helpGuide, searchHelpGuide } from "@draft-loop/user-guide";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

const guideQuery = z.strictObject({
  language: z.enum(["en", "fr"]).default("en").describe("The guide's language."),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Words to search for; leave it out for the whole guide."),
});

type GuideRequest = FastifyRequest<{ Querystring: z.infer<typeof guideQuery> }>;

const responses = {
  200: helpGuideResponseSchema,
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
};

/**
 * The user guide over the API (#2881): the same text as the Help button, whole or searched, for
 * any signed-in caller and for an agent token through a candidate record's address. It holds no
 * candidate material, so the record in the path only admits the token.
 */
export function registerHelpRoutes(parent: FastifyInstance): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();

  const read = async (request: GuideRequest, reply: FastifyReply) => {
    if (request.caller === undefined) {
      return reply.code(401).send(apiError("unauthorized", "A credential is required."));
    }
    const { language, q } = request.query;
    const guide = helpGuide(language);
    const query = q === undefined || q === "" ? null : q;
    return reply.send({
      language,
      intro: guide.intro,
      query,
      sections: (query === null ? guide.sections : searchHelpGuide(guide, query)).map(
        (section) => ({
          id: section.id,
          title: section.title,
          paragraphs: [...section.paragraphs],
        }),
      ),
    });
  };

  app.get(
    "/v1/help",
    {
      schema: {
        summary: "Read or search the user guide",
        description:
          "The guide the Help button shows, in English or French. With `q`, only the sections that match every word, best first; accents and case do not matter.",
        querystring: guideQuery,
        response: responses,
      },
    },
    read,
  );

  app.get(
    "/v1/workspaces/:workspaceId/help",
    {
      schema: {
        summary: "Read or search the user guide, from an agent",
        description:
          "As `GET /v1/help`, for an agent token with the `journal` scope, which a token gets unless issued without it. The record in the path only admits the token.",
        params: z.strictObject({ workspaceId: z.string().min(1).max(256) }),
        querystring: guideQuery,
        response: responses,
      },
    },
    read,
  );
}
