import { describe, expect, it } from "vitest";

import {
  hostedDefaultModelPair,
  hostedDefaultPresetFor,
  hostedDefaultPresetId,
} from "./hosted-model-catalog.js";

describe("the preset a new workspace starts on (#2864)", () => {
  it("keeps the hosted default when the plan allows it or names no tiers", () => {
    expect(hostedDefaultPresetFor(undefined)).toBe(hostedDefaultPresetId);
    expect(hostedDefaultPresetFor(["economy", "standard"])).toBe(hostedDefaultPresetId);
  });

  it("starts an economy-only plan on the economy preset", () => {
    expect(hostedDefaultPresetFor(["economy"])).toBe("economy");
    const pair = hostedDefaultModelPair(hostedDefaultPresetFor(["economy"]));
    expect(pair.author.company).toBe("anthropic");
    expect(pair.critic.company).toBe("openai");
  });
});
