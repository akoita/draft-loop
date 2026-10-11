import { describe, expect, it } from "vitest";

import type { ApplicationSummaryView } from "./application-contract.js";
import type { CareerEvidenceStatus } from "./career-evidence.js";
import {
  applicationActivityText,
  applicationRunText,
  applicationStatusLabel,
  applicationsByActivity,
  applicationView,
  evidencePresentation,
  evidenceView,
  homeActionsBlockedReason,
  homeView,
  isHomeView,
  loadHomeProfileStatus,
  newApplicationView,
  onlyDefaultApplication,
  profileStatusPresentation,
  profileView,
  workspaceEntryView,
} from "./home-model.js";
import type { DesktopProfileCapabilities } from "./native.js";

function application(overrides: Partial<ApplicationSummaryView> = {}): ApplicationSummaryView {
  return {
    id: "app-1",
    name: "Acme",
    jobSourceKind: "pasted-text",
    status: "drafting",
    isDefault: false,
    createdAt: "2026-10-08T10:00:00.000Z",
    updatedAt: "2026-10-08T10:00:00.000Z",
    runCount: 0,
    briefCount: 0,
    exportCount: 0,
    latestRunId: null,
    archivedAt: null,
    modelProfiles: null,
    ...overrides,
  };
}

describe("workspace navigation", () => {
  it("lands on Home when a workspace is opened", () => {
    expect(workspaceEntryView()).toEqual(homeView);
    expect(isHomeView(workspaceEntryView())).toBe(true);
  });

  it("opens an application or the profile screen as another view", () => {
    expect(applicationView("app-1", "Acme")).toEqual({
      kind: "application",
      applicationId: "app-1",
      name: "Acme",
    });
    expect(isHomeView(applicationView("app-1", "Acme"))).toBe(false);
    expect(isHomeView(profileView)).toBe(false);
  });

  it("keeps Career evidence and Career profile as two separate views", () => {
    expect(evidenceView).toEqual({ kind: "evidence" });
    expect(profileView).toEqual({ kind: "profile" });
    expect(evidenceView).not.toEqual(profileView);
    expect(isHomeView(evidenceView)).toBe(false);
  });

  it("opens the guided New application flow as its own view", () => {
    expect(newApplicationView).toEqual({ kind: "new-application" });
    expect(isHomeView(newApplicationView)).toBe(false);
  });
});

describe("career profile status", () => {
  it("words each status and names the next action", () => {
    expect(profileStatusPresentation({ kind: "none" })).toMatchObject({
      chip: "Not yet generated",
      action: "Generate profile",
    });
    expect(profileStatusPresentation({ kind: "draft", version: 2 })).toMatchObject({
      chip: "Draft",
      tone: "attention",
      action: "Review profile",
    });
    expect(profileStatusPresentation({ kind: "failed", version: 1 })).toMatchObject({
      chip: "Failed",
      tone: "error",
    });
    expect(profileStatusPresentation({ kind: "reviewed", version: 3 })).toMatchObject({
      chip: "Reviewed",
      tone: "ready",
    });
    expect(profileStatusPresentation({ kind: "loading" }).chip).toBe("Checking");
    expect(profileStatusPresentation({ kind: "unavailable" }).tone).toBe("error");
    expect(profileStatusPresentation({ kind: "unsupported" }).chip).toBe("Unavailable");
  });

  const record = (facts: number, issues: readonly unknown[] = []) =>
    ({
      workspaceId: "workspace-1",
      profileId: "profile-1",
      version: 1,
      status: "draft",
      facts: Array.from({ length: facts }, (_, index) => ({ id: `fact-${index}` })),
      issues,
    }) as never;

  const capabilities = (
    summaries: unknown,
    read?: DesktopProfileCapabilities["getCanonicalCandidateProfile"],
  ): DesktopProfileCapabilities => ({
    listCanonicalCandidateProfileSummaries: async () => {
      if (summaries instanceof Error) throw summaries;
      return summaries as never;
    },
    ...(read === undefined ? {} : { getCanonicalCandidateProfile: read }),
  });

  it("reads none, reviewed, draft and failed from the saved profiles", async () => {
    await expect(loadHomeProfileStatus({}, "workspace-1")).resolves.toEqual({
      kind: "unsupported",
    });
    await expect(loadHomeProfileStatus(capabilities([]), "workspace-1")).resolves.toEqual({
      kind: "none",
    });
    await expect(
      loadHomeProfileStatus(
        capabilities([
          { profileId: "profile-1", latestVersion: 3, status: "reviewed", updatedAt: "x" },
        ]),
        "workspace-1",
      ),
    ).resolves.toEqual({ kind: "reviewed", version: 3 });
    const draft = [{ profileId: "profile-1", latestVersion: 1, status: "draft", updatedAt: "x" }];
    await expect(
      loadHomeProfileStatus(
        capabilities(draft, async () => record(2)),
        "workspace-1",
      ),
    ).resolves.toEqual({ kind: "draft", version: 1 });
    await expect(
      loadHomeProfileStatus(
        capabilities(draft, async () =>
          record(0, [
            {
              id: "issue-1",
              code: "omission",
              severity: "error",
              status: "open",
              message: "No facts were saved.",
              factIds: [],
              sourceRefs: [],
            },
          ]),
        ),
        "workspace-1",
      ),
    ).resolves.toEqual({ kind: "failed", version: 1 });
  });

  it("reports an unreadable catalog as unavailable", async () => {
    await expect(
      loadHomeProfileStatus(capabilities(new Error("boom")), "workspace-1"),
    ).resolves.toEqual({ kind: "unavailable" });
  });
});

