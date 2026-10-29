import { workspaceSetupPresets } from "@draft-loop/ui/workspace-setup";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { WorkspaceStep, WorkspaceStepView, type WorkspaceStepViewProps } from "./workspace.js";

const unusedClient: ApiClient = {
  call: async () => {
    throw new Error("not called while rendering");
  },
};

const view = (overrides: Partial<WorkspaceStepViewProps>) =>
  renderToStaticMarkup(
    <WorkspaceStepView
      state={{ kind: "missing" }}
      presets={workspaceSetupPresets()}
      busy={false}
      problem={null}
      onCreate={() => {}}
      {...overrides}
    />,
  );

describe("first-run setup", () => {
  it("reads the workspace first", () => {
    expect(
      renderToStaticMarkup(<WorkspaceStep client={unusedClient} onWorkspace={() => {}} />),
    ).toContain("Reading your workspace…");
  });

  it("shows the shared setup screen while the record has no workspace", () => {
    const html = view({});

    expect(html).toContain('class="shared-screens"');
    expect(html).toContain("Set up your workspace");
  });

  it("says why the setup could not be saved", () => {
    expect(view({ problem: "The plan does not include this pair." })).toContain(
      "The plan does not include this pair.",
    );
  });

  it("shows nothing of its own once the workspace is read, and explains a failure", () => {
    const ready = view({
      state: {
        kind: "ready",
        workspace: {
          id: "owner",
          language: "en",
          requiredSections: [],
          maxRounds: 3,
          author: { company: "anthropic", model: "synthetic-author-1" },
          critic: { company: "openai", model: "synthetic-critic-1" },
          fixtureMode: true,
          knowledgeBaseIds: [],
        },
      },
    });
    expect(ready).toBe("");
    expect(view({ state: { kind: "failed", message: "The API is down." } })).toContain(
      'role="alert">The API is down.</p>',
    );
  });
});
