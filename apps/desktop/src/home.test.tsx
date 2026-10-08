import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationSummaryView } from "./application-contract.js";
import type { CareerEvidenceStatus } from "./career-evidence.js";
import {
  HomeView,
  type HomeViewProps,
  NewApplicationDialog,
  ProfileScreen,
  WorkspaceLocation,
} from "./home.js";
import type { HomeProfileStatus } from "./home-model.js";

const now = new Date("2026-10-08T12:00:00.000Z");

function application(overrides: Partial<ApplicationSummaryView> = {}): ApplicationSummaryView {
  return {
    id: "default",
    name: "Staff Platform Engineer",
    jobSourceKind: "local-file",
    status: "drafting",
    isDefault: true,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    runCount: 0,
    briefCount: 0,
    exportCount: 0,
    latestRunId: null,
    ...overrides,
  };
}

const selectedEvidence: CareerEvidenceStatus = {
  kind: "selected",
  storeId: "store-1",
  knowledgeBaseId: "base-1",
  displayName: "Engineering",
  sourceCount: 5,
  blockedCount: 0,
  semanticLine: null,
};

function render(overrides: Partial<HomeViewProps> = {}, canCreate = true): string {
  return renderToStaticMarkup(
    <HomeView
      workspaceTitle={<h1>Job search 2026</h1>}
      workspaceNavigation={<button type="button">Close workspace</button>}
      profile={{ kind: "reviewed", version: 2 }}
      evidence={selectedEvidence}
      legacyEvidenceSourceCount={0}
      applications={{ status: "ready", applications: [application()] }}
      now={now}
      {...(canCreate ? { onNewApplication: () => undefined } : {})}
      onOpenApplication={() => undefined}
      onManageProfile={() => undefined}
      onManageEvidence={() => undefined}
      {...overrides}
    />,
  );
}

