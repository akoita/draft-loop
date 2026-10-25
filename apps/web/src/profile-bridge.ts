import {
  type BridgeCommand,
  canonicalCandidateProfileGenerationCancelledMessage,
} from "@draft-loop/ui/bridge";
import { projectReviewedCanonicalCandidateProfileCatalog } from "@draft-loop/ui/profile-catalog-projection";
import { projectProfileFreshness } from "@draft-loop/ui/profile-freshness-projection";
import { projectCanonicalCandidateProfileRecord } from "@draft-loop/ui/profile-projection";

import { type ApiClient, type ApiInput, ApiRequestError, type ApiSchemas } from "./api-client.js";
import { refuse } from "./bridge-refusal.js";

/** The career profile commands the hosted service serves, in the port's order. */
export const hostedProfileCapabilities = [
  "profile.derive",
  "profile.progress",
  "profile.cancel",
  "profile.get",
  "profile.list",
  "profile.freshness",
  "profile.edit",
  "profile.review",
  "profile.catalog",
] as const;

type ProfileCommandType = (typeof hostedProfileCapabilities)[number];
export type ProfileCommand = Extract<BridgeCommand, { type: ProfileCommandType }>;

export function isProfileCommand(command: BridgeCommand): command is ProfileCommand {
  return (hostedProfileCapabilities as readonly string[]).includes(command.type);
}

export interface ProfileAnswerOptions {
  /** How long to wait between reads of a running derivation. Defaults to two seconds. */
  readonly pollMs?: number;
  /** Waits between reads; a timer when unset, replaced in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultPollMs = 2_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Why a hosted derivation ended without a version, in the desktop's words where it has them. */
function derivationFailure(state: ApiSchemas["CareerProfileDerivation"]): never {
  if (state.status === "cancelled")
    return refuse(canonicalCandidateProfileGenerationCancelledMessage);
  if (state.status !== "failed") return refuse("The career profile could not be derived.");
  if (state.reason === "consent-required") {
    return refuse(
      "The candidate's consent does not cover sending this evidence to the workspace's providers.",
    );
  }
  if (state.reason === "record-erased") return refuse("This candidate record was erased.");
  return refuse(state.message ?? "The career profile could not be derived. Try again.");
}

/**
 * Answers the career profile commands over the profile routes (ADR 0011, D9), in the desktop
 * host's shapes and through the same projections. A derivation runs on the worker: the answer
 * waits for it as the desktop's own call waits, reading its progress between waits, so the screens'
 * progress and cancel work unchanged.
 */
export function createProfileAnswers(client: ApiClient, options: ProfileAnswerOptions = {}) {
  const sleep = options.sleep ?? wait;
  const pollMs = options.pollMs ?? defaultPollMs;
  const project = (workspaceId: string, record: unknown, profileId?: string) =>
    projectCanonicalCandidateProfileRecord(workspaceId, record, refuse, profileId);
  const profilePath = (workspaceId: string, profileId: string) => ({
    path: { workspaceId, profileId },
  });
  const derivation = async (workspaceId: string, profileId: string) => {
    try {
      return await client.call(
        "GET /v1/workspaces/{workspaceId}/profiles/{profileId}/derivation",
        profilePath(workspaceId, profileId),
      );
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return undefined;
      throw error;
    }
  };

  return async (command: ProfileCommand): Promise<unknown> => {
    switch (command.type) {
      case "profile.derive": {
        const { workspaceId, profileId } = command.input;
        await client.call("POST /v1/workspaces/{workspaceId}/profiles/{profileId}/derivation", {
          ...profilePath(workspaceId, profileId),
          body: {
            providerDataApproved: command.input.providerTransmissionApproved === true,
            ...(command.input.fullExtraction === true ? { fullExtraction: true } : {}),
          },
        });
        for (;;) {
          const state = await derivation(workspaceId, profileId);
          if (state?.status === "derived") {
            const record = await client.call(
              "GET /v1/workspaces/{workspaceId}/profiles/{profileId}",
              { ...profilePath(workspaceId, profileId), query: { version: state.version } },
            );
            return project(workspaceId, record, profileId);
          }
          if (state === undefined || state.status !== "pending") {
            return derivationFailure(state ?? { status: "failed", reason: "failed" });
          }
          await sleep(pollMs);
        }
      }
      case "profile.progress": {
        const { workspaceId, profileId } = command.input;
        const state = await derivation(workspaceId, profileId);
        if (state?.status !== "pending") return { active: false };
        if (!state.started) return { active: true, queued: true };
        return {
          active: true,
          ...(state.completedCalls === undefined || state.plannedCalls === undefined
            ? {}
            : { completedCalls: state.completedCalls, plannedCalls: state.plannedCalls }),
        };
      }
      case "profile.cancel": {
        const { workspaceId, profileId } = command.input;
        return client.call(
          "DELETE /v1/workspaces/{workspaceId}/profiles/{profileId}/derivation",
          profilePath(workspaceId, profileId),
        );
      }
      case "profile.get": {
        const { workspaceId, profileId, version } = command.input;
        const record = await client.call("GET /v1/workspaces/{workspaceId}/profiles/{profileId}", {
          ...profilePath(workspaceId, profileId),
          ...(version === undefined ? {} : { query: { version } }),
        });
        return project(workspaceId, record, profileId);
      }
      case "profile.list": {
        const { workspaceId, profileId } = command.input;
        const { versions } = await client.call(
          "GET /v1/workspaces/{workspaceId}/profiles/{profileId}/versions",
          profilePath(workspaceId, profileId),
        );
        return {
          workspaceId,
          profileId,
          versions: versions.map((record) => project(workspaceId, record, profileId)),
        };
      }
      case "profile.freshness": {
        const { workspaceId, profileId } = command.input;
        const freshness = await client.call(
          "GET /v1/workspaces/{workspaceId}/profiles/{profileId}/freshness",
          profilePath(workspaceId, profileId),
        );
        return projectProfileFreshness(workspaceId, profileId, freshness);
      }
      case "profile.edit": {
        const { workspaceId, profileId, expectedVersion, patch } = command.input;
        type Body = ApiInput<"PATCH /v1/workspaces/{workspaceId}/profiles/{profileId}">["body"];
        const record = await client.call(
          "PATCH /v1/workspaces/{workspaceId}/profiles/{profileId}",
          {
            ...profilePath(workspaceId, profileId),
            // The port's patch is the API's: facts and issues, which the service validates again.
            body: { expectedVersion, patch: patch as Body["patch"] },
          },
        );
        return project(workspaceId, record, profileId);
      }
      case "profile.review": {
        const { workspaceId, profileId, expectedVersion } = command.input;
        const record = await client.call(
          "POST /v1/workspaces/{workspaceId}/profiles/{profileId}/review",
          { ...profilePath(workspaceId, profileId), body: { expectedVersion } },
        );
        return project(workspaceId, record, profileId);
      }
      case "profile.catalog": {
        const { workspaceId } = command.input;
        const { versions } = await client.call("GET /v1/workspaces/{workspaceId}/profiles", {
          path: { workspaceId },
        });
        return projectReviewedCanonicalCandidateProfileCatalog(
          workspaceId,
          versions,
          (record) => project(workspaceId, record),
          { includeDrafts: command.input.includeDrafts === true },
        );
      }
    }
  };
}
