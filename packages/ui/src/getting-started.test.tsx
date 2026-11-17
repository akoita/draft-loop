import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationSummaryView } from "./application-contract.js";
import type { CareerEvidenceStatus } from "./career-evidence.js";
import {
  type DisplayMode,
  type DisplayPreference,
  DisplayPreferenceProvider,
} from "./display-preference.js";
import { GettingStarted } from "./getting-started.js";
import {
  type GettingStartedInputs,
  gettingStartedSteps,
  gettingStartedView,
} from "./getting-started-model.js";

function application(overrides: Partial<ApplicationSummaryView> = {}): ApplicationSummaryView {
  return {
    id: "app-1",
    name: "Acme",
    jobSourceKind: "pasted-text",
    status: "collecting",
    isDefault: false,
    createdAt: "2026-10-08T10:00:00.000Z",
    updatedAt: "2026-10-08T10:00:00.000Z",
    runCount: 0,
    briefCount: 0,
    exportCount: 0,
    latestRunId: null,
    archivedAt: null,
    modelProfiles: null,
    nameChosen: true,
    suggestedName: null,
    ...overrides,
  };
}

const documents = (sourceCount: number): CareerEvidenceStatus => ({
  kind: "selected",
  storeId: "store-1",
  knowledgeBaseId: "kb-1",
  displayName: "Documents",
  sourceCount,
  blockedCount: 0,
  semanticLine: null,
});

const empty: GettingStartedInputs = {
  evidence: documents(0),
  legacyEvidenceSourceCount: 0,
  profile: { kind: "none" },
  applications: { status: "ready", applications: [] },
};

const guided: DisplayPreference = { mode: "guided", guideHidden: false };

function done(inputs: GettingStartedInputs): Record<string, boolean> {
  return Object.fromEntries(gettingStartedSteps(inputs).map((step) => [step.key, step.done]));
}

describe("the Getting started steps", () => {
  it("tick themselves from what the record holds", () => {
    expect(done(empty)).toEqual({
      career: false,
      profile: false,
      job: false,
      review: false,
      download: false,
    });
    expect(done({ ...empty, evidence: documents(2) }).career).toBe(true);
    expect(done({ ...empty, legacyEvidenceSourceCount: 1 }).career).toBe(true);
    expect(done({ ...empty, profile: { kind: "draft", version: 1 } }).profile).toBe(false);
    expect(done({ ...empty, profile: { kind: "reviewed", version: 1 } }).profile).toBe(true);
    const withApps = (applications: ApplicationSummaryView[]) =>
      done({ ...empty, applications: { status: "ready", applications } });
    expect(withApps([application()]).job).toBe(true);
    expect(withApps([application({ archivedAt: "2026-10-09T00:00:00.000Z" })]).job).toBe(false);
    expect(withApps([application({ jobMissing: true })]).job).toBe(false);
    expect(withApps([application({ status: "approved" })])).toMatchObject({
      review: true,
      download: false,
    });
    expect(withApps([application({ status: "approved", exportCount: 1 })]).download).toBe(true);
  });

  it("skip the profile step on a host without a profile workflow", () => {
    const keys = gettingStartedSteps({ ...empty, profile: { kind: "unsupported" } }).map(
      (step) => step.key,
    );
    expect(keys).toEqual(["career", "job", "review", "download"]);
  });

  it("open the newest application that has a run for the review step", () => {
    const older = application({ id: "old", runCount: 1, updatedAt: "2026-10-01T00:00:00.000Z" });
    const newer = application({ id: "new", runCount: 1, updatedAt: "2026-10-05T00:00:00.000Z" });
    const unrun = application({ id: "unrun", updatedAt: "2026-10-09T00:00:00.000Z" });
    const steps = gettingStartedSteps({
      ...empty,
      applications: { status: "ready", applications: [older, unrun, newer] },
    });
    expect(steps.find((step) => step.key === "review")?.application?.id).toBe("new");
  });
});

