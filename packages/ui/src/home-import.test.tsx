import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { applicationImportExplanation } from "./application-import-model.js";
import { HomeView, type HomeViewProps } from "./home.js";

const now = new Date("2026-10-08T12:00:00.000Z");

function render(overrides: Partial<HomeViewProps> = {}, canImport = true): string {
  return renderToStaticMarkup(
    <HomeView
      workspaceTitle={<h1>Job search 2026</h1>}
      workspaceNavigation={<button type="button">Close workspace</button>}
      profile={{ kind: "reviewed", version: 2 }}
      evidence={{ kind: "none" }}
      legacyEvidenceSourceCount={0}
      applications={{ status: "ready", applications: [] }}
      now={now}
      onNewApplication={() => undefined}
      {...(canImport ? { onImportApplication: () => undefined } : {})}
      onOpenApplication={() => undefined}
      onManageProfile={() => undefined}
      onManageEvidence={() => undefined}
      {...overrides}
    />,
  );
}

describe("Home: import from another workspace", () => {
  it("offers a secondary import action before New application, with its explanation", () => {
    const html = render();
    expect(html).toContain("Import from another workspace");
    expect(html).toContain("New application");
    expect(html.indexOf("Import from another workspace")).toBeLessThan(
      html.indexOf("New application</button>"),
    );
    expect(html).toContain('class="button button-outline"');
    expect(html).toContain('aria-describedby="home-import-explanation"');
    expect(html).toContain(`id="home-import-explanation">${applicationImportExplanation}`);
  });

  it("hides the action and its explanation when the host cannot import", () => {
    const html = render({}, false);
    expect(html).not.toContain("Import from another workspace");
    expect(html).not.toContain("home-import-explanation");
  });

  it("disables the action while importing and while the workspace is busy", () => {
    expect(render({ importing: true })).toMatch(
      /<button[^>]*disabled=""[^>]*>Importing…<\/button>/u,
    );
    expect(render({ disabled: true })).toMatch(
      /<button[^>]*disabled=""[^>]*>Import from another workspace<\/button>/u,
    );
  });

  it.each([
    "The selected folder is not a DraftLoop workspace.",
    'This workspace was already imported as the application "First Job".',
  ])("announces the refusal %j as an alert", (message) => {
    const html = render({ importNotice: { kind: "error", message } });
    expect(html).toContain('role="alert"');
    expect(html).toContain(message.replaceAll('"', "&quot;"));
  });

  it("announces a successful import politely", () => {
    const html = render({
      importNotice: { kind: "success", message: 'Imported "Acme" as an application.' },
    });
    expect(html).toContain('role="status"');
    expect(html).toContain("Imported &quot;Acme&quot; as an application.");
  });
});
