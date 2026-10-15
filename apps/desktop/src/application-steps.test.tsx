import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApplicationStepsView, focusCurrentStep } from "./application-steps.js";
import {
  type ApplicationStepState,
  applicationStepStates,
  applicationStepStatusText,
} from "./application-steps-model.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  candidateProfilePendingBlockerMessage,
  candidateProfileStartBlockerMessage,
  jobDescriptionSteps,
  type StartChecklistInput,
  startChecklist,
} from "./start-checklist-model.js";

const allDone: StartChecklistInput = {
  setup: {
    ready: true,
    nextSteps: [],
    jobDescriptionReady: true,
    jobRequirementProblem: null,
    fixtureMode: false,
    reviewedOpportunity: { briefId: "target-role", version: 3 },
  },
  startFromJobDescription: false,
  requirementAction: null,
  candidateProfile: { version: 2 },
  transmission: { required: true, acknowledged: false },
  startDisabledReason: null,
  canOpenProviderSignIn: true,
};

const noJob: StartChecklistInput = {
  ...allDone,
  setup: {
    ...allDone.setup,
    ready: false,
    nextSteps: [jobDescriptionSteps[0] ?? ""],
    jobDescriptionReady: false,
    reviewedOpportunity: null,
  },
};

const noProfile: StartChecklistInput = {
  ...allDone,
  candidateProfile: null,
  startDisabledReason: candidateProfileStartBlockerMessage,
};

function states(input: StartChecklistInput) {
  return applicationStepStates(startChecklist(input)).map((step) =>
    applicationStepStatusText(step.status),
  );
}

describe("application step states", () => {
  it("makes the job step current while the job description is missing", () => {
    expect(states(noJob)).toEqual(["Current step", "Done", "Blocked: finish step 1 first."]);
  });

  it("makes the profile step current once the job is done", () => {
    expect(states(noProfile)).toEqual(["Done", "Current step", "Blocked: finish step 2 first."]);
  });

  it("blocks a later open step with what it waits on", () => {
    expect(
      states({
        ...noJob,
        candidateProfile: null,
        startDisabledReason: candidateProfileStartBlockerMessage,
      }),
    ).toEqual([
      "Current step",
      `Blocked: ${candidateProfileStartBlockerMessage}`,
      "Blocked: finish steps 1 and 2 first.",
    ]);
  });

  it("makes the review step current once the job and the profile are done", () => {
    // The transmission acknowledgement is still open: it belongs to the review step.
    expect(states(allDone)).toEqual(["Done", "Done", "Current step"]);
  });

  it("counts requirements read from the job description as done", () => {
    expect(states({ ...allDone, setup: { ...allDone.setup, reviewedOpportunity: null } })).toEqual([
      "Done",
      "Done",
      "Current step",
    ]);
    expect(states({ ...allDone, startFromJobDescription: true })).toEqual([
      "Done",
      "Done",
      "Current step",
    ]);
  });

  it("keeps the job step open while a requirements refusal or a job host step is open", () => {
    const problem = "Requirement 1 in the job description is too long to match against CV lines.";
    expect(
      states({
        ...allDone,
        setup: {
          ...allDone.setup,
          ready: false,
          nextSteps: [problem],
          jobRequirementProblem: problem,
          reviewedOpportunity: null,
        },
        requirementAction: "extract",
      })[0],
    ).toBe("Current step");
    expect(
      states({
        ...allDone,
        setup: {
          ...allDone.setup,
          ready: false,
          nextSteps: [jobDescriptionSteps[1] ?? ""],
          reviewedOpportunity: null,
        },
      })[0],
    ).toBe("Current step");
  });

  it("keeps the profile step open while a profile operation is pending", () => {
    expect(
      states({ ...allDone, startDisabledReason: candidateProfilePendingBlockerMessage })[1],
    ).toBe("Current step");
  });

  it("treats a host that pins no profile as done with the profile step", () => {
    expect(states({ ...allDone, candidateProfile: undefined })).toEqual([
      "Done",
      "Done",
      "Current step",
    ]);
  });
});

describe("application steps view", () => {
  const steps: readonly ApplicationStepState[] = applicationStepStates(startChecklist(noProfile));
  const html = renderToStaticMarkup(
    <ApplicationStepsView
      steps={steps}
      content={{ job: <p>JOB</p>, profile: <p>PROFILE</p>, review: <p>REVIEW</p> }}
    />,
  );

  it("lists the three numbered steps in order", () => {
    expect(html.startsWith('<ol class="application-steps">')).toBe(true);
    const job = html.indexOf("Job &amp; requirements");
    const profile = html.indexOf("</span> Profile</h3>");
    const review = html.indexOf("</span> Review</h3>");
    expect(job).toBeGreaterThan(-1);
    expect(job).toBeLessThan(profile);
    expect(profile).toBeLessThan(review);
    expect(html).toContain('<span class="application-step-number">1</span> Job &amp; requirements');
    expect(html.indexOf("JOB")).toBeLessThan(html.indexOf("PROFILE"));
    expect(html.indexOf("PROFILE")).toBeLessThan(html.indexOf("REVIEW"));
  });

  it("spells out each state and marks only the current step", () => {
    expect(html.match(/aria-current="step"/gu)?.length).toBe(1);
    expect(html).toMatch(/id="application-step-profile"[^>]*aria-current="step"/u);
    expect(html).toContain('<p class="application-step-status">Done</p>');
    expect(html).toContain('<p class="application-step-status">Current step</p>');
    expect(html).toContain('<p class="application-step-status">Blocked: finish step 2 first.</p>');
  });

  it("makes only the current step's heading focusable by script", () => {
    expect(html.match(/tabindex="-1"/gu)?.length).toBe(1);
    expect(html).toMatch(
      /aria-current="step"><div class="application-step-head"><h3 [^>]*tabindex="-1"/u,
    );
  });
});

