import {
  type ApplicationService,
  defaultWritingPolicyContent,
  maximumWritingPolicyBytes,
  type WritingPolicyVersionView,
} from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

export interface WritingPolicyRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "Expected a safe identifier.");
const workspaceParams = z.strictObject({ workspaceId: identifierSchema });

const setWritingPolicyBody = z.strictObject({
  content: z
    .string()
    .min(1)
    .max(maximumWritingPolicyBytes)
    .describe("The policy as Markdown; at most 64 KiB once encoded as UTF-8."),
});

const writingPolicyVersionSchema = z
  .object({
    checksum: z.string().describe("The SHA-256 of the policy text, which names the version."),
    version: z.string(),
    createdAt: z.string(),
    priorChecksum: z.string().nullable().describe("The version this one replaced, if any."),
  })
  .meta({ id: "WritingPolicyVersion" });

const writingPolicySchema = writingPolicyVersionSchema
  .extend({ content: z.string().describe("The policy's Markdown text.") })
  .meta({ id: "WritingPolicy" });

const writingPolicyTemplateSchema = z
  .object({ content: z.string().describe("The template's Markdown text.") })
  .meta({ id: "WritingPolicyTemplate" });

/** Copies only the schema's fields: the compiled rules and preferences stay on the server. */
const versionView = (view: WritingPolicyVersionView) => ({
  checksum: view.checksum,
  version: view.version,
  createdAt: view.createdAt,
  priorChecksum: view.priorChecksum,
});

const silent = { write: () => undefined };

/**
 * The candidate's writing policy for a hosted workspace: the text arrives in the request and is
 * kept as an immutable version, as the CLI keeps a policy file's (ADR 0011, D15).
 */
export function registerWritingPolicyRoutes(
  parent: FastifyInstance,
  options: WritingPolicyRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot } = options;

  const readActive = async (workspaceId: string) => {
    const view = await service.getWritingPolicy?.({
      root: workspaceRoot(workspaceId),
      includeContent: true,
    });
    return view?.policy === undefined
      ? undefined
      : { ...versionView(view), content: view.policy.content };
  };

  app.put(
    "/v1/workspaces/:workspaceId/writing-policy",
    {
      schema: {
        summary: "Set a workspace's writing policy",
        description:
          "Saves the text as a new version and makes it the policy the workspace's next runs follow. Setting the same text again keeps its version.",
        params: workspaceParams,
        body: setWritingPolicyBody,
        response: {
          200: writingPolicySchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      await service.configureWritingPolicy(
        { root: workspaceRoot(workspaceId), content: request.body.content },
        silent,
      );
      const active = await readActive(workspaceId);
      if (active === undefined) throw new Error("The writing policy was saved but not activated.");
      return reply.code(200).send(active);
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/writing-policy",
    {
      schema: {
        summary: "Read a workspace's active writing policy",
        params: workspaceParams,
        response: { 200: writingPolicySchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const active = await readActive(request.params.workspaceId);
      if (active === undefined) {
        return reply.code(404).send(apiError("not_found", "The workspace has no writing policy."));
      }
      return active;
    },
  );

  app.get(
    "/v1/writing-policy-template",
    {
      schema: {
        summary: "Read the writing policy template",
        description:
          "The policy a new desktop workspace starts with, for an editor to begin from when a workspace has none. Reading it saves nothing.",
        response: { 200: writingPolicyTemplateSchema },
      },
    },
    async () => ({ content: defaultWritingPolicyContent }),
  );

  app.get(
    "/v1/workspaces/:workspaceId/writing-policy/versions",
    {
      schema: {
        summary: "List a workspace's writing policy versions, without their text",
        params: workspaceParams,
        response: {
          200: z.object({ versions: z.array(writingPolicyVersionSchema) }),
          400: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const versions = await service.listWritingPolicyVersions?.({
        root: workspaceRoot(request.params.workspaceId),
      });
      return { versions: (versions ?? []).map(versionView) };
    },
  );
}
