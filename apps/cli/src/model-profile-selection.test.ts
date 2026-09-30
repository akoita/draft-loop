import { defaultModelProfileRegistry } from "@draft-loop/application/model-profiles";
import { describe, expect, it } from "vitest";
import {
  ModelProfileSelectionError,
  parseModelProfileReference,
  resolveModelProfileSelection,
} from "./model-profile-selection.js";

describe("model profile selection parsing", () => {
  it("splits exact references at the last at-sign and trims the profile id", () => {
    expect(parseModelProfileReference("  legacy-author@candidate@2  ")).toEqual({
      id: "legacy-author@candidate",
      version: 2,
    });
  });

  it.each([
    undefined,
    "",
    "@1",
    "legacy-profile",
    "legacy-profile@",
    "legacy-profile@0",
    "legacy-profile@-1",
    "legacy-profile@1.5",
    "legacy-profile@9007199254740992",
  ])("rejects malformed profile reference %s without echoing it", (reference) => {
    try {
      parseModelProfileReference(reference);
      expect.fail("Expected a malformed reference to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProfileSelectionError);
      expect(error).toMatchObject({ code: "invalid-reference" });
      if (error instanceof Error && typeof reference === "string" && reference !== "") {
        expect(error.message).not.toContain(reference.trim());
      }
    }
  });

  it("returns no references when no profile options are supplied", () => {
    expect(resolveModelProfileSelection({})).toBeUndefined();
  });

  it("resolves explicit references exactly and checks their role", () => {
    expect(
      resolveModelProfileSelection(
        {
          authorProfile: "legacy-anthropic-author@1",
          criticProfile: "legacy-openai-critic@1",
        },
        defaultModelProfileRegistry,
      ),
    ).toEqual({
      author: { id: "legacy-anthropic-author", version: 1 },
      critic: { id: "legacy-openai-critic", version: 1 },
    });
  });

  it.each([
    {
      options: { modelPreset: "economy", authorProfile: "legacy-anthropic-author@1" },
      code: "invalid-selection",
    },
    { options: { authorProfile: "legacy-anthropic-author@1" }, code: "invalid-selection" },
    { options: { criticProfile: "legacy-openai-critic@1" }, code: "invalid-selection" },
    {
      options: { authorProfile: "legacy-openai-critic@1", criticProfile: "legacy-openai-critic@1" },
      code: "unavailable",
    },
    {
      options: {
        authorProfile: "legacy-anthropic-author@2",
        criticProfile: "legacy-openai-critic@1",
      },
      code: "unavailable",
    },
    {
      options: {
        authorProfile: "legacy-anthropic-author@1",
        criticProfile: "legacy-openai-critic@2",
      },
      code: "unavailable",
    },
    {
      options: { modelPreset: "unlisted-preset-secret" },
      code: "unavailable",
    },
  ] as const)("fails closed for invalid selection options: $code", ({ options, code }) => {
    try {
      resolveModelProfileSelection(options, defaultModelProfileRegistry);
      expect.fail("Expected profile selection to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProfileSelectionError);
      expect(error).toMatchObject({ code });
      expect(error instanceof Error ? error.message : "").not.toContain("unlisted-preset-secret");
    }
  });

  it.each(["economy", "standard", "premium"] as const)(
    "resolves the exact %s preset references",
    (modelPreset) => {
      const selected = resolveModelProfileSelection({ modelPreset });
      expect(selected).toEqual({
        author: {
          id:
            modelPreset === "economy"
              ? "legacy-anthropic-author"
              : `${modelPreset}-anthropic-author`,
          version: 1,
        },
        critic: {
          id: modelPreset === "economy" ? "legacy-openai-critic" : `${modelPreset}-openai-critic`,
          version: 1,
        },
      });
    },
  );
});
