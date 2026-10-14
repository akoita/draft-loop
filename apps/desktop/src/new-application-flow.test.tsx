import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationSummaryView } from "./application-contract.js";
import type { OpportunityLatestBrief } from "./bridge.js";
import {
  createFixtureReviewState,
  type DesktopReviewState,
  type ProviderTransmissionPreflight,
} from "./model.js";
import {
  JobStep,
  NewApplicationFlow,
  type NewApplicationFlowProps,
  newApplicationStartHandlers,
  newApplicationStartSummary,
  ProfileStep,
  RequirementsStep,
  StartStep,
} from "./new-application-flow.js";
import { emptyNewApplicationDraft } from "./new-application-flow-model.js";
import { StartConfirmation } from "./start-confirmation.js";

/** A live workspace on both session routes whose reviewed brief is brief-1 v2. */
function liveState(overrides: Partial<DesktopReviewState> = {}): DesktopReviewState {
  const fixture = createFixtureReviewState();
  return {
    ...fixture,
    providerRoutes: {
      anthropic: "user-session",
      openai: "user-session",
      sessionCallLimitMs: 600_000,
    },
    ...overrides,
    setup: {
      ...fixture.setup,
      reviewedOpportunity: { briefId: "brief-1", version: 2 },
      fixtureMode: false,
    },
  };
}

const application: ApplicationSummaryView = {
  id: "app-1",
  name: "Acme — Platform Engineer",
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
  nameChosen: true,
  suggestedName: null,
};

const brief = (status: "draft" | "reviewed"): OpportunityLatestBrief => ({
  workspaceId: "workspace-1",
  briefId: "brief-1",
  version: 2,
  status,
  requirementCount: 4,
  criticalCount: 1,
});

const none = () => undefined;

describe("job step", () => {
  const props = {
    draft: emptyNewApplicationDraft,
    busy: false,
    errorMessage: null,
    application: null,
    onDraftChange: none,
    onSubmit: none,
    onContinue: none,
  };

  it("asks for a name and pasted text, and says what is missing", () => {
    const html = renderToStaticMarkup(<JobStep {...props} />);
    expect(html).toContain("Name and job");
    expect(html).toContain("Paste the job description");
    expect(html).toContain("Name the application");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
    const ready = renderToStaticMarkup(
      <JobStep {...props} draft={{ ...emptyNewApplicationDraft, name: "Acme", jobText: "Role" }} />,
    );
    expect(ready).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
  });

  it("offers a job page address that needs the person's approval", () => {
    const draft = { ...emptyNewApplicationDraft, name: "Acme", jobKind: "url" as const };
    const html = renderToStaticMarkup(<JobStep {...props} draft={draft} />);
    expect(html).toContain("Job page address");
    expect(html).toContain("I approve DraftLoop fetching this page");
    expect(html).toContain("never before");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
    const approved = renderToStaticMarkup(
      <JobStep
        {...props}
        draft={{ ...draft, jobUrl: "https://jobs.example.test/1", urlApproved: true }}
      />,
    );
    expect(approved).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
  });

  it("shows a creation failure and a busy state", () => {
    const html = renderToStaticMarkup(
      <JobStep
        {...props}
        draft={{ ...emptyNewApplicationDraft, name: "Acme", jobText: "Role" }}
        errorMessage="The pasted job description is empty."
        busy
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Creating…");
  });

  it("summarizes the created application instead of asking again", () => {
    const html = renderToStaticMarkup(<JobStep {...props} application={application} />);
    expect(html).toContain("Acme — Platform Engineer");
    expect(html).toContain("pasted job text");
    expect(html).toContain(">Continue<");
    expect(html).not.toContain("<textarea");
  });
});

describe("requirements step", () => {
  const render = (latest: OpportunityLatestBrief | null | undefined) =>
    renderToStaticMarkup(
      <RequirementsStep latest={latest} onBack={none} onContinue={none}>
        <p>extraction card</p>
      </RequirementsStep>,
    );

  it("holds Continue until the brief is reviewed", () => {
    for (const latest of [undefined, null, brief("draft")]) {
      expect(render(latest)).toMatch(/<button[^>]*disabled=""[^>]*>Continue/u);
    }
    expect(render(brief("reviewed"))).not.toMatch(/<button[^>]*disabled=""[^>]*>Continue/u);
  });

  it("states where the brief stands and shows the extraction card", () => {
    expect(render(brief("draft"))).toContain("Version 2 is a draft (4 requirements)");
    expect(render(brief("reviewed"))).toContain("Version 2 is reviewed");
    expect(render(null)).toContain("extraction card");
  });

  it("explains a draft with no requirements and still holds Continue", () => {
    const html = render({ ...brief("draft"), requirementCount: 0, criticalCount: 0 });
    expect(html).toContain("Version 2 is a draft with no requirements");
    expect(html).toContain("paste the job text");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue/u);
  });
});

