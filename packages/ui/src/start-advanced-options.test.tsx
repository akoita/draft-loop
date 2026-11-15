import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  type PolicyOverrideOption,
  StartAdvancedOptions,
  startAdvancedNote,
} from "./start-advanced-options.js";
import {
  rawJobDescriptionChoiceLabel,
  rawJobDescriptionChoiceNote,
  rawJobDescriptionOverDraftLabel,
} from "./start-requirements-model.js";

const override: PolicyOverrideOption = {
  reviewed: true,
  pending: null,
  disabled: false,
  onImport: () => undefined,
};
const raw = (chosen: boolean) => ({ chosen, onChange: () => undefined });

describe("the review step's Advanced options", () => {
  it("is one folded section holding both choices as rows with a button, not a checkbox", () => {
    const html = renderToStaticMarkup(
      <StartAdvancedOptions rawJobDescription={raw(false)} policyOverride={override} />,
    );
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).toContain("<summary>Advanced options</summary>");
    expect(html).toContain(rawJobDescriptionChoiceLabel());
    expect(html).toContain(rawJobDescriptionChoiceNote());
    expect(html).toContain('<span class="meta-chip">Off</span>');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Writing policy override for this job");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain(rawJobDescriptionOverDraftLabel());
  });

  it("states the raw job description outside the fold and on its line once chosen", () => {
    const html = renderToStaticMarkup(
      <StartAdvancedOptions rawJobDescription={raw(true)} policyOverride={override} />,
    );
    expect(html).toContain('<span class="advanced-options-note"> · raw job description</span>');
    expect(html).toContain('<span class="meta-chip">On</span>');
    expect(html).toMatch(
      new RegExp(
        `</details><p class="start-requirements-line" role="status">${rawJobDescriptionOverDraftLabel().replace(/[()]/g, "\\$&")}</p>`,
      ),
    );
  });

  it("offers the raw job description alone where the override lives elsewhere", () => {
    const html = renderToStaticMarkup(<StartAdvancedOptions rawJobDescription={raw(false)} />);
    expect(html).toContain(">Use the raw job description</button>");
    expect(html).not.toContain("Writing policy override");
  });

  it("names a pending override and blocks the import until the requirements are reviewed", () => {
    const pending = { ...override, pending: { version: "v3", checksumLabel: "ab12" } };
    expect(startAdvancedNote({ policyOverride: pending })).toBe("policy override");
    expect(startAdvancedNote({ rawJobDescription: raw(true), policyOverride: pending })).toBe(
      "raw job description · policy override",
    );
    expect(startAdvancedNote({ policyOverride: override })).toBeNull();
    const html = renderToStaticMarkup(
      <StartAdvancedOptions policyOverride={{ ...pending, reviewed: false }} />,
    );
    expect(html).toContain('<span class="meta-chip">v3 (ab12)</span>');
    expect(html).toContain("Review the requirements before importing an override.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Import opportunity override</);
  });

  it("shows nothing without a choice to offer", () => {
    expect(renderToStaticMarkup(<StartAdvancedOptions />)).toBe("");
  });
});