describe("who sees the guide", () => {
  it("shows Guided people the list from the first step not done", () => {
    const view = gettingStartedView(guided, { ...empty, evidence: documents(1) });
    expect(view).toMatchObject({ kind: "guide", folded: false, position: 2 });
  });

  it("folds it once hidden, offers it on the simple view, and hides it for the rest", () => {
    expect(gettingStartedView({ mode: "guided", guideHidden: true }, empty)).toMatchObject({
      kind: "guide",
      folded: true,
    });
    expect(gettingStartedView({ mode: "standard", guideHidden: false }, empty).kind).toBe("offer");
    expect(gettingStartedView({ mode: "standard", guideHidden: true }, empty).kind).toBe("hidden");
    expect(gettingStartedView({ mode: "everything", guideHidden: false }, empty).kind).toBe(
      "hidden",
    );
    expect(gettingStartedView({ mode: null, guideHidden: false }, empty).kind).toBe("hidden");
  });

  it("waits while the record loads and says every step is done after the first download", () => {
    expect(gettingStartedView(guided, { ...empty, applications: { status: "loading" } }).kind).toBe(
      "hidden",
    );
    const finished: GettingStartedInputs = {
      evidence: documents(1),
      legacyEvidenceSourceCount: 0,
      profile: { kind: "reviewed", version: 1 },
      applications: {
        status: "ready",
        applications: [application({ status: "exported", exportCount: 1 })],
      },
    };
    expect(gettingStartedView(guided, finished).kind).toBe("complete");
    expect(gettingStartedView({ mode: "guided", guideHidden: true }, finished).kind).toBe("hidden");
    expect(gettingStartedView({ mode: "standard", guideHidden: false }, finished).kind).toBe(
      "hidden",
    );
    const html = renderToStaticMarkup(
      <DisplayPreferenceProvider value={{ preference: guided, choose: () => undefined }}>
        <GettingStarted inputs={finished} actions={noActions} />
      </DisplayPreferenceProvider>,
    );
    expect(html).toContain("You have done every step");
    expect(html).toContain("New application");
    expect(html).toContain("Hide the guide");
  });
});

const noActions = {
  onManageEvidence: () => undefined,
  onManageProfile: () => undefined,
  onNewApplication: () => undefined,
  onOpenApplication: () => undefined,
};

function render(mode: DisplayMode | null, guideHidden = false, inputs = empty) {
  return renderToStaticMarkup(
    <DisplayPreferenceProvider value={{ preference: { mode, guideHidden }, choose: () => {} }}>
      <GettingStarted inputs={inputs} actions={noActions} />
    </DisplayPreferenceProvider>,
  );
}

describe("the guide on Home", () => {
  it("lists the steps with one button on the current step", () => {
    const html = render("guided", false, { ...empty, evidence: documents(1) });
    expect(html).toContain('<h2 id="getting-started-title">Getting started</h2>');
    expect(html).toContain('<span class="meta-chip">Step 2 of 5</span>');
    expect(html).toContain("Tell us about your career");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(">Open Career profile</button>");
    expect(html).not.toContain(">Go to Career evidence</button>");
    expect(html).toContain(">Hide the guide</button>");
    expect(html.match(/button-primary/g)).toHaveLength(1);
  });

  it("folds to one line once hidden", () => {
    const html = render("guided", true);
    expect(html).toContain("Step 1 of 5");
    expect(html).toContain("Tell us about your career");
    expect(html).toContain(">Show the guide</button>");
    expect(html).not.toContain("<ol");
  });

  it("offers itself once on the simple view and stays out of Show everything", () => {
    const offer = render("standard");
    expect(offer).toContain(">Show me the steps</button>");
    expect(offer).toContain(">No thanks</button>");
    expect(render("everything")).toBe("");
  });

  it("is absent when the host keeps no preference", () => {
    expect(renderToStaticMarkup(<GettingStarted inputs={empty} actions={noActions} />)).toBe("");
  });
});
