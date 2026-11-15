import {
  type MemberDisplayMode,
  type MemberSettingsStore,
  memberDisplayModes,
} from "@draft-loop/storage/member-settings";
import { TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

const modeSchema = z.enum(memberDisplayModes as unknown as [MemberDisplayMode]);

const preferenceFields = {
  mode: modeSchema
    .nullable()
    .describe(
      "guided walks through one step at a time; standard is the simple view; everything opens every Advanced options section. null: never chosen.",
    ),
  guideHidden: z.boolean().describe("True once the member hid the Getting started guide."),
};

const displayPreferenceSchema = z.object(preferenceFields).meta({ id: "MemberDisplayPreference" });

const displayPreferenceBody = z.strictObject(preferenceFields);

const ownerTokenNote =
  "Owner-token mode has no members, so the screen keeps the browser's saved choice: the route answers 404 there.";

/** The caller's own display preference (#2788), read after sign-in and saved when they change it. */
export function registerDisplayPreferenceRoutes(
  parent: FastifyInstance,
  memberSettings: MemberSettingsStore,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/v1/me/display-preference",
    {
      schema: {
        summary: "Read how the screens show themselves to the caller",
        description: ownerTokenNote,
        response: { 200: displayPreferenceSchema, 401: apiErrorSchema, 404: apiErrorSchema },
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
      return memberSettings.readDisplayPreference({
        organisationId: caller.tenantId,
        memberId: caller.memberId,
      });
    },
  );

  app.put(
    "/v1/me/display-preference",
    {
      schema: {
        summary: "Save how the screens show themselves to the caller, on every browser and device",
        description: ownerTokenNote,
        body: displayPreferenceBody,
        response: {
          200: displayPreferenceSchema,
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
      const preference = request.body;
      try {
        await memberSettings.saveDisplayPreference({
          organisationId: caller.tenantId,
          memberId: caller.memberId,
          preference,
        });
      } catch (error) {
        if (error instanceof TenantDirectoryError && error.code === "member_not_found") {
          return reply.code(404).send(apiError("not_found", "No such member."));
        }
        throw error;
      }
      return preference;
    },
  );
}
