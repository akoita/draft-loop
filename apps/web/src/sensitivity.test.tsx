import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SensitivityRulesPanel } from "./sensitivity.js";
import { defaultRuleForm } from "./sensitivity-model.js";

const render = (props: Partial<Parameters<typeof SensitivityRulesPanel>[0]>) =>
  renderToStaticMarkup(
    <SensitivityRulesPanel
      knowledgeBaseId="career"
      rules={[]}
      form={defaultRuleForm}
      problems={[]}
      busy={false}
      onChange={() => {}}
      onAdd={() => {}}
      onRemove={() => {}}
      {...props}
    />,
  );

describe("sensitivity rules panel", () => {
  it("lists each rule with a way to remove it", () => {
    const html = render({
      rules: [
        { id: "notes", tier: "never-share", match: { kind: "heading-contains", text: "Notes" } },
      ],
    });

    expect(html).toContain("Never share · heading contains &quot;Notes&quot;");
    expect(html).toContain(">Remove</button>");
  });

  it("says when no section is marked, and while the rules load", () => {
    expect(render({})).toContain("No rules: every section can be used.");
    expect(render({ rules: undefined })).toContain("Reading the rules…");
  });

  it("asks for a heading path when matching by headings, and shows what to fix", () => {
    const html = render({
      form: { ...defaultRuleForm, kind: "heading-path" },
      problems: ["Name the headings, from the top level down."],
    });

    expect(html).toContain("Headings, top level first, separated by &gt;");
    expect(html).toContain('id="rule-heading-career"');
    expect(html).toContain('role="alert">Name the headings, from the top level down.</p>');
  });
});
