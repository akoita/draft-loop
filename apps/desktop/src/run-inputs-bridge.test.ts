import { describe, expect, it } from "vitest";

import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import { createFixtureReviewState } from "./model.js";
import { type RunInputsView, runInputsKeys } from "./run-inputs.js";

/*
 * Drift proof: a real run-inputs payload goes through the real review-state validator, so a
 * field added to the interface but not to the runtime allowlist fails here instead of in the app.
 * The review state's own key list must name `runInputs` too, or the whole state is rejected.
 */

const runInputs: RunInputsView = {
  brief: { briefId: "target-role", version: 3 },
  profile: { profileId: "profile-1", version: 2 },
};

function loadReview(value: unknown) {
  const fixture = createFixtureReviewState();
  const bridge: NativeBridge = {
    capabilities: ["review.load"],
    invoke: async () => ({ ok: true, value }) as never,
  };
  return createCapabilityPort(bridge).execute({
    type: "review.load",
    input: { workspaceId: fixture.workspaceId },
  });
}

describe("review state run inputs over the bridge", () => {
  it("accepts a real run-inputs payload unchanged, and one with no brief or profile", async () => {
    for (const recorded of [
      runInputs,
      { brief: null, profile: null },
      { brief: runInputs.brief, profile: null },
    ]) {
      const state = { ...createFixtureReviewState(), runInputs: recorded };
      await expect(loadReview(state)).resolves.toEqual({ ok: true, value: state });
    }
  });

  it("accepts null run inputs and a state that predates the field", async () => {
    const fixture = createFixtureReviewState();
    await expect(loadReview({ ...fixture, runInputs: null })).resolves.toEqual({
      ok: true,
      value: { ...fixture, runInputs: null },
    });
    await expect(loadReview(fixture)).resolves.toEqual({ ok: true, value: fixture });
  });

  it("rejects an unexpected key, a missing key and a malformed version at every level", async () => {
    const fixture = createFixtureReviewState();
    const malformed: readonly unknown[] = [
      { ...runInputs, path: "/home/user" },
      { brief: runInputs.brief },
      { ...runInputs, brief: { ...runInputs.brief, checksum: "a".repeat(64) } },
      { ...runInputs, profile: { ...runInputs.profile, path: "/home/user" } },
      { ...runInputs, brief: { briefId: "target-role", version: 0 } },
      { ...runInputs, brief: { briefId: "", version: 1 } },
      { ...runInputs, profile: { profileId: "profile-1", version: 1.5 } },
      "v3",
    ];
    for (const candidate of malformed) {
      await expect(loadReview({ ...fixture, runInputs: candidate })).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  it("names exactly the interface's keys", () => {
    expect([...runInputsKeys].sort()).toEqual(["brief", "profile"]);
  });
});
