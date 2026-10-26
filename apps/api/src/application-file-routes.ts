import {
  type ApplicationService,
  hostedKnowledgeSourceMediaTypes,
  jobDescriptionFileText,
} from "@draft-loop/application";
import { applicationNameSchema } from "@draft-loop/schemas/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import { applicationView, applicationViewSchema } from "./views.js";

export interface ApplicationFileRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
  /** The largest file taken, the career-evidence upload limit. */
  readonly maxBytes: number;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const workspaceParams = z.strictObject({ workspaceId: identifierSchema });

/** The application's name, and the file's own name to read it by; never a path. */
const fileQuery = z.strictObject({
  name: applicationNameSchema.describe("The new application's name."),
  fileName: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (name) => ![...name].some((character) => character < " " || "\u007f/\\".includes(character)),
      "must be a file name without a path",
    )
    .describe("The attached file's name; used to read it, never stored."),
});

/**
 * Creating an application from a job description file (#1809). The file is read once, as career
 * evidence is, and its text becomes the application's job exactly as pasted text would; the file
 * itself is not kept. Its own parser lives in a child context, so every other route keeps JSON.
 */
export function registerApplicationFileRoutes(
  parent: FastifyInstance,
  options: ApplicationFileRoutesOptions,
): void {
  const { service, workspaceRoot, maxBytes } = options;
  void parent.register(async (scope) => {
    const upload = scope.withTypeProvider<ZodTypeProvider>();
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser(
      [...hostedKnowledgeSourceMediaTypes],
      { parseAs: "buffer", bodyLimit: maxBytes },
      (_request, body, done) => done(null, body),
    );
    upload.post(
      "/v1/workspaces/:workspaceId/applications/from-file",
      {
        bodyLimit: maxBytes,
        schema: {
          summary: "Create a job application from a job description file",
          description: `Send the file itself as the request body, with its media type as the Content-Type: ${hostedKnowledgeSourceMediaTypes.join(", ")}. The type is checked against the file's signature, and its text is read as career evidence is and kept with the application exactly as a pasted job description; the file is not stored. Another type answers 415, a file over the upload limit 413, and a file with no readable text or with more text than a pasted job may hold 422.`,
          consumes: [...hostedKnowledgeSourceMediaTypes],
          params: workspaceParams,
          querystring: fileQuery,
          body: z.unknown().meta({ type: "string", format: "binary" }),
          response: {
            201: applicationViewSchema,
            400: apiErrorSchema,
            404: apiErrorSchema,
            413: apiErrorSchema,
            415: apiErrorSchema,
            422: apiErrorSchema,
          },
        },
      },
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body)) {
          return reply
            .code(415)
            .send(apiError("unsupported_media_type", "Send the file as the request body."));
        }
        const mediaType = (request.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "";
        const text = await jobDescriptionFileText(
          {
            name: request.query.fileName,
            mediaType: mediaType.toLowerCase(),
            bytes: new Uint8Array(request.body),
          },
          maxBytes,
        );
        const created = await service.createApplication({
          root: workspaceRoot(request.params.workspaceId),
          name: request.query.name,
          jobSource: { kind: "pasted-text", text },
        });
        return reply.code(201).send(applicationView(created));
      },
    );
  });
}