describe("career evidence presentation", () => {
  const selected = (sourceCount: number, blockedCount = 0): CareerEvidenceStatus => ({
    kind: "selected",
    storeId: "store-1",
    knowledgeBaseId: "base-1",
    displayName: "Engineering",
    sourceCount,
    blockedCount,
    semanticLine: null,
  });

  it("shows the knowledge base name and source readiness", () => {
    expect(evidencePresentation(selected(4), 0)).toMatchObject({
      chip: "Ready",
      headline: "Engineering · 4 sources",
      empty: false,
    });
    expect(evidencePresentation(selected(4, 2), 0)).toMatchObject({
      chip: "Needs attention",
      detail: "2 not ready",
    });
  });

  it("treats an empty base and no base as the empty state", () => {
    expect(evidencePresentation(selected(0), 0)).toMatchObject({
      chip: "Empty",
      empty: true,
      action: "Add career evidence",
    });
    expect(evidencePresentation({ kind: "none" }, 0)).toMatchObject({
      empty: true,
      headline: "No career evidence yet",
    });
    expect(evidencePresentation({ kind: "unsupported" }, 0).empty).toBe(true);
  });

  it("counts legacy workspace files when no base is selected", () => {
    expect(evidencePresentation({ kind: "none" }, 3)).toMatchObject({
      empty: false,
      headline: "3 source files in this workspace",
    });
  });

  it("reports an unreadable base without calling it empty", () => {
    expect(evidencePresentation({ kind: "unavailable" }, 0)).toMatchObject({
      tone: "error",
      empty: false,
    });
  });
});

describe("application list wording", () => {
  const now = new Date("2026-10-08T12:00:00.000Z");

  it("describes last activity in words", () => {
    expect(applicationActivityText("2026-10-08T11:59:40.000Z", now)).toBe("Last activity just now");
    expect(applicationActivityText("2026-10-08T11:30:00.000Z", now)).toBe(
      "Last activity 30 minutes ago",
    );
    expect(applicationActivityText("2026-10-08T11:00:00.000Z", now)).toBe(
      "Last activity 1 hour ago",
    );
    expect(applicationActivityText("2026-10-05T12:00:00.000Z", now)).toBe(
      "Last activity 3 days ago",
    );
    expect(applicationActivityText("2026-08-01T12:00:00.000Z", now)).toBe(
      "Last activity on 2026-08-01",
    );
    expect(applicationActivityText("garbage", now)).toBe("Last activity unknown");
  });

  it("words run counts and statuses", () => {
    expect(applicationRunText(0)).toBe("No runs yet");
    expect(applicationRunText(1)).toBe("1 run");
    expect(applicationRunText(4)).toBe("4 runs");
    expect(applicationStatusLabel("in-review")).toBe("In review");
  });

  it("orders by latest activity and detects a workspace with only the default one", () => {
    const old = application({
      id: "default",
      isDefault: true,
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const recent = application({ id: "app-2", updatedAt: "2026-10-07T00:00:00.000Z" });
    expect(applicationsByActivity([old, recent]).map((item) => item.id)).toEqual([
      "app-2",
      "default",
    ]);
    expect(onlyDefaultApplication([old])).toBe(true);
    expect(onlyDefaultApplication([old, recent])).toBe(false);
  });
});

describe("actions held back by a running operation", () => {
  it("names the operation the person is waiting on", () => {
    expect(homeActionsBlockedReason("profile-generation")).toContain("career profile is generated");
    expect(homeActionsBlockedReason("review-run")).toContain("running review stops");
    expect(homeActionsBlockedReason("other")).toContain("current workspace operation finishes");
  });
});