describe("career profile step", () => {
  const choices = [
    { profileId: "candidate", version: 3, reviewedAt: "2026-10-05T00:00:00.000Z" },
    { profileId: "candidate", version: 1, reviewedAt: "2026-10-01T00:00:00.000Z" },
  ];
  const props = {
    selected: { profileId: "candidate", version: 3 },
    onSelect: none,
    onManageProfile: none,
    onBack: none,
    onContinue: none,
  };

  it("shows the latest reviewed profile selected, with the other versions to pick", () => {
    const html = renderToStaticMarkup(
      <ProfileStep {...props} reviewed={{ status: "ready", choices }} />,
    );
    expect(html).toContain("candidate · version 3 · reviewed 2026-10-05");
    expect(html).toContain("candidate · version 1 · reviewed 2026-10-01");
    expect(html).toContain("Latest");
    expect(html.match(/type="radio"/gu)).toHaveLength(2);
    expect(html.match(/checked=""/gu)).toHaveLength(1);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Continue/u);
  });

  it("explains a missing reviewed profile and links to Manage profile", () => {
    const html = renderToStaticMarkup(
      <ProfileStep {...props} selected={null} reviewed={{ status: "ready", choices: [] }} />,
    );
    expect(html).toContain("No reviewed career profile yet");
    expect(html).toContain(">Manage profile<");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue/u);
  });

  it("words loading, failure and an unsupported host", () => {
    const render = (reviewed: Parameters<typeof ProfileStep>[0]["reviewed"]) =>
      renderToStaticMarkup(<ProfileStep {...props} selected={null} reviewed={reviewed} />);
    expect(render({ status: "loading" })).toContain("Reading your reviewed career profiles");
    expect(render({ status: "failed" })).toContain('role="alert"');
    expect(render({ status: "unsupported" })).toContain("cannot manage a career profile");
  });
});

