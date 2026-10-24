import { createFixtureReviewState } from "@draft-loop/ui/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ApplicationModelPairChoice,
  ApplicationModelPairControl,
  applicationPairForValue,
  applicationPairLabel,
  applicationPairValue,
  saveApplicationModelPair,
  workspacePairSides,
  workspacePairValue,
  workspaceScopedState,
} from "./application-model-pair.js";

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

  it("holds every choice while disabled, without the saving line", () => {
    const html = renderToStaticMarkup(<ApplicationModelPairChoice {...props} disabled />);
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/gu) ?? [];
    expect(radios.length).toBeGreaterThan(1);
    for (const radio of radios) expect(radio).toContain('disabled=""');
    expect(html).not.toContain("Saving the model pair…");
  });
});

describe("saving the application's pair", () => {
  it("hands setApplicationModels the chosen preset's exact refs, or null for the workspace's", async () => {
    const save = vi.fn(async () => undefined);
    const chosen = applicationPairForValue("standard");
    expect(chosen).toEqual(standard);
    expect(await saveApplicationModelPair(chosen ?? null, save)).toBeNull();
    expect(save).toHaveBeenLastCalledWith(standard);
    expect(await saveApplicationModelPair(null, save)).toBeNull();
    expect(save).toHaveBeenLastCalledWith(null);
  });

  it("reports the host's refusal, or a fallback when it gives no reason", async () => {
    expect(
      await saveApplicationModelPair(standard, async () => {
        throw new Error("Both models come from the same company.");
      }),
    ).toBe("Both models come from the same company.");
    expect(
      await saveApplicationModelPair(standard, async () => {
        throw "unknown";
      }),
    ).toBe("The model pair could not be saved.");
  });

  it("renders the control with the application's pair and holds it while disabled", () => {
    const html = renderToStaticMarkup(
      <ApplicationModelPairControl
        pair={standard}
        workspace={workspace}
        support={undefined}
        disabled
        onSave={async () => undefined}
      />,
    );
    expect(html).toContain("This application uses its own model pair");
    expect(html).toMatch(/checked="" value="standard"/u);
    expect(html).toMatch(/disabled=""[^>]*value="workspace"|value="workspace"[^>]*disabled=""/u);
  });
});
