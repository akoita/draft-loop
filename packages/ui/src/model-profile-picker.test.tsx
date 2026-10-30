import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectModelProfileSupport } from "./model-profile-bridge.js";
import { ModelProfilePicker } from "./model-profile-picker.js";
import {
  type ModelProfileSupportState,
  modelProfilePresetReferences,
  modelProfilePresets,
  presetReferencesMatchingPreflight,
  workspaceModelsForProfileReferences,
} from "./model-profile-picker-state.js";
import { isDevelopmentPreset } from "./model-profile-presentation.js";

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
    // The applied pair is the editor's one "Now:" line, outside the picker.
    expect(html).not.toContain("Applied next-run profiles");
    expect(html).toContain("Choose a model pair");
    expect(html).not.toContain("<details open");
    // The quality and sign-in note is one line; its full, unchanged text waits behind More.
    expect(html).toMatch(
      /<details class="model-profile-picker-notice"><summary><span[^>]*>Presets are unvalidated for real CVs and do not work with OpenAI Codex user sessions\.<\/span> <span[^>]*>More<\/span><\/summary>/,
    );
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
    expect(cards).toContain(">Balanced</span>");
    expect(cards).toContain(">Standard</span>");
    expect(cards).toContain(">Development — GLM Flash</span>");
    expect(cards).toContain(">Development — Gemini Flash</span>");
    expect(cards).toContain(">Development — Mistral Large 4 (preview)</span>");
    expect(cards).toContain(">Custom pair</span>");
    expect(cards).toContain("Claude Haiku 5.5 writes · GPT-6 Luna reviews");
    expect(cards).toContain("Claude Sonnet 5.5 writes · GPT-6.1 Terra reviews");
    expect(cards).toContain("Writer $2 / $10 · Reviewer $1 / $5");
    expect(cards).toContain("Claude Opus 5.5 writes · GPT-6.1 Sol reviews");
    expect(cards).toContain("GLM-5.3 Flash writes · GPT-6 Luna reviews");
    expect(cards).toContain("Gemini 3.8 Flash writes · GPT-6 Luna reviews");
    expect(cards).toContain("Mistral Large 4 (preview) writes · GPT-6 Luna reviews");
    expect(cards).toContain("Anthropic + OpenAI");
    expect(cards).toContain("Z.ai via DeepInfra + OpenAI");
    expect(cards).toContain("Google + OpenAI");
    expect(cards).toContain("Mistral + OpenAI");
    expect(cards).toContain(
      "Writer $0.50 / $2.50 · Reviewer $0.10 / $0.50 per million tokens (input / output)",
    );
    expect(cards).toContain("Writer $0.75 / $3.75");
    expect(cards).toContain("Writer $1.36 / $4.18");
    // Compact cards: an arrow and one short price line on screen, the full wording for assistive tech.
    expect(cards).toContain('<span aria-hidden="true">Claude Haiku 5.5 → GPT-6 Luna</span>');
    expect(cards).toContain(
      '<span aria-hidden="true">$0.50/$2.50 · $0.10/$0.50 per M tokens</span><span class="sr-only">Writer $0.50 / $2.50 · Reviewer $0.10 / $0.50 per million tokens (input / output)</span>',
    );
    expect(cards).toContain(
      'title="Writer $4 / $20 · Reviewer $2 / $10 per million tokens (input / output)"',
    );
    expect(cards).toContain(">$4/$20 · $2/$10 per M tokens<");
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
    // The applied pair's details live under the editor's "Now:" line; an unchanged draft adds none.
    expect(html).not.toContain("<summary>Details</summary>");
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
  });

  it("marks presets unavailable for the current sign-in and keeps Apply disabled", () => {
    const html = renderPicker(supportState(false), economy);
    expect(html).toContain("Not available with your current sign-in");
    expect(html).toContain("The configured authentication route does not support");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply for future runs/);
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

  it("keeps Cancel and Apply together in the actions bar, after every option", () => {
    const html = renderPicker(supportState(true), economy, false, true);
    const actions = html.slice(html.indexOf('<div class="model-profile-picker-actions">'));
    expect(actions).toMatch(
      /^<div class="model-profile-picker-actions"><button[^>]*>Cancel<\/button>/,
    );
    expect(actions).toContain(">Apply for future runs</button>");
    expect(html.indexOf("model-profile-picker-actions")).toBeGreaterThan(
      html.indexOf('value="custom"'),
    );
    expect(html.indexOf(">Cancel</button>")).toBeGreaterThan(html.indexOf("</fieldset>"));
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

  it("checks the saved pair's preset after a reopen without the legacy message", () => {
    const html = renderPicker(supportState(true), economy);

    expect(html).toMatch(/checked="" value="economy"/);
    expect(html).not.toContain("legacy path");
  });
});

describe("the model dialog on a host with a fixed sign-in (#1834)", () => {
  const developmentIds = new Set(
    modelProfilePresets
      .filter(isDevelopmentPreset)
      .flatMap((preset) => [preset.author.id, preset.critic.id]),
  );
  // The hosted service runs every preset but the development ones.
  const hosted: ModelProfileSupportState = {
    status: "ready",
    workspaceId: "workspace-1",
    generation: 2,
    result: {
      ...apiKeySupport,
      profiles: apiKeySupport.profiles.map((profile) => ({
        ...profile,
        supported: !developmentIds.has(profile.id),
      })),
    },
  };
  const balancedPreset = modelProfilePresets.find((preset) => preset.id === "balanced");
  const balanced =
    balancedPreset === undefined ? null : modelProfilePresetReferences(balancedPreset);
  if (balanced === null) throw new Error("The balanced preset must resolve to profiles.");
  const balancedModels = workspaceModelsForProfileReferences(balanced);
  if (balancedModels === null) throw new Error("The balanced preset must map to models.");
  const preflight = {
    author: { company: balancedModels.authorCompany, model: balancedModels.authorModel },
    critic: { company: balancedModels.criticCompany, model: balancedModels.criticModel },
  } as Parameters<typeof presetReferencesMatchingPreflight>[0];

  function renderHosted(matching: ModelProfileReferences | null): string {
    return renderToStaticMarkup(
      <ModelProfilePicker
        workspaceId="workspace-1"
        generation={2}
        applied={null}
        matching={matching}
        signInFixed
        support={hosted}
        disabled={false}
        onApply={async () => true}
        onCancel={() => undefined}
        onRetrySupport={() => undefined}
        isContextCurrent={() => true}
      />,
    );
  }

  it("finds the preset the workspace's models already are", () => {
    expect(presetReferencesMatchingPreflight(preflight)).toEqual(balanced);
    expect(
      presetReferencesMatchingPreflight({
        ...preflight,
        critic: { ...preflight.critic, model: "not-a-preset-model" },
      }),
    ).toBeNull();
  });

  it("starts on that preset instead of an empty custom pair", () => {
    const html = renderHosted(balanced);
    expect(html).toMatch(/checked="" value="balanced"/);
    expect(html).not.toMatch(/checked="" value="custom"/);
    expect(html).not.toContain("legacy path");
  });

  it("leaves out what the host cannot offer", () => {
    const html = renderHosted(balanced);
    expect(html).not.toContain("Not available with your current sign-in");
    expect(html).not.toContain(">Development<");
    expect(html).not.toContain("Codex");
    const unmatched = renderHosted(null);
    expect(unmatched).toContain("New runs use the workspace&#x27;s current models.");
    expect(unmatched).not.toContain("legacy path");
  });

  it("keeps the desktop's notes and every preset when the sign-in can change", () => {
    const html = renderPicker(supportState(true));
    expect(html).toContain("Codex user sessions");
    expect(html).toContain(">Development<");
  });
});
