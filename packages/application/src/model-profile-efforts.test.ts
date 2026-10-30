import { describe, expect, it } from "vitest";
import { listModelProfileCatalog } from "./model-profile-catalog.js";
import {
  allowedModelProfileEfforts,
  choosableModelProfileEfforts,
  isChoosableModelProfileEffort,
} from "./model-profile-efforts.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";

describe("model profile reasoning levels", () => {
  it("offers low to max on every current Anthropic and OpenAI profile", () => {
    const levels = Object.fromEntries(
      listModelProfileCatalog().map(({ profile, effortLevels }) => [
        `${profile.id}@${profile.version}`,
        effortLevels,
      ]),
    );
    const all = ["low", "medium", "high", "xhigh", "max"];
    expect(levels).toEqual({
      "economy-anthropic-author@2": all,
      "economy-openai-critic@1": all,
      "economy-anthropic-author@1": all,
      "balanced-openai-critic@1": all,
      "standard-anthropic-author@2": all,
      "standard-openai-critic@2": all,
      "dev-deepinfra-glm-author@1": ["low"],
      "dev-google-gemini-author@2": ["low"],
      "dev-mistral-author@1": ["provider-default"],
    });
  });

  it("always includes each profile's own level, so its default stays valid", () => {
    for (const profile of defaultModelProfileRegistry.list()) {
      expect(allowedModelProfileEfforts(profile)).toContain(profile.runtime.effort);
    }
  });

  it("keeps a historical version to its fixed level", () => {
    const sol = defaultModelProfileRegistry.resolve("standard-openai-critic", 1, "critic");
    expect(allowedModelProfileEfforts(sol)).toEqual(["low"]);
    const legacy = defaultModelProfileRegistry.resolve("legacy-anthropic-author", 1, "author");
    expect(allowedModelProfileEfforts(legacy)).toEqual(["provider-default"]);
  });

  it("cites the provider page the levels came from", () => {
    const byId = new Map(
      listModelProfileCatalog().map((entry) => [
        `${entry.profile.id}@${entry.profile.version}`,
        entry,
      ]),
    );
    expect(byId.get("standard-anthropic-author@2")?.sources).toContain(
      "https://platform.claude.com/docs/en/build-with-claude/effort",
    );
    expect(byId.get("balanced-openai-critic@1")?.sources).toEqual([
      "https://developers.openai.com/api/docs/models/gpt-6.1-terra",
    ]);
  });

  it("recognizes only the choosable levels", () => {
    expect(choosableModelProfileEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(isChoosableModelProfileEffort("high")).toBe(true);
    expect(isChoosableModelProfileEffort("provider-default")).toBe(false);
    expect(isChoosableModelProfileEffort("none")).toBe(false);
    expect(isChoosableModelProfileEffort(3)).toBe(false);
  });
});
