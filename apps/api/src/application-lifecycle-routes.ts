import {
  type ApplicationService,
  type ApplicationView,
  CliUserError,
  maximumChosenRunReasonLength,
} from "@draft-loop/application";
import { choosableModelProfileEfforts } from "@draft-loop/application/model-profile-catalog";
import {
  applicationIdSchema,
  applicationNameSchema,
  applicationPastedJobMaxLength,
} from "@draft-loop/schemas/application";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import { applicationView, applicationViewSchema } from "./views.js";

export interface ApplicationLifecycleRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const workspaceParams = z.strictObject({ workspaceId: identifierSchema });
const applicationParams = workspaceParams.extend({ applicationId: applicationIdSchema });
const notFound = apiError("not_found", "No such application.");

const createApplicationBody = z
  .strictObject({
    name: applicationNameSchema,
    jobText: z
      .string()
      .trim()
      .min(1)
      .max(applicationPastedJobMaxLength)
      .optional()
      .describe("The pasted job description, kept with the application."),
    jobUrl: z
      .url({ protocol: /^https$/u })
      .max(2_048)
      .optional()
      .describe(
        "A job page address, in place of pasted text. It is fetched only when requirements are extracted, never before.",
      ),
    jobUrlApproved: z
      .literal(true)
      .optional()
      .describe("The person's approval to fetch jobUrl, kept with the application."),
  })
  .refine((body) => (body.jobText === undefined) !== (body.jobUrl === undefined), {
    message: "Give the pasted job text or a job page address.",
  })
  .refine((body) => (body.jobUrl === undefined) === (body.jobUrlApproved === undefined), {
    message: "A job page address needs the person's approval to fetch it, and only then.",
  });

const updateApplicationBody = z
  .strictObject({
    name: applicationNameSchema.optional(),
    archived: z.boolean().optional().describe("True archives the application, false restores it."),
  })
  .refine((body) => body.name !== undefined || body.archived !== undefined, {
    message: "Give a name, archived, or both.",
  });

const modelProfileReference = z.strictObject({
  id: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  effort: z
    .enum(choosableModelProfileEfforts)
    .optional()
    .describe("A reasoning level the profile allows; without it the profile's own level."),
});
const setModelsBody = z.strictObject({
  modelProfiles: z
    .strictObject({ author: modelProfileReference, critic: modelProfileReference })
    .nullable()
    .describe("The pair for this application's new runs; null uses the workspace's pair again."),
});

const chooseRunBody = z.strictObject({
  runId: identifierSchema,
  reason: z.string().trim().min(1).max(maximumChosenRunReasonLength).optional(),
});

const applicationJobSchema = z
  .object({
    origin: z
      .enum(["pasted-text", "url", "unavailable"])
      .describe("Where the text came from; `unavailable` when the application keeps none."),
    text: z.string().nullable(),
    url: z.string().nullable().describe("The approved job page, only for a job added by address."),
  })
  .meta({ id: "ApplicationJob" });

/** The job an application keeps, read back for the screens: pasted text, or a page's address. */
function applicationJob(view: ApplicationView): z.infer<typeof applicationJobSchema> {
  const source = view.jobSource;
  if (source.kind === "stored-text") return { origin: "pasted-text", text: source.text, url: null };
  if (source.kind === "approved-url") return { origin: "url", text: null, url: source.url };
  // A hosted workspace has no files, so a job named by a file path has no text to read.
  return { origin: "unavailable", text: null, url: null };
}

/** A method the hosted service always offers; a service without it refuses as unsupported. */
function offered<Method>(method: Method | undefined, name: string): Method {
  if (method === undefined) throw new CliUserError(`${name} is not available in this service.`);
  return method;
}

const errorResponses = { 400: apiErrorSchema, 404: apiErrorSchema, 422: apiErrorSchema };

