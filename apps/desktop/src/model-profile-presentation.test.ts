import { describe, expect, it } from "vitest";
import { modelProfileCatalog, modelProfilePresets } from "./model-profile-picker-state.js";
import {
  formatUsdPerMillion,
  isDevelopmentPreset,
  modelDisplayName,
  presetDisplayName,
  providerDisplayName,
} from "./model-profile-presentation.js";

describe("model profile presentation", () => {
  it("names every catalog model and provider in plain language", () => {
    expect(modelDisplayName("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(modelDisplayName("gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(modelDisplayName("zai-org/GLM-5.3-Flash")).toBe("GLM-5.3 Flash");
    expect(modelDisplayName("mistral-large-4")).toBe("Mistral Large 4 (preview)");
    expect(providerDisplayName("mistral")).toBe("Mistral");
    expect(modelDisplayName("unknown-model")).toBe("unknown-model");
    expect(providerDisplayName("zai")).toBe("Z.ai via DeepInfra");
    expect(providerDisplayName("openai")).toBe("OpenAI");
    expect(providerDisplayName("mystery")).toBe("mystery");
    for (const { profile } of modelProfileCatalog) {
      expect(modelDisplayName(profile.modelId)).not.toBe(profile.modelId);
      expect(providerDisplayName(profile.provider)).not.toBe(profile.provider);
    }
  });

  it("strips the unvalidated suffix from preset labels", () => {
    expect(presetDisplayName("Economy — unvalidated")).toBe("Economy");
    expect(presetDisplayName("Development — GLM Flash — unvalidated")).toBe(
      "Development — GLM Flash",
    );
    expect(presetDisplayName("Plain")).toBe("Plain");
  });

  it("formats per-million prices", () => {
    expect(formatUsdPerMillion(0.1)).toBe("$0.10");
    expect(formatUsdPerMillion(0.075)).toBe("$0.075");
    expect(formatUsdPerMillion(0.5)).toBe("$0.50");
    expect(formatUsdPerMillion(3.75)).toBe("$3.75");
    expect(formatUsdPerMillion(20)).toBe("$20");
  });

  it("identifies development presets", () => {
    expect(modelProfilePresets.filter(isDevelopmentPreset).map(({ id }) => id)).toEqual([
      "development-glm",
      "development-gemini",
      "development-mistral",
    ]);
  });
});
