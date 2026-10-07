import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectModelProfileSupport } from "./model-profile-bridge.js";
import { ModelProfilePicker } from "./model-profile-picker.js";
import {
  type ModelProfileSupportState,
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
  withCancel = false,
): string {
  return renderToStaticMarkup(
    <ModelProfilePicker
      workspaceId="workspace-1"
      generation={2}
      applied={applied}
      support={support}
      disabled={disabled}
      onApply={async () => true}
      {...(withCancel ? { onCancel: () => undefined } : { onUseWorkspaceModels: () => undefined })}
      onRetrySupport={() => undefined}
      isContextCurrent={() => true}
    />,
  );
}

describe("desktop model profile picker rendering", () => {
  it("shows legacy mode, preset cards, details, and safe availability copy", () => {
    const legacyHtml = renderPicker(supportState(true));
    expect(legacyHtml).toContain(
      "Applied next-run selection: workspace model settings (legacy path)",
    );
    expect(legacyHtml).not.toContain("Illustrative public API token-cost scenario");
    const html = renderPicker(supportState(true), economy);
    expect(html).toContain("Applied next-run profiles");
    expect(html).toContain("Choose a model pair");
    expect(html).toContain("Applied: Economy — Claude Haiku 5.5 writes, GPT-6 Luna reviews");
    expect(html).toContain("Quality unvalidated; account availability unchecked");
    expect(html).toContain("effort medium; output 32768 tokens; thinking provider-default");
    expect(html).toContain("<summary>Details</summary>");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Quality for real CVs has not been validated");
    expect(html).toContain("DraftLoop never switches your sign-in automatically.");
    expect(html).toContain("Sending candidate material still asks for your approval each time.");
    expect(html).toContain("Public uncached API list rates");
    expect(html).toContain("Combined scenario estimate");
    expect(html).not.toContain("Premium");
  });

  it("renders one radio card per preset plus a custom pair with plain names, prices, and badges", () => {
    const html = renderPicker(supportState(true), economy);
    expect(html.match(/type="radio"/g)).toHaveLength(modelProfilePresets.length + 1);
    expect(html.match(/name="model-preset-workspace-1"/g)).toHaveLength(
      modelProfilePresets.length + 1,
    );
    expect(html).toContain('value="custom"');
    const cards = html.slice(html.indexOf("<fieldset"), html.indexOf("</fieldset>"));
    expect(cards).toContain(">Economy</span>");
    expect(cards).toContain(">Standard</span>");
    expect(cards).toContain(">Development — GLM Flash</span>");
    expect(cards).toContain(">Development — Gemini Flash</span>");
    expect(cards).toContain(">Custom pair</span>");
    expect(cards).toContain("Claude Haiku 5.5 writes · GPT-6 Luna reviews");
    expect(cards).toContain("GLM-5.3 Flash writes · GPT-6 Luna reviews");
    expect(cards).toContain("Gemini 3.8 Flash writes · GPT-6 Luna reviews");
    expect(cards).toContain("Anthropic + OpenAI");
    expect(cards).toContain("Z.ai via DeepInfra + OpenAI");
    expect(cards).toContain("Google + OpenAI");
    expect(cards).toContain(
      "Writer $0.10 / $0.50 · Reviewer $0.10 / $0.50 per million tokens (input / output)",
    );
    expect(cards).toContain("Writer $0.75 / $3.75");
    expect(cards).toContain("Unvalidated");
    expect(cards).toContain("Development</span>");
    expect(cards).not.toContain("economy-anthropic-author");
    expect(cards).not.toContain("claude-haiku-5-5");
    expect(cards).not.toContain("unvalidated");
    expect(cards).not.toContain("Not available with your current sign-in");
  });

  it("checks the applied preset and hides the exact selects", () => {
    const html = renderPicker(supportState(true), economy);
    expect(html).toMatch(/checked="" value="economy"/);
    expect(html.match(/<summary>Details<\/summary>/g)).toHaveLength(1);
    expect(html).not.toMatch(/checked="" value="custom"/);
    expect(html).not.toContain('aria-label="Author profile"');
    expect(html).not.toContain('aria-label="Critic profile"');
  });

  it("checks custom and shows the exact selects when no preset matches", () => {
    const html = renderPicker(supportState(true), null);
    expect(html).toMatch(/checked="" value="custom"/);
    expect(html).not.toMatch(/checked="" value="economy"/);
    expect(html).toContain('aria-label="Author profile"');
    expect(html).toContain('aria-label="Critic profile"');
    expect(html).toContain("economy-anthropic-author@2");
    expect(html).toContain("economy-openai-critic@1");
    const mixed: ModelProfileReferences = {
      author: economy.author,
      critic: { id: "standard-openai-critic", version: 2 },
    };
    const mixedHtml = renderPicker(supportState(true), mixed);
    expect(mixedHtml).toMatch(/checked="" value="custom"/);
    expect(mixedHtml).toContain('aria-label="Author profile"');
    expect(mixedHtml).toContain(
      "Applied: Custom pair — Claude Haiku 5.5 writes, GPT-6.1 Sol reviews",
    );
  });

  it("marks presets unavailable for the current sign-in and keeps Apply disabled", () => {
    const html = renderPicker(supportState(false), economy);
    expect(html).toContain("Not available with your current sign-in");
    expect(html).toContain("Unsupported with the configured authentication route");
    expect(html).toContain("The configured authentication route does not support");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply for future runs/);
    expect(html).toContain("Applied next-run profiles");
    const custom = renderPicker(supportState(false), null);
    expect(custom).toContain("unsupported with current route");
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

  it("offers editor cancellation without a second workspace-model action", () => {
    const html = renderPicker(supportState(true), null, false, true);
    expect(html).toContain(">Cancel</button>");
    expect(html).not.toContain("Use workspace models");
  });

  it("shows why a saved pair is not used while nothing is applied", () => {
    const html = renderToStaticMarkup(
      <ModelProfilePicker
        workspaceId="workspace-1"
        generation={2}
        applied={null}
        savedPairNotice="The saved profile pair (author a@1; critic b@1) is not used because the critic changed."
        support={supportState(true)}
        disabled={false}
        onApply={async () => true}
        onRetrySupport={() => undefined}
        isContextCurrent={() => true}
      />,
    );

    expect(html).toContain("Applied next-run selection: workspace model settings (legacy path)");
    expect(html).toContain("is not used because the critic changed.");
  });

  it("shows the saved pair as applied with its exact versions after a reopen", () => {
    const html = renderPicker(supportState(true), economy);

    expect(html).toContain("Applied next-run profiles");
    expect(html).toContain(`${economy.author.id}@${economy.author.version}`);
    expect(html).toContain(`${economy.critic.id}@${economy.critic.version}`);
    expect(html).not.toContain("legacy path");
  });
});
