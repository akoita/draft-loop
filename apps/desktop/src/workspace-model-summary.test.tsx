import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { modelProfilePresetReferences, modelProfilePresets } from "./model-profile-picker-state.js";
import { WorkspaceModelSummary } from "./workspace-model-summary.js";

const author = { company: "anthropic", model: "claude-sonnet-5-5" };
const critic = { company: "openai", model: "gpt-6-sol" };

describe("workspace model summary", () => {
  it("shows plain model and provider names with exact ids as secondary text", () => {
    const html = renderToStaticMarkup(
      <WorkspaceModelSummary title="Configured model pair" author={author} critic={critic} />,
    );

    expect(html).toContain('aria-label="Configured model pair"');
    expect(html).toContain(">Writer<");
    expect(html).toContain(">Reviewer<");
    expect(html).toContain("Claude Sonnet 5.5");
    expect(html).toContain("GPT-6 Sol");
    expect(html).toContain(">Anthropic<");
    expect(html).toContain(">OpenAI<");
    expect(html).toContain("anthropic/claude-sonnet-5-5");
    expect(html).toContain("openai/gpt-6-sol");
    expect(html).not.toContain("Author:");
    expect(html).not.toContain("Preset:");
    expect(html).not.toContain("Custom profile pair");
  });

  it("names the preset when the applied profiles match one", () => {
    const preset = modelProfilePresets.find(
      (candidate) => modelProfilePresetReferences(candidate) !== null,
    );
    const applied = preset === undefined ? null : modelProfilePresetReferences(preset);
    expect(preset).toBeDefined();
    expect(applied).not.toBeNull();

    const html = renderToStaticMarkup(
      <WorkspaceModelSummary
        title="Configured model pair"
        author={author}
        critic={critic}
        appliedProfiles={applied}
      />,
    );

    expect(html).toContain("Preset: ");
    expect(html).not.toContain("Custom profile pair");
    expect(html).not.toContain("@");
  });

  it("falls back to the exact profile pair for a custom combination", () => {
    const html = renderToStaticMarkup(
      <WorkspaceModelSummary
        title="Configured model pair"
        author={author}
        critic={critic}
        appliedProfiles={{
          author: { id: "custom-author", version: 2 },
          critic: { id: "custom-critic", version: 3 },
        }}
      />,
    );

    expect(html).toContain("Custom profile pair");
    expect(html).toContain("custom-author@2 and custom-critic@3");
    expect(html).not.toContain("Preset: ");
  });
});
