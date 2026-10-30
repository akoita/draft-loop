import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  WorkspaceSetupScreen,
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

  it("asks for the language, the round limit, a preset and demo mode, Balanced first", () => {
    const html = renderToStaticMarkup(<WorkspaceSetupScreen onCreate={() => undefined} />);

    expect(html).toContain("Set up your workspace");
    for (const { label } of workspaceSetupLanguages) expect(html).toContain(`>${label}</option>`);
    expect(html).toContain('<option value="2" selected="">2 rounds</option>');
    expect(html).toContain('checked="" value="balanced"');
    expect(html).toContain("<strong>Economy</strong>");
    expect(html).toContain("<strong>Standard</strong>");
    expect(html).toContain("Demo mode: runs use fixtures and call no model");
    expect(html).toContain(">Create workspace</button>");
    // No free-text model ids or language codes to type.
    expect(html).not.toContain('type="text"');
    expect(html).not.toMatch(/<input(?![^>]*type="(radio|checkbox)")/u);
  });

  it("shows the failure and the busy state", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSetupScreen busy problem="The service refused." onCreate={() => undefined} />,
    );
    expect(html).toContain('role="alert">The service refused.</p>');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Creating…<\/button>/u);
  });
});
