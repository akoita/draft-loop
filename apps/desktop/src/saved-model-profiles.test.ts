import { describe, expect, it, vi } from "vitest";

import type { SavedModelProfilesResult } from "./model-profile-bridge.js";
import {
  ModelProfileSaveError,
  modelProfileApplyErrorMessage,
  modelProfileWarning,
  noModelProfilesWarning,
  type SavedModelProfilesState,
  savedModelProfilesNotice,
} from "./model-profile-picker-state.js";
import {
  appliedSelectionFromSaved,
  clearSavedModelProfiles,
  loadSavedModelProfilesState,
  saveAppliedModelProfiles,
} from "./saved-model-profiles.js";

const references = {
  author: { id: "legacy-anthropic-author", version: 1 },
  critic: { id: "legacy-openai-critic", version: 1 },
};

function result(overrides: Partial<SavedModelProfilesResult> = {}): SavedModelProfilesResult {
  return {
    workspaceId: "workspace-1",
    modelProfiles: references,
    appliedAt: "2026-01-01T00:00:00.000Z",
    ignoredReason: null,
    ...overrides,
  };
}

const none = result({ modelProfiles: null, appliedAt: null });

describe("desktop saved model profiles", () => {
  it("starts a reopened workspace from the saved pair", async () => {
    const port = { readSavedModelProfiles: vi.fn(async () => result()) };
    const loaded = await loadSavedModelProfilesState(port, "workspace-1", 3);

    expect(loaded).toEqual({
      status: "ready",
      workspaceId: "workspace-1",
      generation: 3,
      result: result(),
    });
    expect(appliedSelectionFromSaved(loaded)).toEqual({
      workspaceId: "workspace-1",
      generation: 3,
      refs: references,
    });
    expect(
      modelProfileWarning(appliedSelectionFromSaved(loaded), loaded, "workspace-1", 3),
    ).toBeNull();
  });

  it("warns that no profiles are attached when nothing is saved", async () => {
    const loaded = await loadSavedModelProfilesState(
      { readSavedModelProfiles: async () => none },
      "workspace-1",
      1,
    );

    expect(appliedSelectionFromSaved(loaded)).toBeNull();
    expect(modelProfileWarning(null, loaded, "workspace-1", 1)).toBe(noModelProfilesWarning);
    expect(noModelProfilesWarning).toBe(
      "No model profiles: provider defaults, unknown context windows.",
    );
    expect(savedModelProfilesNotice(loaded, "workspace-1", 1)).toBeNull();
  });

  it("does not warn while loading, without the capability, or for another workspace", async () => {
    const loading: SavedModelProfilesState = {
      status: "loading",
      workspaceId: "workspace-1",
      generation: 1,
    };
    expect(modelProfileWarning(null, loading, "workspace-1", 1)).toBeNull();
    expect(modelProfileWarning(null, { status: "idle" }, "workspace-1", 1)).toBeNull();
    expect(await loadSavedModelProfilesState({}, "workspace-1", 1)).toEqual({ status: "idle" });
    const ready = await loadSavedModelProfilesState(
      { readSavedModelProfiles: async () => none },
      "workspace-1",
      1,
    );
    expect(modelProfileWarning(null, ready, "workspace-1", 2)).toBeNull();
    expect(modelProfileWarning(null, ready, "workspace-2", 1)).toBeNull();
  });

  it("does not apply an ignored pair and says why", async () => {
    const reason = "the critic profile legacy-openai-critic@1 is for openai/gpt-5.6-luna";
    const loaded = await loadSavedModelProfilesState(
      { readSavedModelProfiles: async () => result({ ignoredReason: reason }) },
      "workspace-1",
      1,
    );

    expect(appliedSelectionFromSaved(loaded)).toBeNull();
    const notice = savedModelProfilesNotice(loaded, "workspace-1", 1);
    expect(notice).toContain("author legacy-anthropic-author@1; critic legacy-openai-critic@1");
    expect(notice).toContain(reason);
    expect(modelProfileWarning(null, loaded, "workspace-1", 1)).toContain(noModelProfilesWarning);
  });

  it("reports an unreadable or invalid saved pair instead of treating it as empty", async () => {
    for (const read of [
      async () => {
        throw new Error("The workspace model profile selection file is unreadable or invalid.");
      },
      async () => result({ workspaceId: "other" }),
    ]) {
      const loaded = await loadSavedModelProfilesState(
        { readSavedModelProfiles: read },
        "workspace-1",
        1,
      );
      expect(loaded).toEqual({ status: "unavailable", workspaceId: "workspace-1", generation: 1 });
      expect(appliedSelectionFromSaved(loaded)).toBeNull();
      expect(savedModelProfilesNotice(loaded, "workspace-1", 1)).toContain("could not be read");
      expect(modelProfileWarning(null, loaded, "workspace-1", 1)).toContain(noModelProfilesWarning);
    }
  });

  it("saves the exact pair and returns what the host confirmed", async () => {
    const saveModelProfiles = vi.fn(async () => result());
    await expect(
      saveAppliedModelProfiles({ saveModelProfiles }, "workspace-1", references),
    ).resolves.toEqual(result());
    expect(saveModelProfiles).toHaveBeenCalledWith("workspace-1", references);
  });

  it("does not treat a failed or contradicted save as applied", async () => {
    const failed = saveAppliedModelProfiles(
      {
        saveModelProfiles: async () => {
          throw new Error("The model profiles were not applied: the critic is another model.");
        },
      },
      "workspace-1",
      references,
    );
    await expect(failed).rejects.toBeInstanceOf(ModelProfileSaveError);
    await expect(failed).rejects.toThrow("the critic is another model");
    await expect(failed).rejects.toThrow("It is not applied.");

    for (const confirmed of [
      none,
      result({ ignoredReason: "stale" }),
      result({ modelProfiles: { ...references, critic: { id: "other", version: 1 } } }),
    ]) {
      await expect(
        saveAppliedModelProfiles(
          { saveModelProfiles: async () => confirmed },
          "workspace-1",
          references,
        ),
      ).rejects.toBeInstanceOf(ModelProfileSaveError);
    }
    await expect(saveAppliedModelProfiles({}, "workspace-1", references)).rejects.toBeInstanceOf(
      ModelProfileSaveError,
    );
  });

  it("shows the save failure reason in the dialog and a generic message otherwise", () => {
    expect(modelProfileApplyErrorMessage(new ModelProfileSaveError("Disk full."))).toContain(
      "Disk full.",
    );
    expect(modelProfileApplyErrorMessage(new Error("boom"))).toBe(
      "The profile pair could not be applied. Your draft is unchanged.",
    );
  });

  it("clears the saved pair with a null save", async () => {
    const saveModelProfiles = vi.fn(async () => none);
    await expect(clearSavedModelProfiles({ saveModelProfiles }, "workspace-1")).resolves.toEqual(
      none,
    );
    expect(saveModelProfiles).toHaveBeenCalledWith("workspace-1", null);
  });
});
