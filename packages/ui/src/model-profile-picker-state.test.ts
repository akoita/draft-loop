import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import { describe, expect, it } from "vitest";
import { createFixtureReviewState } from "./model.js";
import { projectModelProfileSupport } from "./model-profile-bridge.js";
import {
  modelProfileCatalog,
  modelProfileEntryForReference,
  modelProfileNotSupportedMessage,
  modelProfilePresetReferences,
  modelProfilePresets,
  modelProfileStartDisabledReason,
  modelProfileSupportUnavailableMessage,
  profileReferencesMatchPreflight,
  reviewActionWithModelProfiles,
  workspaceModelsForProfileReferences,
} from "./model-profile-picker-state.js";

const economyPreset = modelProfilePresets.find((preset) => preset.id === "economy");
if (economyPreset === undefined) throw new Error("The economy preset must be registered.");
const economy = modelProfilePresetReferences(economyPreset);
if (economy === null) throw new Error("The economy preset must resolve to registered profiles.");

function supportFor(
  supported: boolean,
  workspaceId = "workspace-1",
): ReturnType<typeof projectModelProfileSupport> {
  const result = projectModelProfileSupport(workspaceId, {
    anthropic: "api-key",
    openai: "api-key",
  });
  return {
    ...result,
    profiles: result.profiles.map((profile) => ({ ...profile, supported })),
  };
}

function stateWithPair(refs: ModelProfileReferences) {
  const fixture = createFixtureReviewState();
  const selection = workspaceModelsForProfileReferences(refs);
  if (selection === null) throw new Error("The exact profile pair must resolve.");
  return {
    ...fixture,
    providerTransmissionPreflight: {
      ...fixture.providerTransmissionPreflight,
      author: {
        ...fixture.providerTransmissionPreflight.author,
        ...{
          company: selection.authorCompany,
          model: selection.authorModel,
        },
      },
      critic: {
        ...fixture.providerTransmissionPreflight.critic,
        ...{
          company: selection.criticCompany,
          model: selection.criticModel,
        },
      },
    },
  };
}

describe("desktop model profile picker state", () => {
  it("resolves role-safe presets and maps exact profiles to workspace destinations", () => {
    expect(modelProfilePresets.map(({ id }) => id)).toEqual([
      "economy",
      "balanced",
      "standard",
      "development-glm",
      "development-gemini",
      "development-mistral",
    ]);
    expect(economy).toEqual({
      author: { id: "economy-anthropic-author", version: 2 },
      critic: { id: "economy-openai-critic", version: 1 },
    });
    expect(modelProfileEntryForReference(economy.author, "critic")).toBeUndefined();
    expect(workspaceModelsForProfileReferences(economy)).toEqual({
      authorCompany: "anthropic",
      authorModel: "claude-haiku-5-5",
      criticCompany: "openai",
      criticModel: "gpt-6-luna",
    });
    expect(modelProfileCatalog.every(({ profile }) => profile.roles.length > 0)).toBe(true);
    const gemini = {
      author: { id: "dev-google-gemini-author", version: 2 },
      critic: { id: "economy-openai-critic", version: 1 },
    };
    expect(workspaceModelsForProfileReferences(gemini)).toEqual({
      authorCompany: "google",
      authorModel: "gemini-3.8-flash",
      criticCompany: "openai",
      criticModel: "gpt-6-luna",
    });
    // Historical v1 is resumable but is no longer a current picker choice.
    expect(
      workspaceModelsForProfileReferences({
        ...gemini,
        author: { id: "dev-google-gemini-author", version: 1 },
      }),
    ).toBeNull();
  });

  it("blocks missing, failed, unsupported, stale, and pair-mismatched support safely", () => {
    const applied = { workspaceId: "workspace-1", generation: 4, refs: economy };
    const fixture = stateWithPair(economy);
    const ready = {
      status: "ready" as const,
      workspaceId: "workspace-1",
      generation: 4,
      result: supportFor(true),
    };
    expect(
      modelProfileStartDisabledReason(
        applied,
        "workspace-1",
        4,
        ready,
        fixture.providerTransmissionPreflight,
      ),
    ).toBeNull();
    expect(
      modelProfileStartDisabledReason(
        applied,
        "workspace-1",
        4,
        { status: "unavailable", workspaceId: "workspace-1", generation: 4 },
        fixture.providerTransmissionPreflight,
      ),
    ).toBe(modelProfileSupportUnavailableMessage);
    expect(
      modelProfileStartDisabledReason(
        applied,
        "workspace-1",
        4,
        { ...ready, result: supportFor(false) },
        fixture.providerTransmissionPreflight,
      ),
    ).toBe(modelProfileNotSupportedMessage);
    expect(
      modelProfileStartDisabledReason(
        applied,
        "workspace-1",
        5,
        ready,
        fixture.providerTransmissionPreflight,
      ),
    ).toBe(modelProfileSupportUnavailableMessage);
    expect(
      modelProfileStartDisabledReason(
        applied,
        "workspace-1",
        4,
        { ...ready, workspaceId: "other" },
        fixture.providerTransmissionPreflight,
      ),
    ).toBe(modelProfileSupportUnavailableMessage);

    const wrongPair = {
      ...fixture.providerTransmissionPreflight,
      critic: { ...fixture.providerTransmissionPreflight.critic, model: "different-model" },
    };
    expect(modelProfileStartDisabledReason(applied, "workspace-1", 4, ready, wrongPair)).toContain(
      "no longer match",
    );
    expect(profileReferencesMatchPreflight(economy, wrongPair)).toBe(false);
  });

  it("keeps legacy starts unchanged and merges exact refs without affecting resume or candidate profile", () => {
    expect(reviewActionWithModelProfiles({ type: "start" }, null)).toEqual({ type: "start" });
    expect(
      reviewActionWithModelProfiles(
        {
          type: "start",
          candidateProfile: { profileId: "candidate-1", version: 3 },
        },
        economy,
      ),
    ).toEqual({
      type: "start",
      candidateProfile: { profileId: "candidate-1", version: 3 },
      modelProfiles: economy,
    });
    expect(reviewActionWithModelProfiles({ type: "resume" }, economy)).toEqual({
      type: "resume",
    });
  });
});
