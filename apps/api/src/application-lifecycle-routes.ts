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
import { applicationFolderPlacementSchema } from "@draft-loop/schemas/application-folder";
import { documentLanguageCodeSchema } from "@draft-loop/schemas/application-language";
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
    folderId: applicationFolderPlacementSchema
      .optional()
      .describe("The folder to put the new application in; absent or null for no folder."),
    language: documentLanguageCodeSchema
      .optional()
      .describe("The language its documents are written in; absent uses the workspace's."),
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
    folderId: applicationFolderPlacementSchema
      .optional()
      .describe("Moves the application into this folder; null takes it out of any folder."),
  })
  .refine(
    (body) => body.name !== undefined || body.archived !== undefined || body.folderId !== undefined,
    { message: "Give a name, archived, a folderId, or any of them." },
  );

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

const setLanguageBody = z.strictObject({
  language: documentLanguageCodeSchema
    .nullable()
    .describe("The language for this application's new runs; null uses the workspace's again."),
});

const chooseRunBody = z.strictObject({
  runId: identifierSchema,
  reason: z.string().trim().min(1).max(maximumChosenRunReasonLength).optional(),
});

const savedJobPageSchema = z.object({
  text: z.string(),
  savedAt: z.string().describe("When the service read the page and saved this copy."),
});

export const applicationJobSchema = z
  .object({
    origin: z
      .enum(["pasted-text", "url", "unavailable"])
      .describe("Where the text came from; `unavailable` when the application keeps none."),
    text: z
      .string()
      .nullable()
      .describe(
        "The job text; for a job page, the copy saved when it was read, or null without one.",
      ),
    url: z.string().nullable().describe("The approved job page, only for a job added by address."),
    savedAt: z
      .string()
      .nullable()
      .describe("When the job page's copy was saved; null for pasted text or without a copy."),
    copySource: z
      .enum(["page", "pasted"])
      .nullable()
      .describe("Whether the job page's copy was read from the page or pasted by the person."),
    earlier: savedJobPageSchema
      .nullable()
      .describe("The first copy of the job page, kept when a later read gave different text."),
  })
  .meta({ id: "ApplicationJob" });

/**
 * The job an application keeps, read back for the screens: pasted text, or a page's address with
 * the copy saved when it was read, so the job stays readable after the page expires (#2592).
 */
export function applicationJob(view: ApplicationView): z.infer<typeof applicationJobSchema> {
  const source = view.jobSource;
  const none = { savedAt: null, copySource: null, earlier: null };
  if (source.kind === "stored-text") {
    return { origin: "pasted-text", text: source.text, url: null, ...none };
  }
  if (source.kind === "approved-url") {
    const { page, firstPage } = source;
    return {
      origin: "url",
      text: page?.text ?? null,
      url: source.url,
      savedAt: page?.fetchedAt ?? null,
      copySource: page === undefined ? null : page.pasted === true ? "pasted" : "page",
      earlier:
        firstPage === undefined ? null : { text: firstPage.text, savedAt: firstPage.fetchedAt },
    };
  }
  // A hosted workspace has no files, so a job named by a file path has no text to read.
  return { origin: "unavailable", text: null, url: null, ...none };
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
      const root = workspaceRoot(request.params.workspaceId);
      const { folderId } = request.body;
      // An unknown folder is refused before anything is created.
      if (folderId !== undefined && folderId !== null) {
        const folders = await offered(
          service.listApplicationFolders,
          "Application folders",
        )({ root });
        if (!folders.some((folder) => folder.id === folderId)) {
          return reply.code(422).send(apiError("rejected", `Folder ${folderId} was not found.`));
        }
      }
      let created = await service.createApplication({
        root,
        name: request.body.name,
        jobSource:
          request.body.jobUrl === undefined
            ? { kind: "pasted-text", text: request.body.jobText ?? "" }
            : { kind: "approved-url", url: request.body.jobUrl, approved: true },
        ...(request.body.language === undefined ? {} : { language: request.body.language }),
      });
      if (folderId !== undefined && folderId !== null) {
        created = await offered(
          service.moveApplication,
          "Moving an application",
        )({ root, applicationId: created.id, folderId });
      }
      return reply.code(201).send(applicationView(created));
    },
  );

  app.patch(
    "/v1/workspaces/:workspaceId/applications/:applicationId",
    {
      schema: {
        summary: "Rename, archive, restore or move a job application",
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
      if (request.body.folderId !== undefined) {
        view = await offered(
          service.moveApplication,
          "Moving an application",
        )({ root, applicationId, folderId: request.body.folderId });
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
    "/v1/workspaces/:workspaceId/applications/:applicationId/language",
    {
      schema: {
        summary: "Set or clear a job application's document language",
        description:
          "The language the application's new runs write its CV, cover letter and interview questions in. The default application always uses the workspace's language.",
        params: applicationParams,
        body: setLanguageBody,
        response: { 200: applicationViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      if ((await existing(workspaceId, applicationId, reply)) === undefined) return reply;
      return applicationView(
        await offered(
          service.setApplicationLanguage,
          "Choosing an application's language",
        )({
          root: workspaceRoot(workspaceId),
          applicationId,
          language: request.body.language,
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
