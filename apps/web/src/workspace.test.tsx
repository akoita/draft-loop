import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiSchemas } from "./api-client.js";
import { WorkspaceSummary } from "./workspace.js";

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
});
