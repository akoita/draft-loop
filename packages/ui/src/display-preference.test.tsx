import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdvancedOptions } from "./advanced-options.js";
import {
  DisplayChoiceCard,
  type DisplayMode,
  DisplayPreferenceProvider,
  DisplaySetting,
  displayModeName,
} from "./display-preference.js";

function withMode(mode: DisplayMode | null, node: React.ReactNode, choose = () => undefined) {
  return renderToStaticMarkup(
    <DisplayPreferenceProvider value={{ preference: { mode, guideHidden: false }, choose }}>
      {node}
    </DisplayPreferenceProvider>,
  );
}

describe("Show everything", () => {
  it("starts every uncontrolled Advanced options section open", () => {
    const section = (
      <AdvancedOptions>
        <p>Inside</p>
      </AdvancedOptions>
    );
    expect(withMode("everything", section)).toContain('<details class="advanced-options" open="">');
    for (const mode of ["guided", "standard", null] as const) {
      expect(withMode(mode, section)).toMatch(/^<details class="advanced-options">/);
    }
  });

  it("leaves a section its owner controls as the owner says", () => {
    const folded = (
      <AdvancedOptions open={false}>
        <p>Inside</p>
      </AdvancedOptions>
    );
    expect(withMode("everything", folded)).toMatch(/^<details class="advanced-options">/);
    const opened = (
      <AdvancedOptions open>
        <p>Inside</p>
      </AdvancedOptions>
    );
    expect(withMode("standard", opened)).toContain('<details class="advanced-options" open="">');
  });
});

describe("the Display setting in Workspace settings", () => {
  it("shows all three ways of working as choice cards, the current one marked, with no checkbox", () => {
    const html = withMode("everything", <DisplaySetting />);
    expect(html).toContain('<h3 id="display-setting-heading">Display</h3>');
    expect(html).toContain(
      'aria-pressed="false"><span class="display-choice-option-title"><strong>Guide me step by step</strong></span>',
    );
    expect(html).toContain(
      'aria-pressed="false"><span class="display-choice-option-title"><strong>Simple</strong></span>',
    );
    expect(html).toContain(
      'aria-pressed="true"><span class="display-choice-option-title"><strong>Show everything</strong><span class="meta-chip">Current</span>',
    );
    expect(html).toContain("Technical choices stay folded under Advanced options.");
    expect(html).not.toContain(">Change</button>");
    expect(html).not.toContain("Keep as it is");
    expect(html).not.toContain('type="checkbox"');
  });

  it("says where the current way of working shows", () => {
    expect(withMode("guided", <DisplaySetting />)).toContain(
      "the Getting started list on Home, and a one-line hint",
    );
    expect(withMode(null, <DisplaySetting />)).toContain(
      "every Advanced options section is folded",
    );
    expect(withMode("everything", <DisplaySetting />)).toContain(
      "every Advanced options section is open, on this screen too",
    );
  });

  it("marks Simple as current for a person who never chose", () => {
    const html = withMode(null, <DisplaySetting />);
    expect(html).toContain(
      'aria-pressed="true"><span class="display-choice-option-title"><strong>Simple</strong>',
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("is absent when the host keeps no preference", () => {
    expect(renderToStaticMarkup(<DisplaySetting />)).toBe("");
  });

  it("calls a person who never chose Simple", () => {
    expect(displayModeName(null)).toBe("Simple");
    expect(displayModeName("standard")).toBe("Simple");
    expect(displayModeName("guided")).toBe("Guided");
  });
});

describe("the two-choice card", () => {
  it("offers two ways of working, each with its effect, and a quiet way back", () => {
    const html = renderToStaticMarkup(
      <DisplayChoiceCard
        heading="How would you like to start?"
        current="guided"
        quietLabel="Decide later"
        onChoose={() => undefined}
      />,
    );
    expect(html).toContain("<h3>How would you like to start?</h3>");
    expect(html).toContain('aria-pressed="true"><strong>Guide me step by step</strong>');
    expect(html).toContain('aria-pressed="false"><strong>Show everything</strong>');
    expect(html).toContain("We show one thing to do at a time and explain each screen.");
    expect(html).toContain(">Decide later</button>");
    expect(html).not.toContain('type="checkbox"');
  });
});
