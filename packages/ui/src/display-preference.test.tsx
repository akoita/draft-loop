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

describe("the Display row in Workspace settings", () => {
  it("names the current way of working and offers to change it, with no checkbox", () => {
    const html = withMode("everything", <DisplaySetting />);
    expect(html).toContain("<strong>Display</strong>");
    expect(html).toContain('<span class="meta-chip">Show everything</span>');
    expect(html).toContain(">Change</button>");
    expect(html).toContain("Show everything opens every Advanced options section.");
    expect(html).not.toContain('type="checkbox"');
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