describe("start step", () => {
  const preflight: ProviderTransmissionPreflight = {
    required: true,
    acknowledged: false,
    acknowledgedAt: null,
    fingerprint: "f".repeat(64),
    author: { company: "anthropic", model: "claude", endpoint: "https://a.example.test" },
    critic: { company: "openai", model: "gpt", endpoint: "https://o.example.test" },
  } as never;
  const props = {
    application,
    latest: brief("reviewed"),
    profile: { profileId: "candidate", version: 3 },
    modelPair: <p>model pair</p>,
    preflight,
    transmissionConfirmed: false,
    starting: false,
    errorMessage: null,
    startDisabledReason: null,
    onTransmissionConfirmedChange: none,
    onBack: none,
    onStart: none,
  };

  it("pins the run to the application, brief and profile versions", () => {
    const html = renderToStaticMarkup(<StartStep {...props} />);
    expect(html).toContain("Acme — Platform Engineer");
    expect(html).toContain("Brief brief-1, version 2 (reviewed)");
    expect(html).toContain("candidate, version 3");
    expect(html).toContain("model pair");
  });

  it("asks for the data transmission confirmation before it can start", () => {
    const html = renderToStaticMarkup(<StartStep {...props} />);
    expect(html).toContain("anthropic and openai");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start review/u);
    expect(html).toContain("Confirm the provider data transmission");
    const confirmed = renderToStaticMarkup(<StartStep {...props} transmissionConfirmed />);
    expect(confirmed).not.toMatch(/<button[^>]*disabled=""[^>]*>Start review/u);
  });

  it("does not ask again once the transmission was acknowledged", () => {
    const html = renderToStaticMarkup(
      <StartStep {...props} preflight={{ ...preflight, acknowledged: true }} />,
    );
    expect(html).not.toContain("I reviewed that this review sends");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Start review/u);
  });

  it("shows the pair's provider readiness and holds Start until it is configured", () => {
    const readiness = (
      <section aria-label="Provider authentication">
        Configure OpenAI API key for live review
      </section>
    );
    const missing = renderToStaticMarkup(
      <StartStep
        {...props}
        transmissionConfirmed
        providerAuthentication={readiness}
        providerReadiness={{ ready: false, summary: "Configure OpenAI API key for live review" }}
      />,
    );
    expect(missing).toContain('aria-label="Provider authentication"');
    expect(missing).toMatch(/<button[^>]*disabled=""[^>]*>Start review/u);
    expect(missing).toContain(
      '<p class="subtle" id="flow-start-blocker">Configure OpenAI API key for live review.</p>',
    );

    const configured = renderToStaticMarkup(
      <StartStep
        {...props}
        transmissionConfirmed
        providerAuthentication={readiness}
        providerReadiness={{
          ready: true,
          summary: "Anthropic API key & OpenAI API key configured",
        }}
      />,
    );
    expect(configured).not.toMatch(/<button[^>]*disabled=""[^>]*>Start review/u);

    // Still reading the statuses: Start is not held on an unknown.
    const loading = renderToStaticMarkup(
      <StartStep
        {...props}
        transmissionConfirmed
        providerAuthentication={readiness}
        providerReadiness={null}
      />,
    );
    expect(loading).not.toMatch(/<button[^>]*disabled=""[^>]*>Start review/u);
  });

  it("shows the pair choice between the model pair and its readiness", () => {
    const html = renderToStaticMarkup(
      <StartStep
        {...props}
        modelPair={<p>Pair summary</p>}
        modelPairChoice={<p>Pair choice</p>}
        providerAuthentication={<p>Pair readiness</p>}
      />,
    );
    expect(html.indexOf("Pair summary")).toBeLessThan(html.indexOf("Pair choice"));
    expect(html.indexOf("Pair choice")).toBeLessThan(html.indexOf("Pair readiness"));
  });

  it("shows an outside blocker, a failure and the starting state", () => {
    const blocked = renderToStaticMarkup(
      <StartStep
        {...props}
        transmissionConfirmed
        startDisabledReason="Selected models are unsupported."
      />,
    );
    expect(blocked).toContain("Selected models are unsupported.");
    expect(blocked).toMatch(/<button[^>]*disabled=""[^>]*>Start review/u);
    const failed = renderToStaticMarkup(
      <StartStep {...props} transmissionConfirmed errorMessage="Could not start." starting />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Starting…");
  });

  it("keeps the start confirmation closed until Start asks for it", () => {
    const html = renderToStaticMarkup(<StartStep {...props} transmissionConfirmed />);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("Start this review?");
  });

  it("shows the start confirmation with the application's own pair once opened", () => {
    // The host reports the loaded application's own pair; the workspace's pair is not shown.
    const state = liveState({
      providerTransmissionPreflight: {
        ...createFixtureReviewState().providerTransmissionPreflight,
        author: { company: "anthropic", model: "claude-opus-4-1", endpoint: "" },
        critic: { company: "openai", model: "gpt-5-pro", endpoint: "" },
      },
    });
    const summary = newApplicationStartSummary(state, {
      latest: brief("reviewed"),
      candidateProfile: { profileId: "candidate", version: 3 },
      modelProfiles: {
        author: { id: "premium-anthropic-author" },
        critic: { id: "premium-openai-critic" },
      },
    });
    const html = renderToStaticMarkup(
      <StartStep
        {...props}
        transmissionConfirmed
        confirmation={
          <StartConfirmation
            summary={summary}
            dialogRef={createRef<HTMLDivElement>()}
            onStart={none}
            onCancel={none}
          />
        }
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Start this review?");
    expect(html).toContain("Anthropic · claude-opus-4-1 · Premium · Claude session");
    expect(html).toContain("OpenAI · gpt-5-pro · Premium · ChatGPT session");
    expect(html).not.toContain("claude-sonnet-4-5");
    expect(html).toContain("<dt>Requirements</dt><dd>Reviewed brief v2 · 4 requirements</dd>");
    expect(html).toContain("<dt>Career profile</dt><dd>v3</dd>");
  });
});

