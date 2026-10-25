import type { ApplicationService, CanonicalCandidateProfilePatch } from "@draft-loop/application";
import type { ProfileDerivationState } from "@draft-loop/run-queue";
import {
  canonicalCandidateProfileFactSchema,
  canonicalCandidateProfileIssueSchema,
  canonicalCandidateProfileSchema,
} from "@draft-loop/schemas";
import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import { ProfileDerivationUnavailableError, refusingProfileRules } from "./profile-errors.js";

/** One profile of one workspace, as the API addresses it. */
export interface ProfileDerivationAddress {
  readonly workspaceId: string;
  readonly profileId: string;
}

/** The worker's derivation of career profiles (ADR 0011, D9), as the API queues and reads it. */
export interface ProfileDerivations {
  /** Queues the derivation; false when one for the same profile already waits or runs. */
  readonly queue: (
    job: ProfileDerivationAddress & {
      readonly providerDataApproved: boolean;
      readonly fullExtraction?: boolean;
    },
  ) => Promise<boolean>;
  /** Where the profile's newest derivation stands; undefined when none was ever queued. */
  readonly state: (
    address: ProfileDerivationAddress,
  ) => Promise<ProfileDerivationState | undefined>;
  /** Cancels the profile's waiting or running derivation; false when none was. */
  readonly cancel: (address: ProfileDerivationAddress) => Promise<boolean>;
}

/** A deployment that derives nothing on a worker: a start is refused, and nothing is running. */
export const noProfileDerivations: ProfileDerivations = {
  queue: async () => {
    throw new ProfileDerivationUnavailableError();
  },
  state: async () => undefined,
  cancel: async () => false,
};

export interface ProfileRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly derivations: ProfileDerivations;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const workspaceParams = z.strictObject({ workspaceId: identifierSchema });
const profileParams = workspaceParams.extend({ profileId: identifierSchema });
const versionQuery = z.strictObject({ version: z.coerce.number().int().positive().optional() });

const deriveBody = z.strictObject({
  providerDataApproved: z
    .boolean()
    .describe(
      "The person approved sending the selected career evidence to the workspace's author company. Without it, a live workspace's derivation is refused.",
    ),
  fullExtraction: z
    .boolean()
    .optional()
    .describe("Extract every source again instead of only new or changed ones."),
});

const editBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  patch: z
    .strictObject({
      facts: z.array(canonicalCandidateProfileFactSchema).optional(),
      issues: z.array(canonicalCandidateProfileIssueSchema).optional(),
    })
    .describe("The facts and issues that replace the latest version's; nothing else is editable."),
});

const reviewBody = z.strictObject({ expectedVersion: z.number().int().positive() });

export const profileViewSchema = z
  .object({
    workspaceId: z.string(),
    checksum: z.string(),
    profile: canonicalCandidateProfileSchema,
  })
  .meta({ id: "CareerProfile" });

function profileView(
  record: CanonicalCandidateProfileVersionRecord,
): z.infer<typeof profileViewSchema> {
  return { workspaceId: record.workspaceId, checksum: record.checksum, profile: record.profile };
}

const profileVersionsSchema = z
  .object({ versions: z.array(profileViewSchema) })
  .meta({ id: "CareerProfileVersions" });

export const profileDerivationViewSchema = z
  .discriminatedUnion("status", [
    z.object({
      status: z.literal("pending"),
      completedCalls: z.number().int().optional(),
      plannedCalls: z.number().int().optional(),
    }),
    z.object({ status: z.literal("derived"), version: z.number().int() }),
    z.object({ status: z.literal("cancelled") }),
    z.object({
      status: z.literal("failed"),
      reason: z.enum(["failed", "consent-required", "record-erased"]),
      message: z
        .string()
        .optional()
        .describe("A fixed sentence the person can act on; absent for any other failure."),
    }),
  ])
  .describe(
    "Where the profile's newest derivation stands. Progress counts provider calls and is present once the worker planned them.",
  )
  .meta({ id: "CareerProfileDerivation" });

const freshnessSchema = z
  .discriminatedUnion("state", [
    z.object({ state: z.literal("not-generated") }),
    z.object({ state: z.literal("up-to-date"), version: z.number().int() }),
    z.object({
      state: z.literal("update-available"),
      version: z.number().int(),
      newSourceCount: z.number().int(),
      changedSourceCount: z.number().int(),
      removedSourceCount: z.number().int(),
    }),
    z.object({
      state: z.literal("review-pending"),
      version: z.number().int(),
      reviewedVersion: z.number().int().optional(),
    }),
    z.object({ state: z.literal("unavailable"), version: z.number().int() }),
  ])
  .describe("Whether the profile is current with the career evidence: a state and counts only.")
  .meta({ id: "CareerProfileFreshness" });

const notFound = apiError("not_found", "No such career profile.");
const errorResponses = { 400: apiErrorSchema, 404: apiErrorSchema, 422: apiErrorSchema };

/**
 * The career profile through the API (ADR 0011, D9): derivation queued on the worker with its
 * progress and cancel, then read, edit and review through `ApplicationService`, as the desktop's
 * profile screens do. The service decides; these routes validate, address and project.
 */
