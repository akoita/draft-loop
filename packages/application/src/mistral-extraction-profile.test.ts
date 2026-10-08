import { describe, expect, it } from "vitest";
import { createMistralAuthorProfile } from "./mistral-development-profile.js";
import {
  createMistralExtractionProfile,
  isMistralExtractionProfile,
} from "./mistral-extraction-profile.js";

describe("Mistral extraction profile", () => {
  it("disables thinking at version 2 and leaves the author profile unchanged", () => {
    const profile = createMistralExtractionProfile();
    expect(profile).toMatchObject({
      id: "dev-mistral-extraction",
      version: 2,
      runtime: {
        effort: "provider-default",
        maxOutputTokens: 32768,
        thinking: { mode: "disabled" },
      },
    });
    expect(isMistralExtractionProfile(profile)).toBe(true);

    const author = createMistralAuthorProfile();
    expect(author.version).toBe(1);
    expect(author.runtime.thinking).toEqual({ mode: "provider-default" });
  });

  it("recognizes only the exact disabled-thinking version 2 profile", () => {
    const profile = createMistralExtractionProfile();
    expect(isMistralExtractionProfile(undefined)).toBe(false);
    for (const tampered of [
      { ...profile, version: 1 },
      { ...profile, id: "tampered-profile" },
      { ...profile, runtime: { ...profile.runtime, thinking: { mode: "provider-default" } } },
      { ...profile, runtime: { ...profile.runtime, effort: "high" } },
      { ...profile, runtime: { ...profile.runtime, maxOutputTokens: 8192 } },
    ] as const) {
      expect(isMistralExtractionProfile(tampered)).toBe(false);
    }
  });
});
