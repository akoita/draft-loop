import { describe, expect, it } from "vitest";

import { ApiConfigError } from "./config.js";
import { readLocalModels } from "./local-models-config.js";

describe("readLocalModels", () => {
  it("offers no local model when unset", () => {
    expect(readLocalModels({})).toEqual([]);
    expect(readLocalModels({ DRAFT_LOOP_LOCAL_MODELS: " " })).toEqual([]);
  });

  it("reads model names separated by commas, once each", () => {
    expect(
      readLocalModels({ DRAFT_LOOP_LOCAL_MODELS: "qwen3:32b, llama-4-scout,qwen3:32b" }),
    ).toEqual(["qwen3:32b", "llama-4-scout"]);
  });

  it.each([
    ["a name with spaces", "qwen 3"],
    ["a name with a quote", 'qwen"3'],
    ["too many names", Array.from({ length: 21 }, (_, index) => `model-${index}`).join(",")],
  ])("refuses %s", (_label, value) => {
    expect(() => readLocalModels({ DRAFT_LOOP_LOCAL_MODELS: value })).toThrow(ApiConfigError);
  });
});
