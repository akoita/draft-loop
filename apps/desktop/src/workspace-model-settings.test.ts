import { describe, expect, it } from "vitest";

import { createFixtureReviewState } from "./model.js";
import {
  workspaceModelSettingsBlocker,
  workspaceModelSettingsDraft,
  workspaceModelSettingsInput,
} from "./workspace-model-settings.js";

describe("desktop workspace model settings", () => {
  it("starts from the current preflight identities, not prior-run exposure", () => {
    const state = createFixtureReviewState();
    const draft = workspaceModelSettingsDraft({
      ...state,
      providerExposure: {
        ...state.providerExposure,
        author: { company: "local", model: "older-author" },
        critic: { company: "anthropic", model: "older-critic" },
      },
    });

    expect(draft).toEqual({
      authorCompany: "anthropic",
      authorModel: "claude-sonnet-4-5",
      criticCompany: "openai",
      criticModel: "gpt-5",
      localEndpoint: "",
      independenceOverrideRationale: "",
    });
  });

  it("keeps an exact local loopback endpoint only when the preflight pair uses local", () => {
    const state = createFixtureReviewState();
    const local = workspaceModelSettingsDraft({
      ...state,
      providerTransmissionPreflight: {
        ...state.providerTransmissionPreflight,
        author: {
          ...state.providerTransmissionPreflight.author,
          company: "local",
          model: "  local-model-id  ",
          endpoint: "http://127.0.0.1:8080/v1",
        },
      },
    });
    const invalidEndpoint = workspaceModelSettingsDraft({
      ...state,
      providerTransmissionPreflight: {
        ...state.providerTransmissionPreflight,
        author: {
          ...state.providerTransmissionPreflight.author,
          company: "local",
          endpoint: "local fixture (no network)",
        },
      },
    });

    expect(local.localEndpoint).toBe("http://127.0.0.1:8080/v1");
    expect(local.authorModel).toBe("  local-model-id  ");
    expect(invalidEndpoint.localEndpoint).toBe("");
  });

  it("builds a validated full replacement and requires rationale for a shared lineage", () => {
    const state = createFixtureReviewState();
    const draft = {
      ...workspaceModelSettingsDraft(state),
      authorModel: "  private/author:v2 ",
      criticModel: "private/critic:v3",
    };
    const sharedPreview = {
      status: "ready" as const,
      result: { lineagesDistinct: false },
    };

    expect(workspaceModelSettingsBlocker(draft, sharedPreview)).toBe(
      "Record why one lineage on both sides is acceptable before saving model settings.",
    );
    expect(workspaceModelSettingsInput(draft, sharedPreview)).toBeNull();
    expect(
      workspaceModelSettingsInput(
        { ...draft, independenceOverrideRationale: " reviewed same lineage " },
        sharedPreview,
      ),
    ).toEqual({
      authorCompany: "anthropic",
      authorModel: "private/author:v2",
      criticCompany: "openai",
      criticModel: "private/critic:v3",
      independenceOverrideRationale: "reviewed same lineage",
    });
    expect(
      workspaceModelSettingsInput(
        { ...draft, authorCompany: "local", localEndpoint: "http://127.0.0.1:8080/v1" },
        { status: "idle" },
      ),
    ).toMatchObject({ localEndpoint: "http://127.0.0.1:8080/v1" });
  });

  it("rejects an incomplete pair with fixed renderer copy", () => {
    const draft = {
      ...workspaceModelSettingsDraft(createFixtureReviewState()),
      criticModel: "  ",
    };

    expect(workspaceModelSettingsBlocker(draft, { status: "idle" })).toBe(
      "Name an author model and a critic model before saving model settings.",
    );
    expect(workspaceModelSettingsInput(draft, { status: "idle" })).toBeNull();
  });
});