describe("new application start confirmation", () => {
  it("names the reviewed brief only when it is the state's reviewed selection", () => {
    const requirements = (latest: OpportunityLatestBrief) =>
      newApplicationStartSummary(liveState(), {
        latest,
        candidateProfile: null,
        modelProfiles: null,
      }).inputs.find((line) => line.label === "Requirements")?.value;
    expect(requirements(brief("reviewed"))).toBe("Reviewed brief v2 · 4 requirements");
    expect(requirements({ ...brief("reviewed"), briefId: "brief-other" })).toBe(
      "Reviewed brief v2",
    );
  });

  it("says no career profile is pinned when none is selected", () => {
    const summary = newApplicationStartSummary(liveState(), {
      latest: brief("reviewed"),
      candidateProfile: null,
      modelProfiles: null,
    });
    expect(summary.inputs).toContainEqual({ label: "Career profile", value: "None pinned" });
    expect(summary.models.map((model) => model.tier)).toEqual([null, null]);
  });

  it("Start closes the check and starts the run once", () => {
    const start = vi.fn();
    const close = vi.fn();
    newApplicationStartHandlers(start, close).onStart();
    expect(close).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it("Cancel closes the check and starts nothing", () => {
    const start = vi.fn();
    const close = vi.fn();
    newApplicationStartHandlers(start, close).onCancel();
    expect(close).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });
});

describe("New application screen", () => {
  const props: NewApplicationFlowProps = {
    workspaceId: "workspace-1",
    workspaceTitle: <h1 key="t">Workspace</h1>,
    workspaceNavigation: null,
    errorMessage: null,
    createApplication: async () => application,
    onCreated: none,
    requirements: {
      workspaceId: "workspace-1",
      writingModel: { company: "anthropic", model: "claude" },
      disabled: false,
    },
    profileCapabilities: {},
    selectedProfile: null,
    onSelectProfile: none,
    onManageProfile: none,
    modelPair: null,
    preflight: {
      required: false,
      acknowledged: true,
      acknowledgedAt: null,
      fingerprint: "f".repeat(64),
    } as never,
    startDisabledReason: null,
    startSummary: (latest) =>
      newApplicationStartSummary(liveState(), {
        latest,
        candidateProfile: null,
        modelProfiles: null,
      }),
    onStart: async () => undefined,
    back: { label: "Home", onBack: none },
    onOpenStep: { evidence: none, profile: none, applications: none },
  };

  it("opens on step 1 with the four steps and a way back to Home", () => {
    const html = renderToStaticMarkup(<NewApplicationFlow {...props} />);
    expect(html).toContain("Step 1 of 4");
    for (const label of ["Job", "Requirements", "Career profile", "Start review"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-label="Back to Home"');
    expect(html).toContain('<span class="home-back-label">Home</span></button>');
    expect(html).toMatch(/<h1[^>]*>New application<\/h1>/u);
    expect(html).toContain("Name and job");
  });

  it("links straight to the career pages from the flow strip", () => {
    const html = renderToStaticMarkup(<NewApplicationFlow {...props} />);
    expect(html).toContain('aria-label="Career flow"');
    expect(html).toContain('class="career-flow-link" type="button">Career evidence</button>');
    expect(html).toContain('class="career-flow-link" type="button">Career profile</button>');
    expect(html).toMatch(/aria-current="step">(<span[^>]*>→<\/span>)?Applications<\/li>/u);
  });
});
