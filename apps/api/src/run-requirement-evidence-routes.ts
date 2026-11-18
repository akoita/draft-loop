import type { ApplicationService } from "@draft-loop/application";
import { runRequirementEvidenceSchema } from "@draft-loop/schemas/run-requirement-evidence";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

export interface RunRequirementEvidenceRoutesOptions {
  readonly service: Pick<ApplicationService, "readWorkspace" | "readRunRequirementEvidence">;
  readonly workspaceRoot: (workspaceId: string) => string;
}

const identifier = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const params = z.strictObject({ workspaceId: identifier, runId: identifier });

/**
 * Which evidence supports each job requirement of a run (#3009, #2984): the run's
 * requirement-evidence map, read back from its content-free audit events. The workspace access
 * hooks apply as on every workspace route, so the map is read by whoever can read the run.
 */
export function registerRunRequirementEvidenceRoutes(
  parent: FastifyInstance,
  options: RunRequirementEvidenceRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/v1/workspaces/:workspaceId/runs/:runId/requirement-evidence",
    {
      schema: {
        summary: "Read which evidence supports each requirement of a run",
        description:
          "Each job requirement of the run with its candidate evidence chunks, best first: the source's name and lines, whether the chunk matched by meaning, keywords or both, its similarity score, and its grade when the run graded the map. Names sources but never quotes evidence. 404 when the run recorded no map, as a run without requirements or full-source evidence does.",
        params,
        response: {
          200: runRequirementEvidenceSchema.meta({ id: "RunRequirementEvidence" }),
          400: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, runId } = request.params;
      const root = options.workspaceRoot(workspaceId);
      // Refuses a workspace that is not the caller's before the run's history is read.
      await options.service.readWorkspace(root);
      const evidence = await options.service.readRunRequirementEvidence?.({ root, runId });
      if (evidence === undefined) {
        return reply
          .code(404)
          .send(apiError("not_found", "This run recorded no requirement-evidence map."));
      }
      return evidence;
    },
  );
}