describe("opening at the current step", () => {
  it("scrolls the current step into view and focuses its heading", () => {
    const heading = { focus: vi.fn() };
    const step = { scrollIntoView: vi.fn(), querySelector: vi.fn(() => heading) };
    const querySelector = vi.fn(() => step);
    expect(focusCurrentStep({ querySelector } as never)).toBe(true);
    expect(querySelector).toHaveBeenCalledWith('[aria-current="step"]');
    expect(step.querySelector).toHaveBeenCalledWith("h3");
    expect(step.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does nothing when no step is current or the steps are not mounted", () => {
    expect(focusCurrentStep({ querySelector: () => null } as never)).toBe(false);
    expect(focusCurrentStep(null)).toBe(false);
  });
});

describe("ReviewWorkspace as three steps", () => {
  const fixture = createFixtureReviewState();
  const collecting = (setup: Record<string, unknown> = {}) => ({
    ...fixture,
    state: "collecting" as const,
    runId: "pending",
    setup: {
      ...fixture.setup,
      fixtureMode: false,
      jobDescriptionReady: true,
      ready: true,
      nextSteps: [],
      reviewedOpportunity: { briefId: "target-role", version: 3 },
      ...setup,
    },
    providerTransmissionPreflight: {
      ...fixture.providerTransmissionPreflight,
      required: true,
      acknowledged: false,
      acknowledgedAt: null,
    },
  });
  const render = (
    state = collecting(),
    startCandidateProfile: { version: number } | null = {
      version: 2,
    },
  ) =>
    renderToStaticMarkup(
      <ReviewWorkspace
        state={state}
        onAction={() => undefined}
        onSelectFiles={() => undefined}
        onAddUrl={() => undefined}
        startCandidateProfile={startCandidateProfile}
        startDisabledReason={
          startCandidateProfile === null ? candidateProfileStartBlockerMessage : null
        }
        onOpenHome={() => undefined}
        setupSummary={<div id="summary">SETUP SUMMARY</div>}
      />,
    );
  const stepHtml = (html: string, id: string) => {
    const start = html.indexOf(`<li id="application-step-${id}"`);
    return html.slice(start, html.indexOf("</li>", start));
  };

  it("puts the job, the profile and the review in their steps", () => {
    const html = render();
    const job = stepHtml(html, "job");
    const profile = stepHtml(html, "profile");
    const review = html.slice(html.indexOf('<li id="application-step-review"'));
    expect(job).toContain('id="start-job-card"');
    expect(job).toContain("<summary>Replace the job description</summary>");
    expect(profile).toContain("SETUP SUMMARY");
    expect(review).toContain('aria-labelledby="provider-preflight-title"');
    expect(review).toContain("Advanced: writing policy override for this job");
    expect(review).toContain('id="start-checklist"');
    expect(review.indexOf("provider-preflight-title")).toBeLessThan(
      review.indexOf("Advanced: writing policy override"),
    );
    expect(review.indexOf("Advanced: writing policy override")).toBeLessThan(
      review.indexOf('id="start-checklist"'),
    );
    // No setup-card numbering and no workspace-level controls.
    expect(html).not.toContain("setup-number");
    expect(html).not.toContain("Replace policy");
  });

  it("shows the application's pair choice first in the Review step, held while a start is pending", () => {
    const choice = vi.fn((disabled: boolean) => <p>PAIR CHOICE {String(disabled)}</p>);
    const props = {
      onAction: () => undefined,
      startCandidateProfile: { version: 2 },
      startDisabledReason: null,
      onOpenHome: () => undefined,
      setupSummary: <div>SETUP SUMMARY</div>,
      modelPairChoice: choice,
    };
    const html = renderToStaticMarkup(<ReviewWorkspace state={collecting()} {...props} />);
    const review = html.slice(html.indexOf('<li id="application-step-review"'));
    expect(review).toContain("PAIR CHOICE false");
    expect(review.indexOf("PAIR CHOICE")).toBeLessThan(review.indexOf("provider-preflight-title"));
    const pending = renderToStaticMarkup(
      <ReviewWorkspace
        state={collecting()}
        {...props}
        pendingReviewAction={{ action: "start", elapsedSeconds: 1 }}
      />,
    );
    expect(pending).toContain("PAIR CHOICE true");
  });

  it("keeps one primary action in each step", () => {
    const html = render();
    for (const id of ["job", "profile", "review"]) {
      expect(stepHtml(html, id).match(/button-primary/gu)?.length ?? 0).toBeLessThanOrEqual(1);
    }
    const review = html.slice(html.indexOf('<li id="application-step-review"'));
    expect(review.match(/button-primary/gu)?.length).toBe(1);
    expect(review).toMatch(/class="button button-outline"[^>]*>Acknowledge provider transmission/u);
  });

  it("shows each step's state from the start conditions", () => {
    expect(render(collecting({ jobDescriptionReady: false, reviewedOpportunity: null }))).toMatch(
      /id="application-step-job"[^>]*aria-current="step"/u,
    );
    expect(render(collecting(), null)).toMatch(
      /id="application-step-profile"[^>]*aria-current="step"/u,
    );
    expect(render()).toMatch(/id="application-step-review"[^>]*aria-current="step"/u);
  });
});
