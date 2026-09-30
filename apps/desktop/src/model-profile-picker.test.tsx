import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectModelProfileSupport } from "./model-profile-bridge.js";
import { ModelProfilePicker } from "./model-profile-picker.js";
import {
  type ModelProfileSupportState,
  modelProfileCatalog,
  modelProfilePresetReferences,
  modelProfilePresets,
} from "./model-profile-picker-state.js";

const economyPreset = modelProfilePresets.find((preset) => preset.id === "economy");
if (economyPreset === undefined) throw new Error("The economy preset must be registered.");
const economy = modelProfilePresetReferences(economyPreset);
if (economy === null) throw new Error("The economy preset must resolve to registered profiles.");

const apiKeySupport = projectModelProfileSupport("workspace-1", {
  anthropic: "api-key",
  openai: "api-key",
});

function supportState(supported: boolean): ModelProfileSupportState {
  return {
    status: "ready",
    workspaceId: "workspace-1",
    generation: 2,
    result: {
      ...apiKeySupport,
      profiles: apiKeySupport.profiles.map((profile) => ({ ...profile, supported })),
    },
  };
}

function renderPicker(
  support: ModelProfileSupportState,
  applied: ModelProfileReferences | null = null,
  disabled = false,
): string {
  return renderToStaticMarkup(
    <ModelProfilePicker
      workspaceId="workspace-1"
      generation={2}
      applied={applied}
      support={support}
      disabled={disabled}
      onApply={async () => true}
      onUseWorkspaceModels={() => undefined}
      onRetrySupport={() => undefined}
      isContextCurrent={() => true}
    />,
  );
}

describe("desktop model profile picker rendering", () => {
  it("shows legacy mode, presets, exact role options, configured controls, and safe availability copy", () => {
    const legacyHtml = renderPicker(supportState(true));
    expect(legacyHtml).toContain(
      "Applied next-run selection: workspace model settings (legacy path)",
    );
    expect(legacyHtml).not.toContain("Illustrative public API token-cost scenario");
    const html = renderPicker(supportState(true), economy);
    expect(html).toContain("Applied next-run profiles");
    expect(html).toContain("Economy — unvalidated");
    expect(html).toContain("Standard — unvalidated");
    expect(html).not.toContain("Premium — unvalidated");
    expect(html).toContain("Author profile");
    expect(html).toContain("Critic profile");
    expect(html).toContain("economy-anthropic-author@1");
    expect(html).toContain("economy-openai-critic@1");
    expect(html).toContain("claude-sonnet-5-5");
    expect(html).toContain("gpt-6-luna");
    expect(html).toContain("effort medium; output 32768 tokens; thinking provider-default");
    expect(html).toContain("Quality unvalidated; account availability unchecked");
    expect(html).toContain("CV quality has not been validated");
    expect(html).toContain("Authentication is never switched automatically.");
    expect(html).toContain("Public uncached API list rates");
    expect(html).toContain("Combined scenario estimate");
    expect(modelProfileCatalog.length).toBeGreaterThan(0);
  });

  it("keeps unsupported selections visible and disables Apply with a route explanation", () => {
    const html = renderPicker(supportState(false), economy);
    expect(html).toContain("Unsupported with the configured authentication route");
    expect(html).toContain("unsupported with current route");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Applied next-run profiles");
  });

  it("disables controls while busy and reports unavailable support", () => {
    const html = renderPicker(
      { status: "unavailable", workspaceId: "workspace-1", generation: 2 },
      null,
      true,
    );
    expect(html).toContain("Profile route support is unavailable");
    expect(html).toContain("Apply for future runs");
    expect(html).toContain('disabled=""');
  });
});
