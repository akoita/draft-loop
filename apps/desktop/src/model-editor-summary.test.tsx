import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ModelProfileSupportResult } from "./bridge.js";
import { ModelEditorSummary, modelEditorSummaryText } from "./model-editor-summary.js";
import { projectModelProfileSupport } from "./model-profile-bridge.js";
import { modelProfilePresetReferences, modelProfilePresets } from "./model-profile-picker-state.js";

function presetReferences(id: string): ModelProfileReferences {
  const preset = modelProfilePresets.find((candidate) => candidate.id === id);
  const references = preset === undefined ? null : modelProfilePresetReferences(preset);
  if (references === null) throw new Error(`The ${id} preset must resolve to registered profiles.`);
  return references;
}

const standard = presetReferences("standard");
const economy = presetReferences("economy");
const author = { company: "anthropic", model: "claude-opus-5-5" };
const critic = { company: "openai", model: "gpt-6.1-sol" };

function support(supported: boolean): ModelProfileSupportResult {
  const result = projectModelProfileSupport("workspace-1", {
    anthropic: "api-key",
    openai: "api-key",
  });
  return { ...result, profiles: result.profiles.map((profile) => ({ ...profile, supported })) };
}

function render(
  applied: ModelProfileReferences | null,
  routeSupport: ModelProfileSupportResult | undefined = support(true),
): string {
  return renderToStaticMarkup(
    <ModelEditorSummary author={author} critic={critic} applied={applied} support={routeSupport} />,
  );
}

describe("model editor summary", () => {
  it("names the applied preset and both models in one line", () => {
    const html = render(standard);

    expect(html).toContain(
      '<p class="model-editor-summary-line">Now: Standard — Claude Opus 5.5 writes · GPT-6.1 Sol reviews</p>',
    );
    expect(html).not.toContain("Current configured model pair");
    expect(html).not.toContain("Applied next-run profiles");
  });

  it("keeps exact ids and the profiles' lineage under a collapsed Details disclosure", () => {
    const html = render(economy);
    const details = html.slice(html.indexOf("<details"));

    expect(html).not.toContain("<details open");
    expect(details).toContain("<summary>Details</summary>");
    expect(details).toContain("anthropic/claude-opus-5-5");
    expect(details).toContain("openai/gpt-6.1-sol");
    expect(details).toContain(`${economy.author.id}@${economy.author.version}`);
    expect(details).toContain(`${economy.critic.id}@${economy.critic.version}`);
    expect(details).toContain("effort medium; output 32768 tokens; thinking provider-default");
    expect(details).toContain("Quality unvalidated; account availability unchecked");
    expect(details).toContain("Supported with the configured authentication route");
  });

  it("reports a route the current sign-in does not support in the details", () => {
    expect(render(economy, support(false))).toContain(
      "Unsupported with the configured authentication route",
    );
    const unchecked = renderToStaticMarkup(
      <ModelEditorSummary author={author} critic={critic} applied={economy} support={undefined} />,
    );
    expect(unchecked).toContain("Not checked");
  });

  it("names a pair that matches no preset as a custom pair", () => {
    const mixed: ModelProfileReferences = {
      author: economy.author,
      critic: { id: "standard-openai-critic", version: 2 },
    };

    expect(modelEditorSummaryText({ author, critic, applied: mixed })).toBe(
      "Now: Custom pair — Claude Haiku 5.5 writes · GPT-6.1 Sol reviews",
    );
  });

  it("names the workspace models alone while no profile pair is applied", () => {
    const html = render(null);

    expect(html).toContain("Now: Claude Opus 5.5 writes · GPT-6.1 Sol reviews");
    expect(html).toContain("anthropic/claude-opus-5-5");
    expect(html).not.toContain("model-profile-picker-details");
  });
});
