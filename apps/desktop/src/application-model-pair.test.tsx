import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ApplicationModelPairChoice,
  applicationPairForValue,
  applicationPairLabel,
  applicationPairValue,
  workspacePairSides,
  workspacePairValue,
  workspaceScopedState,
} from "./application-model-pair.js";
import { createFixtureReviewState } from "./model.js";

const standard = {
  author: { id: "standard-anthropic-author", version: 1 },
  critic: { id: "standard-openai-critic", version: 2 },
};
const economy = {
  author: { id: "economy-anthropic-author", version: 2 },
  critic: { id: "economy-openai-critic", version: 1 },
};
const fixture = createFixtureReviewState();
const workspace = {
  author: fixture.providerTransmissionPreflight.author,
  critic: fixture.providerTransmissionPreflight.critic,
};

describe("application model pair values", () => {
  it("maps the workspace's pair and the presets to radio values and back", () => {
    expect(applicationPairValue(null)).toBe(workspacePairValue);
    expect(applicationPairValue(standard)).toBe("standard");
    expect(applicationPairForValue(workspacePairValue)).toBeNull();
    expect(applicationPairForValue("economy")).toEqual(economy);
    expect(applicationPairForValue("custom")).toBeUndefined();
  });

  it("names a preset pair, and a pair no preset matches by its references", () => {
    expect(applicationPairLabel(standard)).toBe("Preset Standard");
    const custom = { ...standard, critic: economy.critic };
    expect(applicationPairValue(custom)).toBe("");
    expect(applicationPairLabel(custom)).toBe(
      "Custom pair standard-anthropic-author@1 and economy-openai-critic@1",
    );
  });
});

describe("workspace pair sides", () => {
  it("reads the loaded pair while the application uses the workspace's", () => {
    expect(workspacePairSides(fixture, null, standard)).toEqual(workspace);
    expect(workspaceScopedState(fixture, null, standard)).toBe(fixture);
  });

  it("names the workspace's profiles while the loaded application has its own pair", () => {
    const sides = workspacePairSides(fixture, economy, standard);
    expect(sides.author).toMatchObject({ company: "anthropic" });
    expect(sides.critic).toMatchObject({ company: "openai" });
    expect(sides.author.model).not.toBe("");
    const scoped = workspaceScopedState(fixture, economy, standard);
    expect(scoped.providerTransmissionPreflight.author).toEqual(sides.author);
    expect(scoped.providerTransmissionPreflight.fingerprint).toBe(
      fixture.providerTransmissionPreflight.fingerprint,
    );
  });
});

describe("ApplicationModelPairChoice", () => {
  const props = {
    pair: null,
    workspace,
    support: undefined,
    saving: false,
    errorMessage: null,
    onChoose: () => undefined,
  };

  it("offers the workspace's pair by default and the presets, without a custom pair", () => {
    const html = renderToStaticMarkup(<ApplicationModelPairChoice {...props} />);
    expect(html).toContain("Use a different model pair for this application");
    expect(html).not.toContain('<details class="flow-model-pair" open');
    expect(html).toContain("Model pair for this application");
    expect(html).toContain("Workspace pair");
    expect(html).toMatch(/checked="" value="workspace"/u);
    expect(html).toContain("Standard");
    expect(html).not.toContain("Custom pair");
  });

  it("opens on the application's own preset and shows saving and a failure", () => {
    const html = renderToStaticMarkup(
      <ApplicationModelPairChoice
        {...props}
        pair={standard}
        saving
        errorMessage="The model pair could not be saved."
      />,
    );
    expect(html).toContain("This application uses its own model pair");
    expect(html).toMatch(/checked="" value="standard"/u);
    expect(html).toContain("Saving the model pair…");
    expect(html).toContain("The model pair could not be saved.");
  });
});