describe("Home dashboard", () => {
  it("names the workspace and lists its sections as headings", () => {
    const html = render();
    expect(html).toContain("<h1>Job search 2026</h1>");
    for (const heading of ["Career profile", "Career evidence", "Applications"]) {
      expect(html).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`, "u"));
    }
    expect(html).toContain("Close workspace");
    expect(html).toContain("New application");
  });

  it.each<[HomeProfileStatus, string, string]>([
    [{ kind: "reviewed", version: 2 }, "Reviewed", "Manage profile"],
    [{ kind: "draft", version: 1 }, "Draft", "Review profile"],
    [{ kind: "failed", version: 1 }, "Failed", "Manage profile"],
    [{ kind: "none" }, "Not yet generated", "Generate profile"],
    [{ kind: "loading" }, "Checking", "Manage profile"],
  ])("shows the %j profile status", (profile, chip, action) => {
    const html = render({ profile });
    expect(html).toContain(chip);
    expect(html).toContain(action);
  });

  it("leaves the freshness slot to the profile card", () => {
    expect(render({ profileFreshness: <p>Slot content</p> })).toContain("Slot content");
    expect(render()).not.toContain("Slot content");
  });

  it("shows the knowledge base name and source readiness", () => {
    const html = render();
    expect(html).toContain("Engineering · 5 sources");
    expect(html).toContain("Manage evidence");
  });

  it("shows the empty evidence state with an add action", () => {
    const html = render({ evidence: { kind: "none" } });
    expect(html).toContain("No career evidence yet");
    expect(html).toContain("Add career evidence");
  });

  it("shows only the default application with a hint to start another", () => {
    const html = render();
    expect(html).toContain("Staff Platform Engineer");
    expect(html).toContain("Original workspace job");
    expect(html).toContain("No runs yet");
    expect(html).toContain("Applying for another role?");
  });

  it("lists several applications by latest activity with status, activity and run count", () => {
    const html = render({
      applications: {
        status: "ready",
        applications: [
          application(),
          application({
            id: "app-2",
            name: "Acme — Backend Lead",
            isDefault: false,
            status: "in-review",
            updatedAt: "2026-10-08T09:00:00.000Z",
            runCount: 3,
          }),
        ],
      },
    });
    expect(html.indexOf("Acme — Backend Lead")).toBeLessThan(html.indexOf("Staff Platform"));
    expect(html).toContain("In review");
    expect(html).toContain("Last activity 3 hours ago");
    expect(html).toContain("3 runs");
    expect(html).not.toContain("Applying for another role?");
    expect((html.match(/class="application-card"/gu) ?? []).length).toBe(2);
  });

  it("makes each application card a button named after the application", () => {
    const html = render();
    expect(html).toMatch(
      /<h3><button class="application-card-open" type="button"[^>]*>Staff Platform Engineer<\/button><\/h3>/u,
    );
  });

  it("explains loading and unavailable application lists", () => {
    expect(render({ applications: { status: "loading" } })).toContain("Loading applications");
    expect(render({ applications: { status: "unavailable" } })).toContain(
      "The applications could not be read",
    );
  });

  it("omits New application when the host cannot create applications", () => {
    expect(render({}, false)).not.toContain("New application");
  });

  it("disables navigation while a workspace operation is running", () => {
    const html = render({ disabled: true });
    expect(html.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the workspace settings section only when it has content", () => {
    expect(render()).not.toContain("Workspace settings");
    const html = render({ settings: <button type="button">Change models</button> });
    expect(html).toMatch(/<h2[^>]*>Workspace settings<\/h2>/u);
    expect(html).toContain("Change models");
  });

  it("shows an error banner as an alert", () => {
    expect(render({ errorMessage: "The application could not be opened." })).toContain(
      'role="alert"',
    );
  });
});

describe("workspace location", () => {
  it("is a labelled navigation that can be focused on arrival", () => {
    const html = renderToStaticMarkup(<WorkspaceLocation current="Home" />);
    expect(html).toContain('aria-label="Workspace location"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("← ");
  });

  it("offers a visible way back to Home on other screens", () => {
    const html = renderToStaticMarkup(
      <WorkspaceLocation current="Acme — Backend Lead" onHome={() => undefined} />,
    );
    expect(html).toContain("Home</button>");
    expect(html).toContain("←");
    expect(html).toContain("Acme — Backend Lead");
  });

  it("wraps the profile and evidence panels with a way back", () => {
    const html = renderToStaticMarkup(
      <ProfileScreen
        workspaceTitle={<h1>Job search 2026</h1>}
        workspaceNavigation={null}
        errorMessage={null}
        onHome={() => undefined}
      >
        <p>Panels</p>
      </ProfileScreen>,
    );
    expect(html).toContain("Career profile and evidence");
    expect(html).toContain("Home</button>");
    expect(html).toContain("Panels");
  });
});

describe("New application dialog", () => {
  const props = {
    draft: { name: "", jobText: "" },
    busy: false,
    errorMessage: null,
    onDraftChange: () => undefined,
    onSubmit: () => undefined,
    onCancel: () => undefined,
  };

  it("is a modal dialog labelled by its heading", () => {
    const html = renderToStaticMarkup(<NewApplicationDialog {...props} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="new-application-title"');
    expect(html).toMatch(/<h2 id="new-application-title">New application<\/h2>/u);
  });

  it("blocks creation until the name and job text are present, and says why", () => {
    const empty = renderToStaticMarkup(<NewApplicationDialog {...props} />);
    expect(empty).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
    expect(empty).toContain("Name the application");
    const ready = renderToStaticMarkup(
      <NewApplicationDialog {...props} draft={{ name: "Acme", jobText: "Role text" }} />,
    );
    expect(ready).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
  });

  it("shows a creation failure as an alert and a busy state", () => {
    const html = renderToStaticMarkup(
      <NewApplicationDialog
        {...props}
        draft={{ name: "Acme", jobText: "Role text" }}
        errorMessage="The pasted job description is empty."
        busy
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Creating…");
  });
});
