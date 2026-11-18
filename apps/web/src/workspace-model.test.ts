import { describe, expect, it } from "vitest";

import { defaultSetupChoice, routablePresets, setupRequestBody } from "./workspace-model.js";

const balanced = {
  id: "balanced",
  label: "Balanced",
  author: { company: "anthropic", model: "synthetic-author-1" },
  critic: { company: "openai", model: "synthetic-critic-1" },
};

describe("first-run setup request", () => {
  it("sends the chosen language, rounds, demo mode and the preset's two models", () => {
    expect(
      setupRequestBody({ language: "fr", maxRounds: 3, preset: balanced, fixtureMode: true }),
    ).toEqual({
      language: "fr",
      maxRounds: 3,
      fixtureMode: true,
      author: { company: "anthropic", model: "synthetic-author-1" },
      critic: { company: "openai", model: "synthetic-critic-1" },
    });
  });

  it("refuses a preset with a company the hosted service does not run", () => {
    expect(() =>
      setupRequestBody({
        language: "en",
        maxRounds: 2,
        fixtureMode: false,
        preset: { ...balanced, author: { company: "mistral", model: "synthetic-author-2" } },
      }),
    ).toThrow(/Anthropic and OpenAI/u);
  });

  it("offers only the presets whose two models the service routes", () => {
    const other = { ...balanced, id: "standard", critic: { company: "openai", model: "unrouted" } };
    expect(
      routablePresets(
        [balanced, other],
        [
          { company: "anthropic", model: "synthetic-author-1" },
          { company: "openai", model: "synthetic-critic-1" },
        ],
      ),
    ).toEqual([balanced]);
  });
});

describe("automatic setup on a one-person plan", () => {
  const economy = { ...balanced, id: "economy", label: "Economy" };

  it("takes the default preset when it is offered, two rounds and demo mode off", () => {
    expect(defaultSetupChoice([economy, balanced], "fr")).toEqual({
      language: "fr",
      maxRounds: 2,
      preset: balanced,
      fixtureMode: false,
    });
  });

  it("takes the first offered preset when the plan does not offer the default", () => {
    expect(defaultSetupChoice([economy], "en")?.preset).toBe(economy);
  });

  it("has no choice to make when nothing is offered, so the setup screen shows", () => {
    expect(defaultSetupChoice([], "en")).toBeUndefined();
  });
});
