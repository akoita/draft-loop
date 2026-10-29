import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiSchemas } from "./api-client.js";
import { BaseRules, type BaseRulesProps, PrivateSectionsPanel } from "./private-sections.js";
import { defaultRuleForm } from "./sensitivity-model.js";

const base = (id: string, displayName: string): ApiSchemas["KnowledgeBase"] => ({
  id,
  displayName,
  description: "",
  state: "active",
  createdAt: "2026-10-23T00:00:00.000Z",
  archivedAt: null,
});

const rulesProps: BaseRulesProps = {
  knowledgeBaseId: "kb-1",
  rules: [
    { id: "r1", tier: "never-share", match: { kind: "heading-contains", text: "Salary" } },
    { id: "r2", tier: "sensitive", match: { kind: "heading-path", path: ["Health", "Notes"] } },
  ],
  form: defaultRuleForm,
  problems: [],
  busy: false,
  onChange: () => {},
  onAdd: () => {},
  onRemove: () => {},
};

describe("private sections on the Career evidence page", () => {
  it("lists the rules as sentences with a removal for each", () => {
    const html = renderToStaticMarkup(<BaseRules {...rulesProps} />);

    expect(html).toContain("Never send sections whose heading contains &quot;Salary&quot;");
    expect(html).toContain("Send only if the workspace allows: sections under Health › Notes");
    expect(html).toContain(
      "Remove rule: Send only if the workspace allows: sections under Health › Notes",
    );
  });

  it("adds a rule with one line that reads as a sentence", () => {
    const html = renderToStaticMarkup(<BaseRules {...rulesProps} />);

    expect(html).toContain('aria-label="What to do with matching sections"');
    expect(html).toContain("Never send</option>");
    expect(html).toContain("Send only if allowed</option>");
    expect(html).toContain("sections whose heading");
    expect(html).toContain('aria-label="How the heading matches"');
    expect(html).toContain("contains</option>");
    expect(html).toContain("is under</option>");
    expect(html).toContain('aria-label="Heading text"');
    expect(html).toContain("Add rule");
  });

  it("explains a heading path in the input's label", () => {
    const html = renderToStaticMarkup(
      <BaseRules {...rulesProps} form={{ ...defaultRuleForm, kind: "heading-path" }} />,
    );

    expect(html).toContain("Headings, top level first, separated by &gt;");
  });

  it("says when no rule exists, while rules load, and why a change failed", () => {
    expect(renderToStaticMarkup(<BaseRules {...rulesProps} rules={[]} />)).toContain(
      "No rules: every section can be used.",
    );
    expect(renderToStaticMarkup(<BaseRules {...rulesProps} rules={undefined} />)).toContain(
      "Reading the rules…",
    );
    expect(
      renderToStaticMarkup(<BaseRules {...rulesProps} problems={["Name the heading text."]} />),
    ).toContain('role="alert">Name the heading text.</p>');
  });

  it("explains never-send and only-if-allowed in one sentence", () => {
    const html = renderToStaticMarkup(
      <PrivateSectionsPanel bases={[base("kb-1", "Career")]} rulesFor={() => null} />,
    );

    expect(html).toContain("Never-send sections never reach a model");
    expect(html).toContain("only-if-allowed sections stay out unless the workspace allows");
  });

  it("names a base only when several are selected", () => {
    const rulesFor = (item: ApiSchemas["KnowledgeBase"]) => <p>Rules of {item.id}</p>;
    const one = renderToStaticMarkup(
      <PrivateSectionsPanel bases={[base("kb-1", "Career")]} rulesFor={rulesFor} />,
    );
    const two = renderToStaticMarkup(
      <PrivateSectionsPanel
        bases={[base("kb-1", "Career"), base("kb-2", "Project notes")]}
        rulesFor={rulesFor}
      />,
    );

    expect(one).toContain("Rules of kb-1");
    expect(one).not.toContain("<h3>");
    expect(two).toContain("<h3>Career</h3>");
    expect(two).toContain("<h3>Project notes</h3>");
  });

  it("says rules apply once a knowledge base is chosen", () => {
    const html = renderToStaticMarkup(<PrivateSectionsPanel bases={[]} rulesFor={() => null} />);

    expect(html).toContain("Rules apply once a knowledge base is chosen.");
  });
});
