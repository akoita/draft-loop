import type { WorkspaceDescriptor } from "@draft-loop/application";
import { describe, expect, it } from "vitest";
import {
  RunModelProfileSelectionError,
  resolveWorkspaceModelProfileSelection,
} from "./run-model-profile-selection.js";

const workspace = {
  author: { company: "anthropic", model: "claude-sonnet-5-5" },
  critic: { company: "openai", model: "gpt-6.1-terra" },
} as unknown as WorkspaceDescriptor;
const apiKeys = { anthropic: "api-key", openai: "api-key" } as const;

describe("run model profile selection", () => {
  it("keeps a chosen reasoning level and leaves the other role on its profile's own", () => {
    expect(
      resolveWorkspaceModelProfileSelection(
        {
          author: { id: "economy-anthropic-author", version: 1, effort: "high" },
          critic: { id: "balanced-openai-critic", version: 1 },
        },
        workspace,
        apiKeys,
      ),
    ).toEqual({
      author: { id: "economy-anthropic-author", version: 1, effort: "high" },
      critic: { id: "balanced-openai-critic", version: 1 },
    });
  });

  it("refuses a level the profile does not allow", () => {
    expect(() =>
      resolveWorkspaceModelProfileSelection(
        {
          author: { id: "economy-anthropic-author", version: 1, effort: "none" },
          critic: { id: "balanced-openai-critic", version: 1 },
        },
        workspace,
        apiKeys,
      ),
    ).toThrow(RunModelProfileSelectionError);
  });
});
