import {
  type ApplicationFolderView,
  type ApplicationService,
  CliUserError,
} from "@draft-loop/application";
import {
  applicationFolderIdSchema,
  applicationFolderNameSchema,
} from "@draft-loop/schemas/application-folder";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiErrorSchema } from "./errors.js";

export interface ApplicationFolderRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const workspaceParams = z.strictObject({ workspaceId: identifierSchema });
const folderParams = workspaceParams.extend({ folderId: applicationFolderIdSchema });
const nameBody = z.strictObject({
  name: applicationFolderNameSchema.describe(
    "1 to 60 characters, unique in the workspace ignoring case and accents.",
  ),
});

export const applicationFolderViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    applicationCount: z
      .number()
      .int()
      .describe("Applications in the folder, archived ones included."),
  })
  .meta({ id: "ApplicationFolder" });

const folderListSchema = z
  .object({ folders: z.array(applicationFolderViewSchema) })
  .meta({ id: "ApplicationFolderList" });

const deletedFolderSchema = z
  .object({
    folderId: z.string(),
    movedApplications: z
      .number()
      .int()
      .describe("Applications that went back to no folder; none is deleted."),
  })
  .meta({ id: "DeletedApplicationFolder" });

function folderView(folder: ApplicationFolderView): z.infer<typeof applicationFolderViewSchema> {
  return {
    id: folder.id,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    applicationCount: folder.applicationCount,
  };
}

/** A method the hosted service always offers; a service without it refuses as unsupported. */
function offered<Method>(method: Method | undefined): Method {
  if (method === undefined) {
    throw new CliUserError("Application folders are not available in this service.");
  }
  return method;
}

const errorResponses = { 400: apiErrorSchema, 404: apiErrorSchema, 422: apiErrorSchema };

/**
 * Folders that group a workspace's applications on Home (#2282): one level, one folder per
 * application. Deleting a folder never deletes an application. Moving an application is the
 * application's own `PATCH` with `folderId`.
 */
export function registerApplicationFolderRoutes(
  parent: FastifyInstance,
  options: ApplicationFolderRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot } = options;

  app.get(
    "/v1/workspaces/:workspaceId/application-folders",
    {
      schema: {
        summary: "List the folders that group a workspace's job applications",
        params: workspaceParams,
        response: { 200: folderListSchema, ...errorResponses },
      },
    },
    async (request) => ({
      folders: (
        await offered(service.listApplicationFolders)({
          root: workspaceRoot(request.params.workspaceId),
        })
      ).map(folderView),
    }),
  );

  app.post(
    "/v1/workspaces/:workspaceId/application-folders",
    {
      schema: {
        summary: "Create a folder for job applications",
        params: workspaceParams,
        body: nameBody,
        response: { 201: applicationFolderViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const folder = await offered(service.createApplicationFolder)({
        root: workspaceRoot(request.params.workspaceId),
        name: request.body.name,
      });
      return reply.code(201).send(folderView(folder));
    },
  );

  app.patch(
    "/v1/workspaces/:workspaceId/application-folders/:folderId",
    {
      schema: {
        summary: "Rename a folder of job applications",
        params: folderParams,
        body: nameBody,
        response: { 200: applicationFolderViewSchema, ...errorResponses },
      },
    },
    async (request) =>
      folderView(
        await offered(service.renameApplicationFolder)({
          root: workspaceRoot(request.params.workspaceId),
          folderId: request.params.folderId,
          name: request.body.name,
        }),
      ),
  );

  app.delete(
    "/v1/workspaces/:workspaceId/application-folders/:folderId",
    {
      schema: {
        summary: "Delete a folder; its job applications stay, in no folder",
        params: folderParams,
        response: { 200: deletedFolderSchema, ...errorResponses },
      },
    },
    async (request) =>
      offered(service.deleteApplicationFolder)({
        root: workspaceRoot(request.params.workspaceId),
        folderId: request.params.folderId,
      }),
  );
}
