import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationSummaryView } from "./application-contract.js";
import type { CareerEvidenceStatus } from "./career-evidence.js";
import { careerEvidenceCardSubtitle, careerProfileCardSubtitle } from "./career-flow.js";
import { HomeView, type HomeViewProps, WorkspaceLocation } from "./home.js";
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
    archivedAt: null,
    modelProfiles: null,
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

  it("gives each card a one-line subtitle that matches its page intro", () => {
    const html = render();
    expect(html).toContain(`<p class="home-card-subtitle">${careerProfileCardSubtitle}</p>`);
    expect(html).toContain(`<p class="home-card-subtitle">${careerEvidenceCardSubtitle}</p>`);
    expect(html).toContain("raw material");
    expect(html).toContain("verified record");
  });

  it("shows the evidence, profile and applications flow with Applications current", () => {
    const html = render();
    expect(html).toContain('aria-label="Career flow"');
    expect(html).toMatch(
      /<li class="career-flow-step" aria-current="step">(<span[^>]*>→<\/span>)?Applications<\/li>/u,
    );
    expect((html.match(/aria-current="step"/gu) ?? []).length).toBe(1);
    expect(html).toContain('class="career-flow-link" type="button">Career evidence</button>');
    expect(html).toContain('class="career-flow-link" type="button">Career profile</button>');
  });

  it("offers no Career profile link in the flow when the host has no profile workflow", () => {
    const html = render({ profile: { kind: "unsupported" } });
    expect(html).toContain('type="button">Career evidence</button>');
    expect(html).not.toContain('type="button">Career profile</button>');
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

  it("keeps navigation open and disables only application changes while an operation runs", () => {
    const html = render({
      disabled: true,
      disabledReason: "Available again once the career profile is generated.",
    });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>New application<\/button>/u);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Manage evidence<\/button>/u);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Manage profile<\/button>/u);
    expect(html).toContain("Available again once the career profile is generated.");
    expect(render({ disabledReason: "Not shown" })).not.toContain("Not shown");
  });

  it("shows a running profile generation on the Career profile card", () => {
    const html = render({
      profile: { kind: "none" },
      profileGeneration: {
        startedAt: Date.now() - 36_000,
        progress: { completedCalls: 3, plannedCalls: 15 },
      },
      disabled: true,
    });
    expect(html).toContain("In progress");
    expect(html).not.toContain("Not yet generated");
    expect(html).toContain("3 of 15 parts done");
    expect(html).toMatch(/<button[^>]*>View progress<\/button>/u);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>View progress<\/button>/u);
  });

  it("marks the application whose review is running", () => {
    const html = render({ runningApplicationId: "default" });
    expect(html).toContain("Review running");
    expect(html).not.toContain(">Drafting<");
    expect(render()).toContain(">Drafting<");
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
      <WorkspaceLocation
        current="Acme — Backend Lead"
        back={{ label: "Home", onBack: () => undefined }}
      />,
    );
    expect(html).toContain("Home</span></button>");
    expect(html).toContain('aria-label="Back to Home"');
    expect(html).toContain("←");
    expect(html).toContain("Acme — Backend Lead");
  });
});
