import { describe, expect, it } from "vitest";

import { currentModelProfileReferences } from "./model-profile-supersession.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";
import { resolveRequestedRunModelProfiles } from "./run-model-profiles.js";

const critic = { id: "economy-openai-critic", version: 1 } as const;
const apiKeys = { anthropic: "api-key", openai: "api-key" } as const;

describe("currentModelProfileReferences", () => {
  it.each([2, 4])(
    "replaces economy author version %i with version 5 and its own level",
    (version) => {
      const references = {
        author: { id: "economy-anthropic-author", version, effort: "medium" as const },
        critic,
      };

      expect(currentModelProfileReferences(references)).toEqual({
        author: { id: "economy-anthropic-author", version: 5 },
        critic,
      });
    },
  );

  it("keeps a reasoning level other than the one that failed", () => {
    expect(
      currentModelProfileReferences({
        author: { id: "economy-anthropic-author", version: 4, effort: "high" },
        critic,
      }).author,
    ).toEqual({ id: "economy-anthropic-author", version: 5, effort: "high" });
  });

  it.each([1, 3, 5])("keeps economy author version %i", (version) => {
    const references = { author: { id: "economy-anthropic-author", version }, critic };

    expect(currentModelProfileReferences(references)).toBe(references);
  });
});

describe("resolveRequestedRunModelProfiles", () => {
  it("starts a new run on version 5 when a saved pair names version 4", () => {
    const resolved = resolveRequestedRunModelProfiles(
      { author: { id: "economy-anthropic-author", version: 4 }, critic },
      defaultModelProfileRegistry,
      apiKeys,
    );

    expect(resolved?.author).toMatchObject({
      id: "economy-anthropic-author",
      version: 5,
      runtime: { effort: "low" },
    });
  });
});