/**
 * Creating, renaming, archiving and pairing a workspace's job applications, and choosing the run
 * whose draft an application uses, over `ApplicationService` as the desktop does (ADR 0011, D9).
 * The hosted service keeps a pasted job in the application's record, never in a file.
 */
export function registerApplicationLifecycleRoutes(
  parent: FastifyInstance,
  options: ApplicationLifecycleRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot } = options;

  /** The application, or a 404 already sent; the service would refuse an unknown one as 422. */
  const existing = async (
    workspaceId: string,
    applicationId: string,
    reply: FastifyReply,
  ): Promise<ApplicationView | undefined> => {
    const view = await service.getApplication({ root: workspaceRoot(workspaceId), applicationId });
    if (view === undefined) await reply.code(404).send(notFound);
    return view;
  };

  app.post(
    "/v1/workspaces/:workspaceId/applications",
    {
      schema: {
        summary: "Create a job application from a pasted job description or an approved job page",
        description:
          "Keeps the text, or the job page address with the person's approval to fetch it, with the application. Nothing is fetched now. Its job brief is then created from that job, as a separate step, so the requirements can be extracted and reviewed; a job page is fetched once then.",
        params: workspaceParams,
        body: createApplicationBody,
        response: { 201: applicationViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const created = await service.createApplication({
        root: workspaceRoot(request.params.workspaceId),
        name: request.body.name,
        jobSource:
          request.body.jobUrl === undefined
            ? { kind: "pasted-text", text: request.body.jobText ?? "" }
            : { kind: "approved-url", url: request.body.jobUrl, approved: true },
      });
      return reply.code(201).send(applicationView(created));
    },
  );

  app.patch(
    "/v1/workspaces/:workspaceId/applications/:applicationId",
    {
      schema: {
        summary: "Rename, archive or restore a job application",
        params: applicationParams,
        body: updateApplicationBody,
        response: { 200: applicationViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      let view = await existing(workspaceId, applicationId, reply);
      if (view === undefined) return reply;
      const root = workspaceRoot(workspaceId);
      if (request.body.name !== undefined) {
        view = await offered(
          service.renameApplication,
          "Renaming an application",
        )({ root, applicationId, name: request.body.name });
      }
      if (request.body.archived !== undefined) {
        view = await offered(
          service.archiveApplication,
          "Archiving an application",
        )({
          root,
          applicationId,
          archived: request.body.archived,
        });
      }
      return applicationView(view);
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/applications/:applicationId/models",
    {
      schema: {
        summary: "Set or clear a job application's model pair",
        description:
          "Exact author and critic model profile versions from two different companies, for the application's new runs. The default application always uses the workspace's pair.",
        params: applicationParams,
        body: setModelsBody,
        response: { 200: applicationViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      if ((await existing(workspaceId, applicationId, reply)) === undefined) return reply;
      return applicationView(
        await offered(
          service.setApplicationModels,
          "Pairing an application",
        )({
          root: workspaceRoot(workspaceId),
          applicationId,
          modelProfiles: request.body.modelProfiles,
        }),
      );
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/applications/:applicationId/chosen-run",
    {
      schema: {
        summary: "Choose the run whose draft a job application uses",
        params: applicationParams,
        body: chooseRunBody,
        response: { 200: applicationViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      if ((await existing(workspaceId, applicationId, reply)) === undefined) return reply;
      return applicationView(
        await offered(
          service.chooseApplicationRun,
          "Choosing a run",
        )({
          root: workspaceRoot(workspaceId),
          applicationId,
          runId: request.body.runId,
          ...(request.body.reason === undefined ? {} : { reason: request.body.reason }),
        }),
      );
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/applications/:applicationId/job",
    {
      schema: {
        summary: "Read the job description a job application keeps",
        params: applicationParams,
        response: { 200: applicationJobSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      const view = await existing(workspaceId, applicationId, reply);
      if (view === undefined) return reply;
      return applicationJob(view);
    },
  );
}
