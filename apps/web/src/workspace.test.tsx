import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiSchemas } from "./api-client.js";
import { WorkspaceSetupForm, WorkspaceSummary } from "./workspace.js";
import { defaultWorkspaceForm } from "./workspace-model.js";

const workspace: ApiSchemas["Workspace"] = {
  id: "owner",
  language: "en",
  requiredSections: ["Summary", "Experience"],
  maxRounds: 3,
  author: { company: "anthropic", model: "synthetic-author-1" },
  critic: { company: "openai", model: "synthetic-critic-1" },
  fixtureMode: true,
  knowledgeBaseIds: [],
};

describe("workspace screen", () => {
  it("shows the workspace's settings and models", () => {
    const html = renderToStaticMarkup(<WorkspaceSummary workspace={workspace} />);

    expect(html).toContain("<dd>Summary, Experience</dd>");
    expect(html).toContain("<dd>anthropic · synthetic-author-1</dd>");
    expect(html).toContain("<dd>openai · synthetic-critic-1</dd>");
    expect(html).toContain("Fixture mode: no model calls");
    expect(html).not.toContain("same company");
  });

  it("warns when the saved pair comes from one company", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSummary
        workspace={{ ...workspace, critic: { company: "anthropic", model: "synthetic-critic-2" } }}
      />,
    );

    expect(html).toContain("same company");
  });

  it("offers the default cross-company pair when creating", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSetupForm
        form={defaultWorkspaceForm}
        problems={[]}
        busy={false}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(html).toContain('<option value="anthropic" selected="">Anthropic</option>');
    expect(html).toContain('<option value="openai" selected="">OpenAI</option>');
    expect(html).toContain("Create workspace");
    expect(html).not.toContain("same company");
  });

  it("shows what to fix and the same-company warning in the form", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSetupForm
        form={{ ...defaultWorkspaceForm, criticCompany: "anthropic" }}
        problems={["Allow from 1 to 10 rounds."]}
        busy={true}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(html).toContain('role="alert">Allow from 1 to 10 rounds.</p>');
    expect(html).toContain("same company");
    expect(html).toContain("Creating…");
  });
});