export function registerProfileRoutes(
  parent: FastifyInstance,
  options: ProfileRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, derivations } = options;

  app.get(
    "/v1/workspaces/:workspaceId/profiles",
    {
      schema: {
        summary: "List every career profile version of a workspace",
        description:
          "Every saved version of every profile, oldest first per profile: the shared screens build the reviewed-profile catalog a run chooses from out of it.",
        params: workspaceParams,
        response: { 200: profileVersionsSchema, ...errorResponses },
      },
    },
    async (request) => ({
      versions: (
        await service.listCanonicalCandidateProfileVersions({
          root: workspaceRoot(request.params.workspaceId),
        })
      ).map(profileView),
    }),
  );

  app.get(
    "/v1/workspaces/:workspaceId/profiles/:profileId",
    {
      schema: {
        summary: "Read a career profile, latest or at one version",
        params: profileParams,
        querystring: versionQuery,
        response: { 200: profileViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const record = await service.getCanonicalCandidateProfile({
        root: workspaceRoot(request.params.workspaceId),
        profileId: request.params.profileId,
        ...(request.query.version === undefined ? {} : { version: request.query.version }),
      });
      if (record === undefined) return reply.code(404).send(notFound);
      return profileView(record);
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/profiles/:profileId/versions",
    {
      schema: {
        summary: "List a career profile's versions",
        params: profileParams,
        response: { 200: profileVersionsSchema, ...errorResponses },
      },
    },
    async (request) => ({
      versions: (
        await service.listCanonicalCandidateProfileVersions({
          root: workspaceRoot(request.params.workspaceId),
          profileId: request.params.profileId,
        })
      ).map(profileView),
    }),
  );

  app.patch(
    "/v1/workspaces/:workspaceId/profiles/:profileId",
    {
      schema: {
        summary: "Edit a career profile, saving a new draft version",
        description:
          "Replaces the latest version's facts or issues and saves the result as a new draft. A stale expectedVersion answers 409.",
        params: profileParams,
        body: editBody,
        response: { 200: profileViewSchema, 409: apiErrorSchema, ...errorResponses },
      },
    },
    async (request) => {
      const { facts, issues } = request.body.patch;
      return profileView(
        await refusingProfileRules(
          service.editCanonicalCandidateProfile({
            root: workspaceRoot(request.params.workspaceId),
            profileId: request.params.profileId,
            expectedVersion: request.body.expectedVersion,
            // The service validates the patch again and brands its ids, as the desktop relies on.
            patch: {
              ...(facts === undefined ? {} : { facts }),
              ...(issues === undefined ? {} : { issues }),
            } as unknown as CanonicalCandidateProfilePatch,
          }),
        ),
      );
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/profiles/:profileId/review",
    {
      schema: {
        summary: "Mark a career profile's latest draft reviewed",
        description:
          "Saves the latest draft as a reviewed version, which a run can then bind. A stale expectedVersion, or a latest version that is not a draft, answers 409; open issues answer 422 profile_rule until each is acknowledged or resolved.",
        params: profileParams,
        body: reviewBody,
        response: { 200: profileViewSchema, 409: apiErrorSchema, ...errorResponses },
      },
    },
    async (request) =>
      profileView(
        await refusingProfileRules(
          service.reviewCanonicalCandidateProfile({
            root: workspaceRoot(request.params.workspaceId),
            profileId: request.params.profileId,
            expectedVersion: request.body.expectedVersion,
          }),
        ),
      ),
  );

  app.get(
    "/v1/workspaces/:workspaceId/profiles/:profileId/freshness",
    {
      schema: {
        summary: "Say whether a career profile is current with the career evidence",
        params: profileParams,
        response: { 200: freshnessSchema, ...errorResponses },
      },
    },
    async (request) => {
      const freshness = service.getCandidateProfileFreshness;
      if (freshness === undefined) throw new Error("The service cannot read profile freshness.");
      return freshness({
        root: workspaceRoot(request.params.workspaceId),
        profileId: request.params.profileId,
      });
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/profiles/:profileId/derivation",
    {
      schema: {
        summary: "Derive a career profile from the workspace's selected evidence",
        description:
          "Queues the derivation for a worker, which saves the next profile version; poll the derivation for its progress and outcome. A fixture workspace calls no model. One derivation runs per profile at a time: another answers 409 derivation_running. In sign-in mode the candidate record needs a current provider transmission consent (409 transmission_consent_required).",
        params: profileParams,
        body: deriveBody,
        response: { 202: profileDerivationViewSchema, 409: apiErrorSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      // An unknown workspace answers 404 here rather than failing on the worker.
      await service.readWorkspace(workspaceRoot(request.params.workspaceId));
      const queued = await derivations.queue({
        workspaceId: request.params.workspaceId,
        profileId: request.params.profileId,
        providerDataApproved: request.body.providerDataApproved,
        ...(request.body.fullExtraction === true ? { fullExtraction: true } : {}),
      });
      if (!queued) {
        return reply
          .code(409)
          .send(apiError("derivation_running", "This profile's derivation is already running."));
      }
      return reply.code(202).send({ status: "pending" as const });
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/profiles/:profileId/derivation",
    {
      schema: {
        summary: "Read where a career profile's newest derivation stands",
        params: profileParams,
        response: { 200: profileDerivationViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const state = await derivations.state(request.params);
      if (state === undefined) {
        return reply.code(404).send(apiError("not_found", "No derivation of this profile."));
      }
      return state;
    },
  );

  app.delete(
    "/v1/workspaces/:workspaceId/profiles/:profileId/derivation",
    {
      schema: {
        summary: "Cancel a career profile's waiting or running derivation",
        description:
          "A running derivation stops before its next provider call and saves no version. cancelled is false when none was waiting or running.",
        params: profileParams,
        response: {
          200: z.object({ cancelled: z.boolean() }).meta({ id: "CareerProfileCancel" }),
          ...errorResponses,
        },
      },
    },
    async (request) => ({ cancelled: await derivations.cancel(request.params) }),
  );
}
