import {
  type MemberScreenLanguage,
  type MemberSettingsStore,
  memberScreenLanguages,
} from "@draft-loop/storage/member-settings";
import { TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

export interface MemberSettingsRoutesOptions {
  /** Each member's own settings, kept with the member (#2373). */
  readonly memberSettings: MemberSettingsStore;
}

const languageSchema = z.enum(memberScreenLanguages as unknown as [MemberScreenLanguage]);

const screenLanguageSchema = z
  .object({
    language: languageSchema
      .nullable()
      .describe("The member's saved screen language; null when they never chose one."),
  })
  .meta({ id: "MemberScreenLanguage" });

const screenLanguageBody = z.strictObject({ language: languageSchema });

const ownerTokenNote =
  "Owner-token mode has no members, so the screen keeps the browser's saved choice: the route answers 404 there.";

/** The caller's own screen language, read after sign-in and saved when they change it. */
export function registerMemberSettingsRoutes(
  parent: FastifyInstance,
  options: MemberSettingsRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { memberSettings } = options;

  app.get(
    "/v1/me/screen-language",
    {
      schema: {
        summary: "Read the caller's saved screen language",
        description: ownerTokenNote,
        response: { 200: screenLanguageSchema, 401: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { caller } = request;
      if (caller === undefined) {
        return reply.code(401).send(apiError("unauthorized", "A credential is required."));
      }
      if (caller.kind !== "member") {
        return reply.code(404).send(apiError("not_found", "No such route."));
      }
      const language = await memberSettings.readScreenLanguage({
        organisationId: caller.tenantId,
        memberId: caller.memberId,
      });
      return { language: language ?? null };
    },
  );

  app.put(
    "/v1/me/screen-language",
    {
      schema: {
        summary: "Save the caller's screen language for every browser and device",
        description: ownerTokenNote,
        body: screenLanguageBody,
        response: {
          200: screenLanguageSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { caller } = request;
      if (caller === undefined) {
        return reply.code(401).send(apiError("unauthorized", "A credential is required."));
      }
      if (caller.kind !== "member") {
        return reply.code(404).send(apiError("not_found", "No such route."));
      }
      const { language } = request.body;
      try {
        await memberSettings.saveScreenLanguage({
          organisationId: caller.tenantId,
          memberId: caller.memberId,
          language,
        });
      } catch (error) {
        if (error instanceof TenantDirectoryError && error.code === "member_not_found") {
          return reply.code(404).send(apiError("not_found", "No such member."));
        }
        throw error;
      }
      return { language };
    },
  );
}
