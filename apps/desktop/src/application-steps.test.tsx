import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApplicationStepsView, focusCurrentStep } from "./application-steps.js";
import {
  type ApplicationStepState,
  applicationJobStepNote,
  applicationStepStates,
  applicationStepStatusText,
  jobStepOffersExtraction,
} from "./application-steps-model.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  approvedPageRequirementsDetail,
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

describe("job step source", () => {
  it("names an approved job page without showing its address", () => {
    const note = applicationJobStepNote("approved-page", false);
    expect(note).toBe(
      "Job page approved when you created this application. DraftLoop fetches it when you extract requirements, then you review them.",
    );
    expect(note).not.toMatch(/https?:/u);
    expect(applicationJobStepNote("approved-page", true)).toBe(
      "Job page approved when you created this application.",
    );
  });

  it("keeps today's notes for a document job", () => {
    expect(applicationJobStepNote("document", false)).toBe(
      "Add the job description from a file or a public URL, then extract and review its requirements.",
    );
    expect(applicationJobStepNote("document", true)).toBe("Job description added.");
  });

  it("offers extraction for an approved page before any job text exists", () => {
    expect(jobStepOffersExtraction("approved-page", false)).toBe(true);
    expect(jobStepOffersExtraction("document", false)).toBe(false);
    expect(jobStepOffersExtraction("document", true)).toBe(true);
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

  describe("for an application created from an approved job page", () => {
    const binding = (jobFromUrl: boolean) => ({
      workspaceId: "workspace-1",
      createOpportunity: vi.fn(),
      writingModel: { company: "anthropic", model: "claude-opus" },
      disabled: false,
      ...(jobFromUrl ? { jobFromUrl: true } : {}),
    });
    const renderScreen = (jobFromUrl: boolean) =>
      renderToStaticMarkup(
        <ReviewWorkspace
          state={collecting({
            jobDescriptionReady: false,
            ready: false,
            reviewedOpportunity: null,
            nextSteps: [jobDescriptionSteps[jobFromUrl ? 1 : 0] ?? ""],
          })}
          onAction={() => undefined}
          onSelectFiles={() => undefined}
          onAddUrl={() => undefined}
          startCandidateProfile={{ version: 2 }}
          startDisabledReason={null}
          onOpenHome={() => undefined}
          setupSummary={<div>SETUP SUMMARY</div>}
          jobRequirements={binding(jobFromUrl)}
        />,
      );
    const renderJob = (jobFromUrl: boolean) => stepHtml(renderScreen(jobFromUrl), "job");
    const checklistHtml = (html: string) => html.slice(html.indexOf('id="start-checklist"'));

    it("offers Extract requirements in the start checklist and names the review on Start", () => {
      const html = renderScreen(true);
      const checklist = checklistHtml(html);
      expect(checklist).toContain(approvedPageRequirementsDetail);
      expect(checklist).toMatch(/<button[^>]*>Extract requirements<\/button>/u);
      expect(checklist).not.toContain("Add job description");
      expect(checklist).not.toContain(jobDescriptionSteps[1]);
      expect(html).toContain("Start review · review the requirements first");
      expect(html).not.toContain("add the job description first");
    });

    it("keeps a document application's checklist asking for the job description", () => {
      const html = renderScreen(false);
      expect(checklistHtml(html)).toMatch(/<button[^>]*>Add job description<\/button>/u);
      expect(html).toContain("Start review · add the job description first");
    });

    it("names the approved page as the source and offers extraction as the one primary action", () => {
      const job = renderJob(true);
      expect(job).toContain('aria-current="step"');
      expect(job).toContain(
        "Job page approved when you created this application. DraftLoop fetches it when you extract requirements, then you review them.",
      );
      expect(job).not.toContain("Add the job description from a file or a public URL");
      // No address is shown or invented: the URL never crosses the bridge.
      expect(job.replace(/placeholder="[^"]*"/gu, "")).not.toMatch(/https?:/u);
      expect(job.match(/button-primary/gu)?.length).toBe(1);
      expect(job).toMatch(/class="button button-primary"[^>]*>Extract requirements</u);
    });

    it("keeps replacing the source under the disclosure", () => {
      const job = renderJob(true);
      const disclosure = job.slice(job.indexOf("<summary>Replace the job description</summary>"));
      expect(disclosure).toContain("Replace job description");
      expect(disclosure).toContain('aria-label="Target job description URL"');
      expect(job.indexOf("<summary>Replace the job description</summary>")).toBeLessThan(
        job.indexOf("Extract requirements"),
      );
    });

    it("leaves a pasted-text or file application's step 1 as it was", () => {
      const job = renderJob(false);
      expect(job).toContain(
        "Add the job description from a file or a public URL, then extract and review its requirements.",
      );
      expect(job).not.toContain("<summary>Replace the job description</summary>");
      expect(job).toContain('class="application-job-inputs"');
      expect(job).not.toContain("Extract requirements");
      expect(job).not.toContain("button-primary");
    });
  });
});
