import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdvancedOption, AdvancedOptions } from "./advanced-options.js";

describe("Advanced options", () => {
  it("is a folded native disclosure with one fixed label", () => {
    const html = renderToStaticMarkup(
      <AdvancedOptions>
        <p>Inside</p>
      </AdvancedOptions>,
    );
    expect(html).toMatch(/^<details class="advanced-options"><summary>Advanced options<\/summary>/);
    expect(html).toContain("Most people never need these.");
    expect(html).toContain("<p>Inside</p>");
  });

  it("says on the folded line what is not at its default", () => {
    const html = renderToStaticMarkup(
      <AdvancedOptions note="2 rules">
        <p>Inside</p>
      </AdvancedOptions>,
    );
    expect(html).toContain('<span class="advanced-options-note"> · 2 rules</span></summary>');
  });

  it("opens when its owner says so", () => {
    const html = renderToStaticMarkup(
      <AdvancedOptions open>
        <p>Inside</p>
      </AdvancedOptions>,
    );
    expect(html).toContain('<details class="advanced-options" open="">');
  });

  it("shows an option as a name, a state, an effect and one control", () => {
    const html = renderToStaticMarkup(
      <AdvancedOption title="Search mode" state="Keyword" effect="How documents are searched.">
        <button type="button">Change</button>
      </AdvancedOption>,
    );
    expect(html).toContain("<strong>Search mode</strong>");
    expect(html).toContain('<span class="meta-chip">Keyword</span>');
    expect(html).toContain("<p>How documents are searched.</p>");
    expect(html).toContain("<button");
  });
});
