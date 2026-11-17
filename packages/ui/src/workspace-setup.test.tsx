import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { activateScreenLocale, ScreensI18nProvider } from "./i18n.js";
import {
  presetsWithinTiers,
  proposedCvLanguage,
  WorkspaceSetupScreen,
  workspaceSetupAdvancedNote,
  workspaceSetupLanguages,
  workspaceSetupPresets,
} from "./workspace-setup.js";

describe("first-run workspace setup", () => {
  it("offers the Anthropic author presets without the development ones", () => {
    const presets = workspaceSetupPresets();
    expect(presets.map(({ id }) => id)).toEqual([
      "economy",
      "balanced",
      "standard",
      "balanced-anthropic",
      "standard-anthropic",
    ]);
    for (const preset of presets) {
      expect(preset.author.company).toBe("anthropic");
      expect(preset.critic.company).toBe(preset.id.endsWith("-anthropic") ? "anthropic" : "openai");
      expect(preset.critic.model).not.toBe(preset.author.model);
      expect(preset.label).not.toMatch(/unvalidated/u);
    }
  });

  it("asks for the language, with rounds, a preset and demo mode under Advanced options", () => {
    const html = renderToStaticMarkup(<WorkspaceSetupScreen onCreate={() => undefined} />);

    expect(html).toContain("Set up your workspace");
    for (const { label } of workspaceSetupLanguages) expect(html).toContain(`>${label}</option>`);
    const [basic = "", advanced = ""] = html.split('<details class="advanced-options">');
    expect(basic).toContain("CV language");
    expect(basic).not.toContain("Rounds at most");
    expect(advanced).toContain("<summary>Advanced options</summary>");
    expect(advanced).toContain('<option value="2" selected="">2 rounds</option>');
    expect(advanced).toContain('checked="" value="balanced"');
    expect(advanced).toContain("<strong>Economy</strong>");
    expect(advanced).toContain("<strong>Standard</strong>");
    expect(advanced).toContain("Runs use fixtures and call no model.");
    expect(advanced).toContain('aria-pressed="false">Turn demo mode on</button>');
    expect(html).toContain(">Create workspace</button>");
    // No free-text model ids or language codes to type.
    expect(html).not.toContain('type="text"');
    expect(html).not.toMatch(/<input(?![^>]*type="radio")/u);
  });

  it("shows the failure and the busy state", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSetupScreen busy problem="The service refused." onCreate={() => undefined} />,
    );
    expect(html).toContain('role="alert">The service refused.</p>');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Creating…<\/button>/u);
  });

  it("proposes the screen language as the CV language (#2774)", () => {
    expect(proposedCvLanguage("fr")).toBe("fr");
    expect(proposedCvLanguage("en")).toBe("en");
    expect(proposedCvLanguage("pseudo")).toBe("en");
    const html = renderToStaticMarkup(
      <ScreensI18nProvider locale="fr">
        <WorkspaceSetupScreen onCreate={() => undefined} />
      </ScreensI18nProvider>,
    );
    expect(html).toMatch(/<option value="fr" selected="">/u);
    activateScreenLocale("en");
  });

  it("names on the folded line each choice that is not the default", () => {
    activateScreenLocale("en");
    const presets = workspaceSetupPresets();
    const balanced = presets.find(({ id }) => id === "balanced");
    const economy = presets.find(({ id }) => id === "economy");
    expect(
      workspaceSetupAdvancedNote({ maxRounds: 2, preset: balanced, fixtureMode: false }),
    ).toBeNull();
    expect(workspaceSetupAdvancedNote({ maxRounds: 3, preset: economy, fixtureMode: true })).toBe(
      "Economy · 3 rounds · Demo mode on",
    );
  });
});

describe("presets a plan allows (#2864)", () => {
  const presets = workspaceSetupPresets();

  it("keeps only presets whose two models are in the plan's tiers", () => {
    const economy = presetsWithinTiers(presets, ["economy"]);
    expect(economy.length).toBeGreaterThan(0);
    expect(economy.every(({ tiers }) => tiers?.every((tier) => tier === "economy"))).toBe(true);
    expect(economy.some(({ id }) => id === "balanced")).toBe(false);
  });

  it("keeps every preset when the plan's tiers are unknown", () => {
    expect(presetsWithinTiers(presets, undefined)).toEqual(presets);
  });

  it("selects the first allowed preset when the default is not offered", () => {
    const economy = presetsWithinTiers(presets, ["economy"]);
    const html = renderToStaticMarkup(
      <WorkspaceSetupScreen presets={economy} busy={false} problem={null} onCreate={() => {}} />,
    );
    expect(html).toContain(`checked="" value="${economy[0]?.id}"`);
  });
});
