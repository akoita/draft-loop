import { describe, expect, it } from "vitest";

import { planPresetChoice } from "./plan-preset-model.js";

const catalog = [
  { company: "anthropic", model: "claude-haiku-5-5", tier: "economy" },
  { company: "anthropic", model: "claude-sonnet-5-5", tier: "standard" },
  { company: "openai", model: "gpt-6-luna", tier: "economy" },
  { company: "openai", model: "gpt-6.1-terra", tier: "standard" },
];

const standardPair = {
  author: { company: "anthropic", model: "claude-sonnet-5-5" },
  critic: { company: "openai", model: "gpt-6.1-terra" },
};

describe("the presets offered when the pair is outside the plan (#2864)", () => {
  it("offers nothing when the plan's tiers are unknown or include the pair", () => {
    expect(planPresetChoice(standardPair, catalog, undefined)).toBeUndefined();
    expect(planPresetChoice(standardPair, catalog, ["economy", "standard"])).toBeUndefined();
  });

  it("offers only presets within an economy plan, the best one first", () => {
    const choice = planPresetChoice(standardPair, catalog, ["economy"]);
    expect(choice).toBeDefined();
    expect(choice?.presets.every(({ tiers }) => tiers?.every((tier) => tier === "economy"))).toBe(
      true,
    );
    expect(choice?.presets.map(({ id }) => id)).toContain(choice?.initialId);
  });

  it("treats a model the catalog does not know as outside the plan", () => {
    const unknown = { ...standardPair, critic: { company: "openai", model: "gpt-retired" } };
    expect(planPresetChoice(unknown, catalog, ["economy", "standard"])).toBeDefined();
  });
});
