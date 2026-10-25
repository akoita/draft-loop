import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApplicationSummaryView } from "./application-contract.js";
import { ApplicationNameNudge, ApplicationTitle } from "./application-name.js";
import { needsApplicationName } from "./application-name-model.js";
import { ApplicationCard } from "./home.js";

const now = new Date("2026-10-11T12:00:00.000Z");
const rename = async () => undefined;

function application(overrides: Partial<ApplicationSummaryView> = {}): ApplicationSummaryView {
  return {
    id: "default",
    name: "Default application",
    jobSourceKind: "local-file",
    status: "exported",
    isDefault: true,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-11T06:00:00.000Z",
    runCount: 1,
    briefCount: 1,
    exportCount: 1,
    latestRunId: "run-1",
    archivedAt: null,
    modelProfiles: null,
    nameChosen: false,
    suggestedName: "Platform Engineer at Example Systems",
    ...overrides,
  };
}

function card(summary: ApplicationSummaryView, withRename = true): string {
  return renderToStaticMarkup(
    <ul>
      <ApplicationCard
        application={summary}
        now={now}
        onOpen={() => undefined}
        actions={withRename ? { onRename: rename } : {}}
      />
    </ul>,
  );
}

describe("application names", () => {
  it("asks for a name only while the active default application has the derived one", () => {
    expect(needsApplicationName(application())).toBe(true);
    expect(needsApplicationName(application({ nameChosen: true }))).toBe(false);
    expect(needsApplicationName(application({ archivedAt: "2026-10-11T07:00:00.000Z" }))).toBe(
      false,
    );
    expect(needsApplicationName(application({ id: "app-1", isDefault: false }))).toBe(false);
  });

  it("renames the page heading in place from a double-click or the accessible pencil", () => {
    const markup = renderToStaticMarkup(
      <ApplicationTitle name="Default application" onRename={rename} />,
    );
    expect(markup).toContain("workspace-title-editable");
    expect(markup).toContain('aria-label="Rename application Default application"');
    expect(markup).toContain('<h1 class="home-location-current" title="Default application"');
    expect(renderToStaticMarkup(<ApplicationTitle name="Default application" />)).not.toContain(
      "Rename",
    );
  });

  it("offers the brief's role and employer, a name of one's own, or keeping the name", () => {
    const markup = renderToStaticMarkup(
      <ApplicationNameNudge
        name="Default application"
        suggestedName="Platform Engineer at Example Systems"
        onRename={rename}
        onChooseName={() => undefined}
      />,
    );
    expect(markup).toContain(">Name this application</h2>");
    expect(markup).toContain(">Use “Platform Engineer at Example Systems”</button>");
    expect(markup).toContain(">Choose another name</button>");
    expect(markup).toContain(">Keep “Default application”</button>");

    const withoutSuggestion = renderToStaticMarkup(
      <ApplicationNameNudge
        name="Default application"
        suggestedName={null}
        onRename={rename}
        onChooseName={() => undefined}
      />,
    );
    expect(withoutSuggestion).not.toContain(">Use ");
    expect(withoutSuggestion).toContain(
      'class="button button-primary" type="button">Choose a name',
    );
  });

  it("puts a pencil beside each card's name and nudges the unnamed default application", () => {
    const unnamed = card(application());
    expect(unnamed).toContain('aria-label="Rename Default application"');
    expect(unnamed).toContain("such as “Platform Engineer at Example Systems”.");
    expect(unnamed).toContain(">Name it</button>");

    const named = card(application({ name: "Example Systems — Platform", nameChosen: true }));
    expect(named).toContain('aria-label="Rename Example Systems — Platform"');
    expect(named).not.toContain("Name it");

    const readOnly = card(application(), false);
    expect(readOnly).not.toContain("Rename");
    expect(readOnly).not.toContain("Name it");
  });
});
