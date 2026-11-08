import {
  maximumWritingSampleCharacters,
  maximumWritingSamples,
  type WritingSamplesService,
  writingSampleTextSchema,
} from "@draft-loop/application/writing-samples";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiErrorSchema } from "./errors.js";

export interface WritingSamplesRoutesOptions {
  readonly writingSamples: WritingSamplesService;
  readonly workspaceRoot: (workspaceId: string) => string;
}

const workspaceParams = z.strictObject({
  workspaceId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "Expected a safe identifier."),
});

const samplesView = z
  .strictObject({
    samples: z
      .array(z.string())
      .describe("Texts the candidate wrote, used as style only, never as a source of facts."),
  })
  .meta({ id: "WritingSamples" });

/**
 * The candidate's writing samples (#2513): up to three texts they wrote, so cover letters and
 * talking points sound like them. A sample is candidate material kept as a workspace setting.
 */
export function registerWritingSamplesRoutes(
  parent: FastifyInstance,
  options: WritingSamplesRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { writingSamples, workspaceRoot } = options;

  app.get(
    "/v1/workspaces/:workspaceId/writing-samples",
    {
      schema: {
        summary: "Read the candidate's writing samples",
        description: "The texts application material copies the candidate's style from.",
        params: workspaceParams,
        response: {
          200: samplesView,
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request) => ({
      samples: [...(await writingSamples.read(workspaceRoot(request.params.workspaceId)))],
    }),
  );

  app.put(
    "/v1/workspaces/:workspaceId/writing-samples",
    {
      schema: {
        summary: "Replace the candidate's writing samples",
        description: `Replaces every sample with at most ${maximumWritingSamples} texts of up to ${maximumWritingSampleCharacters} characters; an empty list removes them. Drafts copy their sentence length, tone and words, and never take a fact, a name or a number from them.`,
        params: workspaceParams,
        body: z.strictObject({
          samples: z.array(writingSampleTextSchema).max(maximumWritingSamples),
        }),
        response: {
          200: samplesView,
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request) => ({
      samples: [
        ...(await writingSamples.replace(
          workspaceRoot(request.params.workspaceId),
          request.body.samples,
        )),
      ],
    }),
  );
}
