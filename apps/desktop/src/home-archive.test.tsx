import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  applicationActionErrorNotice,
  applicationActionSuccessNotice,
  applicationDeleteExplanation,
  canDeleteApplication,
  partitionApplications,
} from "./application-archive-model.js";
import type { ApplicationSummaryView } from "./application-contract.js";
import { ApplicationCard, HomeView, type HomeViewProps } from "./home.js";

const now = new Date("2026-10-09T12:00:00.000Z");

function application(overrides: Partial<ApplicationSummaryView> = {}): ApplicationSummaryView {
  return {
    id: "app-1",
    name: "HCcompany",
    jobSourceKind: "pasted-text",
    status: "drafting",
    isDefault: false,
    createdAt: "2026-10-09T09:00:00.000Z",
    updatedAt: "2026-10-09T09:00:00.000Z",
    runCount: 0,
    briefCount: 0,
    exportCount: 0,
    latestRunId: null,
    archivedAt: null,
    modelProfiles: null,
    ...overrides,
  };
}

const defaultApplication = application({
  id: "default",
  name: "Default application",
  jobSourceKind: "local-file",
  isDefault: true,
  updatedAt: "2026-10-08T20:00:00.000Z",
});

function render(
  applications: readonly ApplicationSummaryView[],
  overrides: Partial<HomeViewProps> = {},
  withActions = true,
): string {
  return renderToStaticMarkup(
    <HomeView
      workspaceTitle={<h1>Job search 2026</h1>}
      workspaceNavigation={<button type="button">Close workspace</button>}
      profile={{ kind: "reviewed", version: 2 }}
      evidence={{ kind: "none" }}
      legacyEvidenceSourceCount={0}
      applications={{ status: "ready", applications }}
      now={now}
      {...(withActions
        ? { onArchiveApplication: () => undefined, onDeleteApplication: () => undefined }
        : {})}
      onOpenApplication={() => undefined}
      onManageProfile={() => undefined}
      onManageEvidence={() => undefined}
      {...overrides}
    />,
  );
}

describe("application archive rules", () => {
  it("deletes only created applications that hold nothing", () => {
    expect(canDeleteApplication(application())).toBe(true);
    expect(canDeleteApplication(defaultApplication)).toBe(false);
    expect(canDeleteApplication(application({ runCount: 1 }))).toBe(false);
    expect(canDeleteApplication(application({ briefCount: 1 }))).toBe(false);
    expect(canDeleteApplication(application({ exportCount: 1 }))).toBe(false);
  });

  it("splits active from archived applications, keeping their order", () => {
    const archived = application({ id: "app-2", archivedAt: "2026-10-09T10:00:00.000Z" });
    expect(partitionApplications([defaultApplication, archived, application()])).toEqual({
      active: [defaultApplication, application()],
      archived: [archived],
    });
  });

  it("words each outcome, and falls back when a failure has no usable message", () => {
    expect(applicationActionSuccessNotice("HCcompany", "archive").message).toBe(
      'Archived "HCcompany". Show archived applications to restore it.',
    );
    expect(applicationActionSuccessNotice("HCcompany", "restore").message).toBe(
      'Restored "HCcompany".',
    );
    expect(applicationActionSuccessNotice("HCcompany", "delete").message).toBe(
      'Deleted "HCcompany".',
    );
    expect(
      applicationActionErrorNotice(
        new Error("This application has runs, briefs or exports, so it can only be archived."),
        "delete",
      ).message,
    ).toBe("This application has runs, briefs or exports, so it can only be archived.");
    expect(applicationActionErrorNotice("boom", "archive")).toEqual({
      kind: "error",
      message: "The application could not be archived. Try again.",
    });
  });
});

describe("Home: archiving and deleting applications", () => {
  it("offers Archive on every card and Delete only where it is allowed", () => {
    const html = render([
      defaultApplication,
      application(),
      application({ id: "app-run", name: "Ran", runCount: 1 }),
    ]);
    expect(html).toContain('aria-label="Archive Default application"');
    expect(html).toContain('aria-label="Archive HCcompany"');
    expect(html).toContain('aria-label="Archive Ran"');
    expect(html).toContain('aria-label="Delete HCcompany"');
    expect(html).not.toContain('aria-label="Delete Default application"');
    expect(html).not.toContain('aria-label="Delete Ran"');
  });

  it("offers no card actions when the host cannot archive or delete", () => {
    const html = render([application()], {}, false);
    expect(html).not.toContain("application-card-actions");
  });

  it("hides archived applications behind a toggle with their count", () => {
    const archived = application({ id: "app-2", name: "Old job", archivedAt: now.toISOString() });
    const html = render([defaultApplication, archived]);
    expect(html).toContain("Show archived (1)");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Old job");
    expect(html).not.toContain("Applying for another role?");

    const shown = render([defaultApplication, archived], { initialShowArchived: true });
    expect(shown).toContain("Hide archived");
    expect(shown).toContain('aria-label="Archived applications"');
    expect(shown).toContain('aria-label="Restore Old job"');
    expect(shown).toContain('aria-label="Delete Old job"');
    expect(shown).toContain(applicationDeleteExplanation);
  });

  it("says so when every application is archived", () => {
    const html = render([{ ...defaultApplication, archivedAt: now.toISOString() }]);
    expect(html).not.toContain('aria-label="Applications"');
    expect(html).toContain("Every application is archived.");
    expect(html).toContain("Show archived (1)");
  });

  it("disables the actions while one is running or the workspace is busy", () => {
    expect(render([application()], { busyApplicationId: "app-1" })).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Archive HCcompany"/u,
    );
    expect(render([application()], { disabled: true })).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Delete HCcompany"/u,
    );
  });

  it("announces the outcome as a status or an alert", () => {
    expect(
      render([application()], {
        applicationNotice: applicationActionSuccessNotice("Old job", "delete"),
      }),
    ).toContain('role="status">Deleted &quot;Old job&quot;.</p>');
    expect(
      render([application()], {
        applicationNotice: { kind: "error", message: "The application could not be deleted." },
      }),
    ).toContain('role="alert"><p>The application could not be deleted.</p>');
  });

  it("asks before deleting, naming the application", () => {
    const html = renderToStaticMarkup(
      <ul>
        <ApplicationCard
          application={application()}
          now={now}
          onOpen={() => undefined}
          actions={{
            confirmingDelete: true,
            onArchive: () => undefined,
            onRequestDelete: () => undefined,
            onConfirmDelete: () => undefined,
            onCancelDelete: () => undefined,
          }}
        />
      </ul>,
    );
    expect(html).toContain("<legend>Delete &quot;HCcompany&quot;? This cannot be undone.</legend>");
    expect(html).toMatch(/<button class="button button-danger" type="button">Delete<\/button>/u);
    expect(html).toContain(">Cancel</button>");
    expect(html).not.toContain('aria-label="Archive HCcompany"');
  });
});
