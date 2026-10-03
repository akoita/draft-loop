import { describe, expect, it } from "vitest";
import { createFixtureReviewState } from "./model.js";
import { workspaceModelEditorDraftFromState } from "./workspace-model-editor.js";

describe("workspace model editor entry", () => {
  it("initializes from the loaded workspace rather than a stale prior draft", () => {
    const loaded = {
      ...createFixtureReviewState(),
      providerTransmissionPreflight: {
        ...createFixtureReviewState().providerTransmissionPreflight,
        author: {
          ...createFixtureReviewState().providerTransmissionPreflight.author,
          company: "openai" as const,
          model: "gpt-6.1-sol",
        },
        critic: {
          ...createFixtureReviewState().providerTransmissionPreflight.critic,
          company: "anthropic" as const,
          model: "claude-opus-5-5",
        },
      },
    };
    const staleDraft = {
      name: "new workspace",
      maxRounds: 3,
      authorCompany: "anthropic" as const,
      authorModel: "old-author",
      criticCompany: "openai" as const,
      criticModel: "old-critic",
      localEndpoint: "",
      independenceOverrideRationale: "",
    };

    const draft = workspaceModelEditorDraftFromState(staleDraft, loaded);

    expect(draft).toMatchObject({
      name: "new workspace",
      maxRounds: 3,
      authorCompany: "openai",
      authorModel: "gpt-6.1-sol",
      criticCompany: "anthropic",
      criticModel: "claude-opus-5-5",
    });
    expect(loaded.providerTransmissionPreflight.author.model).toBe("gpt-6.1-sol");
  });

  it("preserves the loaded workspace pair while projecting an editor draft", () => {
    const workspace = createFixtureReviewState();
    const before = workspace.providerTransmissionPreflight;
    const draft = workspaceModelEditorDraftFromState(
      { name: "existing", maxRounds: 3, authorModel: "unsaved edit" },
      workspace,
    );

    expect(draft.authorModel).toBe(before.author.model);
    expect(workspace.providerTransmissionPreflight).toBe(before);
  });
});
