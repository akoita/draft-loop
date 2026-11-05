import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HostPanelsContext, HostWorkspaceSettings } from "./host-panels.js";
import {
  PreferenceSuggestionsPanel,
  type PreferenceSuggestionView,
  preferenceSuggestionTitle,
} from "./preference-suggestions-panel.js";

const term: PreferenceSuggestionView = {
  id: "preference-0123456789abcdef",
  kind: "forbidden-term",
  term: "passionate",
  reason: 'You removed "passionate" from 3 drafts across 2 applications.',
};
const order: PreferenceSuggestionView = {
  id: "preference-fedcba9876543210",
  kind: "section-order",
  sectionOrder: ["summary", "skills", "experience"],
  reason: "You approved 3 drafts across 2 applications with sections in this order.",
};
const decide = async () => undefined;

describe("suggested preferences panel", () => {
  it("shows each suggestion with its reason and both decisions", () => {
    const html = renderToStaticMarkup(
      <PreferenceSuggestionsPanel suggestions={[term, order]} onDecide={decide} />,
    );
    expect(html).toContain("Suggested preferences");
    expect(html).toContain("You decide");
    expect(html).toContain("Never use &quot;passionate&quot;");
    expect(html).toContain("Order sections as summary, skills, experience");
    expect(html).toContain("You removed &quot;passionate&quot; from 3 drafts");
    expect(html.match(/Add to policy/gu)).toHaveLength(2);
    expect(html.match(/Dismiss/gu)).toHaveLength(2);
  });

  it("shows nothing before the read or when nothing is suggested", () => {
    expect(
      renderToStaticMarkup(
        <PreferenceSuggestionsPanel suggestions={undefined} onDecide={decide} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(<PreferenceSuggestionsPanel suggestions={[]} onDecide={decide} />),
    ).toBe("");
  });

  it("shows a read problem", () => {
    const html = renderToStaticMarkup(
      <PreferenceSuggestionsPanel suggestions={undefined} problem="Not read." onDecide={decide} />,
    );
    expect(html).toContain('role="alert"');
  });

  it("titles each kind in plain words", () => {
    expect(preferenceSuggestionTitle(term)).toBe('Never use "passionate"');
    expect(preferenceSuggestionTitle(order)).toBe("Order sections as summary, skills, experience");
  });

  it("renders the host's Workspace settings panel, and nothing without one", () => {
    expect(renderToStaticMarkup(<HostWorkspaceSettings />)).toBe("");
    const html = renderToStaticMarkup(
      <HostPanelsContext.Provider value={{ workspaceSettings: () => <p>host panel</p> }}>
        <HostWorkspaceSettings />
      </HostPanelsContext.Provider>,
    );
    expect(html).toBe("<p>host panel</p>");
  });
});
