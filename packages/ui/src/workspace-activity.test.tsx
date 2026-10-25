import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceActivityBar } from "./workspace-activity.js";

describe("Workspace activity bar", () => {
  it("shows a running profile generation with its progress and a way back to it", () => {
    const html = renderToStaticMarkup(
      <WorkspaceActivityBar
        activity={{
          kind: "profile-generation",
          generation: { startedAt: 0, progress: { completedCalls: 4, plannedCalls: 15 } },
        }}
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain("Generating your career profile…");
    expect(html).toContain("4 of 15 parts done");
    expect(html).toMatch(/<button[^>]*>View progress<\/button>/u);
  });

  it("names the application whose review is running", () => {
    const html = renderToStaticMarkup(
      <WorkspaceActivityBar
        activity={{ kind: "review-run", applicationName: "Acme — Backend Lead" }}
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain("Review running");
    expect(html).toContain("Acme — Backend Lead");
    expect(html).toMatch(/<button[^>]*>Open review<\/button>/u);
  });

  it("drops the action on the page that already shows the operation", () => {
    const html = renderToStaticMarkup(
      <WorkspaceActivityBar activity={{ kind: "review-run", applicationName: "Acme" }} />,
    );
    expect(html).not.toContain("<button");
  });
});
