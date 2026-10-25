import { createFixtureReviewState } from "@draft-loop/ui/model";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applicationStepStates } from "./application-steps-model.js";
import { urlJobBriefStep } from "./electron/host-applications.js";
import type { ProviderSignInReadiness } from "./provider-sign-in-readiness.js";
import { ReviewWorkspace } from "./review.js";
import { revealStartTarget, StartChecklistView, startActionTargets } from "./start-checklist.js";
import {
  approvedPageRequirementsDetail,
  candidateProfilePendingBlockerMessage,
  candidateProfileStartBlockerMessage,
  draftBriefStartDetail,
  firstUnmetStartCondition,
  jobDescriptionSteps,
  type StartActionId,
  type StartChecklistInput,
  type StartCondition,
  startButtonLabel,
  startChecklist,
  startChecklistTooltip,
} from "./start-checklist-model.js";

const problem = "Requirement 1 in the job description is too long to match against CV lines.";

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
  transmission: { required: true, acknowledged: true },
  startDisabledReason: null,
  canOpenProviderSignIn: true,
};

function condition(conditions: readonly StartCondition[], id: string): StartCondition {
  const found = conditions.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Condition not found: ${id}`);
  return found;
}

describe("start checklist conditions", () => {
  it("lists the four conditions in order, all done, and leaves the button enabled", () => {
    const conditions = startChecklist(allDone);
    expect(conditions.map((item) => item.id)).toEqual([
      "requirements",
      "profile",
      "provider-sign-in",
      "transmission",
    ]);
    expect(conditions.map((item) => item.label)).toEqual([
      "Job requirements reviewed",
      "Reviewed career profile selected",
      "Provider sign-in ready",
      "Data sent to providers acknowledged",
    ]);
    expect(firstUnmetStartCondition(conditions)).toBeNull();
    expect(startButtonLabel(conditions, false)).toBe("Start author–critic review");
    expect(startButtonLabel(conditions, true)).toBe("Starting review…");
    expect(startChecklistTooltip(conditions)).toBeUndefined();
  });

  it("asks to review the requirements when the parser refuses the job and a draft waits", () => {
    const conditions = startChecklist({
      ...allDone,
      setup: {
        ...allDone.setup,
        ready: false,
        nextSteps: [problem],
        jobRequirementProblem: problem,
        reviewedOpportunity: null,
      },
      requirementAction: "review-draft",
    });
    expect(condition(conditions, "requirements")).toEqual({
      id: "requirements",
      label: "Job requirements reviewed",
      done: false,
      detail: problem,
      action: { id: "review-requirements", label: "Review requirements" },
    });
    // The refusal folds into the condition rather than repeating as its own item.
    expect(conditions.filter((item) => item.label === problem)).toEqual([]);
    expect(startButtonLabel(conditions, false)).toBe(
      "Start review · review the requirements first",
    );
  });

  describe("while the application's brief is a draft", () => {
    const withDraft: StartChecklistInput = {
      ...allDone,
      setup: { ...allDone.setup, reviewedOpportunity: null },
      requirementAction: "review-draft",
      draftBrief: true,
    };

    it("blocks the start with Review requirements", () => {
      const conditions = startChecklist(withDraft);
      expect(condition(conditions, "requirements")).toEqual({
        id: "requirements",
        label: "Job requirements reviewed",
        done: false,
        detail: draftBriefStartDetail,
        action: { id: "review-requirements", label: "Review requirements" },
      });
      expect(startButtonLabel(conditions, false)).toBe(
        "Start review · review the requirements first",
      );
      expect(startChecklistTooltip(conditions)).toBe(`Can't start yet: ${draftBriefStartDetail}`);
      expect(applicationStepStates(conditions).map((step) => step.status)).toEqual([
        { kind: "current" },
        { kind: "done" },
        { kind: "blocked", reason: "finish step 1 first." },
      ]);
    });

    it("offers a fresh extraction for an empty draft, still blocked", () => {
      const conditions = startChecklist({ ...withDraft, requirementAction: "extract-again" });
      expect(condition(conditions, "requirements")).toMatchObject({
        done: false,
        detail: draftBriefStartDetail,
        action: { id: "extract-requirements", label: "Extract requirements again" },
      });
    });

    it("starts from the raw job description only when the person chose it", () => {
      const conditions = startChecklist({ ...withDraft, startFromJobDescription: true });
      expect(condition(conditions, "requirements")).toEqual({
        id: "requirements",
        label: "Job requirements read from the job description",
        done: true,
        action: null,
      });
      expect(firstUnmetStartCondition(conditions)).toBeNull();
    });

    it("keeps today's path for an application with job text and no brief", () => {
      const conditions = startChecklist({
        ...allDone,
        setup: { ...allDone.setup, reviewedOpportunity: null },
        requirementAction: "extract",
        draftBrief: false,
      });
      expect(condition(conditions, "requirements")).toMatchObject({
        label: "Job requirements read from the job description",
        done: true,
      });
      expect(firstUnmetStartCondition(conditions)).toBeNull();
    });
  });

  it("keeps the extraction and reviewed-brief fixes for the parser refusal", () => {
    const refused = (requirementAction: StartChecklistInput["requirementAction"]) =>
      condition(
        startChecklist({
          ...allDone,
          setup: { ...allDone.setup, jobRequirementProblem: problem },
          startFromJobDescription: true,
          requirementAction,
        }),
        "requirements",
      ).action;
    expect(refused("extract")).toEqual({
      id: "extract-requirements",
      label: "Extract requirements into a brief",
    });
    expect(refused("extract-again")?.label).toBe("Extract requirements again");
    expect(refused("use-reviewed")).toEqual({
      id: "use-reviewed-requirements",
      label: "Use the reviewed requirements instead",
    });
    expect(refused(null)).toBeNull();
  });

  it("folds the host's missing-job step into the requirements condition", () => {
    expect(jobDescriptionSteps).toContain(urlJobBriefStep);
    const conditions = startChecklist({
      ...allDone,
      setup: {
        ...allDone.setup,
        ready: false,
        jobDescriptionReady: false,
        nextSteps: ["Add a target job description.", "Add at least one candidate evidence source."],
      },
    });
    expect(condition(conditions, "requirements")).toMatchObject({
      done: false,
      detail: "Add a target job description.",
      action: { id: "add-job-description", label: "Add job description" },
    });
    // A step the four conditions do not cover stays an unmet item of its own.
    expect(conditions.at(-1)).toEqual({
      id: "setup-0",
      label: "Add at least one candidate evidence source.",
      done: false,
      action: null,
    });
    expect(startButtonLabel(conditions, false)).toBe(
      "Start review · add the job description first",
    );
  });

  describe("for an approved job page with no brief yet", () => {
    const approvedPage = (requirementAction: StartChecklistInput["requirementAction"]) =>
      startChecklist({
        ...allDone,
        setup: {
          ...allDone.setup,
          ready: false,
          jobDescriptionReady: false,
          reviewedOpportunity: null,
          nextSteps: [urlJobBriefStep, "Add at least one candidate evidence source."],
        },
        requirementAction,
        jobSource: "approved-page",
      });

    it("asks to extract the page's requirements, not to add a job description", () => {
      const conditions = approvedPage("extract");
      expect(condition(conditions, "requirements")).toEqual({
        id: "requirements",
        label: "Job requirements reviewed",
        done: false,
        detail: approvedPageRequirementsDetail,
        action: { id: "extract-requirements", label: "Extract requirements" },
      });
      expect(startButtonLabel(conditions, false)).toBe(
        "Start review · review the requirements first",
      );
    });

    it("does not repeat the host's missing-job step as an item of its own", () => {
      const conditions = approvedPage("extract");
      expect(conditions.filter((item) => item.id.startsWith("setup-"))).toEqual([
        {
          id: "setup-0",
          label: "Add at least one candidate evidence source.",
          done: false,
          action: null,
        },
      ]);
      expect(conditions.some((item) => item.action?.id === "add-job-description")).toBe(false);
      expect(JSON.stringify(conditions)).not.toContain(urlJobBriefStep);
    });

    it("keeps a waiting draft's review, an empty draft's retry and a host that cannot extract", () => {
      expect(condition(approvedPage("review-draft"), "requirements").action).toEqual({
        id: "review-requirements",
        label: "Review requirements",
      });
      expect(condition(approvedPage("extract-again"), "requirements").action).toEqual({
        id: "extract-requirements",
        label: "Extract requirements again",
      });
      const cannotExtract = approvedPage(null);
      expect(condition(cannotExtract, "requirements")).toMatchObject({
        detail: approvedPageRequirementsDetail,
        action: null,
      });
      expect(startButtonLabel(cannotExtract, false)).toBe(
        "Start review · review the requirements first",
      );
    });

    it("leaves a document job asking for the job description", () => {
      const conditions = startChecklist({
        ...allDone,
        setup: {
          ...allDone.setup,
          ready: false,
          jobDescriptionReady: false,
          reviewedOpportunity: null,
          nextSteps: ["Add a target job description."],
        },
        requirementAction: "extract",
        jobSource: "document",
      });
      expect(condition(conditions, "requirements").action).toEqual({
        id: "add-job-description",
        label: "Add job description",
      });
      expect(startButtonLabel(conditions, false)).toBe(
        "Start review · add the job description first",
      );
    });
  });

  it("states a start from the job description as written as done, not reviewed", () => {
    const requirements = condition(
      startChecklist({ ...allDone, setup: { ...allDone.setup, reviewedOpportunity: null } }),
      "requirements",
    );
    expect(requirements).toMatchObject({
      done: true,
      label: "Job requirements read from the job description",
    });
  });

  it("asks to choose a profile when the host requires one", () => {
    const conditions = startChecklist({
      ...allDone,
      candidateProfile: null,
      startDisabledReason: candidateProfileStartBlockerMessage,
    });
    expect(condition(conditions, "profile")).toEqual({
      id: "profile",
      label: "Reviewed career profile selected",
      done: false,
      detail: candidateProfileStartBlockerMessage,
      action: { id: "choose-profile", label: "Choose profile" },
    });
    // The profile refusal is the profile condition, not a second item at the top.
    expect(conditions[0]?.id).toBe("requirements");
    expect(startButtonLabel(conditions, false)).toBe("Start review · choose a profile first");
  });

  it("waits for a profile operation without offering a fix", () => {
    const profile = condition(
      startChecklist({ ...allDone, startDisabledReason: candidateProfilePendingBlockerMessage }),
      "profile",
    );
    expect(profile).toMatchObject({ done: false, action: null });
  });

  it("omits the profile condition when the host starts without one", () => {
    const conditions = startChecklist({ ...allDone, candidateProfile: null });
    expect(conditions.some((item) => item.id === "profile")).toBe(false);
  });

  it("offers provider sign-in on Home, checked when the review starts", () => {
    const signIn = condition(startChecklist(allDone), "provider-sign-in");
    expect(signIn).toMatchObject({
      done: false,
      checkedAtStart: true,
      action: { id: "open-provider-sign-in", label: "Open provider sign-in" },
    });
    expect(
      condition(startChecklist({ ...allDone, canOpenProviderSignIn: false }), "provider-sign-in")
        .action,
    ).toBeNull();
    // Unknown to the renderer, so it never blocks: the host's refusal names it instead.
    expect(firstUnmetStartCondition(startChecklist(allDone))).toBeNull();
    const demo = startChecklist({
      ...allDone,
      setup: { ...allDone.setup, fixtureMode: true },
      transmission: { required: false, acknowledged: true },
    });
    expect(condition(demo, "provider-sign-in").done).toBe(true);
  });

  it("marks provider sign-in done when the status reads report the pair signed in", () => {
    const conditions = startChecklist({
      ...allDone,
      providerSignIn: {
        state: "ready",
        summary: "Anthropic Claude session & OpenAI API key configured",
      },
    });
    expect(condition(conditions, "provider-sign-in")).toEqual({
      id: "provider-sign-in",
      label: "Provider sign-in ready",
      done: true,
      detail: "Anthropic Claude session & OpenAI API key configured.",
      action: null,
    });
    expect(firstUnmetStartCondition(conditions)).toBeNull();
  });

  it("shows missing sign-in as not done without blocking the host's start", () => {
    const missing = {
      ...allDone,
      providerSignIn: {
        state: "missing" as const,
        summary: "Configure OpenAI Codex session for live review",
      },
    };
    const signIn = condition(startChecklist(missing), "provider-sign-in");
    expect(signIn).toMatchObject({
      done: false,
      advisory: true,
      detail: "Configure OpenAI Codex session for live review.",
      action: { id: "open-provider-sign-in", label: "Open provider sign-in" },
    });
    expect(signIn.checkedAtStart).toBeUndefined();
    // The host stays the authority: the button and its hover text leave this row out.
    expect(firstUnmetStartCondition(startChecklist(missing))).toBeNull();
    expect(startChecklistTooltip(startChecklist(missing))).toBeUndefined();
    const alsoUnacknowledged = startChecklist({
      ...missing,
      transmission: { required: true, acknowledged: false },
    });
    expect(startButtonLabel(alsoUnacknowledged, false)).toBe(
      "Start review · review the data sent first",
    );
    expect(startChecklistTooltip(alsoUnacknowledged)).toBe(
      "Can't start yet: Acknowledge provider transmission above.",
    );
  });

  it("keeps sign-in checked at start when the read is unknown", () => {
    const signIn = condition(
      startChecklist({ ...allDone, providerSignIn: { state: "unknown", summary: null } }),
      "provider-sign-in",
    );
    expect(signIn).toMatchObject({
      done: false,
      checkedAtStart: true,
      detail: "Sign-in is on Home, under Workspace settings.",
    });
  });

  it("asks to review the data sent until transmission is acknowledged", () => {
    const conditions = startChecklist({
      ...allDone,
      transmission: { required: true, acknowledged: false },
    });
    expect(condition(conditions, "transmission")).toMatchObject({
      done: false,
      action: { id: "review-data-sent", label: "Review data sent" },
    });
    expect(startButtonLabel(conditions, false)).toBe("Start review · review the data sent first");
    expect(startChecklistTooltip(conditions)).toBe(
      "Can't start yet: Acknowledge provider transmission above.",
    );
  });

  it("puts any other host refusal first", () => {
    const reason = "The applied model profiles do not match this workspace's pair.";
    const conditions = startChecklist({ ...allDone, startDisabledReason: reason });
    expect(conditions[0]).toEqual({ id: "host-refusal", label: reason, done: false, action: null });
    expect(startButtonLabel(conditions, false)).toBe("Start review · see why below");
  });

  it("never leaves an unready setup without a stated reason", () => {
    const conditions = startChecklist({ ...allDone, setup: { ...allDone.setup, ready: false } });
    expect(firstUnmetStartCondition(conditions)?.label).toBe("Finish the workspace setup above.");
  });
});

function elements(node: ReactNode): ReactElement[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const props = child.props as { readonly children?: ReactNode };
    return [child, ...elements(props.children)];
  });
}

function buttons(node: ReactNode): ReactElement[] {
  return elements(node).filter((element) => element.type === "button");
}

describe("start checklist view", () => {
  const blocked = startChecklist({
    ...allDone,
    setup: {
      ...allDone.setup,
      ready: false,
      nextSteps: [problem],
      jobRequirementProblem: problem,
      reviewedOpportunity: null,
    },
    requirementAction: "review-draft",
    candidateProfile: null,
    startDisabledReason: candidateProfileStartBlockerMessage,
    transmission: { required: true, acknowledged: false },
  });

  it("states each condition in words and runs its fixing action", () => {
    const actions: StartActionId[] = [];
    const view = StartChecklistView({
      id: "start-checklist",
      conditions: blocked,
      onAction: (id) => actions.push(id),
    });
    const html = renderToStaticMarkup(view);
    expect(html).toContain('<strong id="start-checklist-title">Before you can start</strong>');
    expect(html).toContain('<ul aria-labelledby="start-checklist-title">');
    expect(html.match(/>Not done</gu)?.length).toBe(3);
    expect(html).toContain(">Checked when the review starts<");
    for (const button of buttons(view)) {
      (button.props as { onClick: () => void }).onClick();
    }
    expect(actions).toEqual([
      "review-requirements",
      "choose-profile",
      "open-provider-sign-in",
      "review-data-sent",
    ]);
  });

  it("shows the host's error above the conditions", () => {
    const html = renderToStaticMarkup(
      StartChecklistView({
        id: "start-checklist",
        conditions: startChecklist(allDone),
        errorMessage: "Sign in to Anthropic before starting a review.",
        onAction: () => undefined,
      }),
    );
    expect(html).toContain(
      '<div class="error-banner" role="alert"><p>Sign in to Anthropic before starting a review.</p></div><ul',
    );
    expect(html).not.toContain("start-checklist-blocked");
    expect(html.match(/>Done</gu)?.length).toBe(3);
  });

  it("offers no actions in read-only mode", () => {
    const view = StartChecklistView({
      id: "start-checklist",
      conditions: blocked,
      readOnly: true,
      onAction: () => undefined,
    });
    expect(buttons(view)).toEqual([]);
    expect(renderToStaticMarkup(view)).toContain(">Not done<");
  });
});

describe("revealing a checklist action's target", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("scrolls to the first target present and focuses its control", () => {
    const focus = vi.fn();
    const scrollIntoView = vi.fn();
    const control = { focus };
    const target = { scrollIntoView, matches: () => false, querySelector: () => control };
    const querySelector = vi.fn((selector: string) =>
      selector === 'section[aria-labelledby="application-profile-title"]' ? target : null,
    );
    vi.stubGlobal("document", { querySelector });
    revealStartTarget(startActionTargets["choose-profile"] ?? []);
    expect(querySelector).toHaveBeenCalledWith("#reviewed-profile-catalog");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

describe("ReviewWorkspace start checklist", () => {
  const fixture = createFixtureReviewState();
  const collecting = (overrides: Record<string, unknown> = {}) => ({
    ...fixture,
    state: "collecting" as const,
    runId: "pending",
    setup: { ...fixture.setup, fixtureMode: false, ...overrides },
    providerTransmissionPreflight: {
      ...fixture.providerTransmissionPreflight,
      required: true,
      acknowledged: true,
    },
  });

  it("keeps the checklist under the Start button when everything is done", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={collecting({ reviewedOpportunity: { briefId: "target-role", version: 3 } })}
        onAction={() => undefined}
        startCandidateProfile={{ version: 2 }}
        onOpenHome={() => undefined}
      />,
    );
    expect(html).toMatch(
      /aria-describedby="start-checklist">Start author–critic review<\/button><\/div><section class="start-checklist" id="start-checklist"/u,
    );
    expect(html).toContain('id="start-job-card"');
  });

  it("names the profile on the disabled button and offers Choose profile", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={collecting()}
        onAction={() => undefined}
        startCandidateProfile={null}
        startDisabledReason={candidateProfileStartBlockerMessage}
      />,
    );
    expect(html).toContain("Start review · choose a profile first");
    expect(html).toContain(">Choose profile</button>");
  });

  it("names the transmission acknowledgement and offers Review data sent", () => {
    const base = collecting();
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={{
          ...base,
          providerTransmissionPreflight: {
            ...base.providerTransmissionPreflight,
            acknowledged: false,
          },
        }}
        onAction={() => undefined}
      />,
    );
    expect(html).toContain("Start review · review the data sent first");
    expect(html).toContain(">Review data sent</button>");
  });

  const signInRow = (readiness?: ProviderSignInReadiness) => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={collecting({ reviewedOpportunity: { briefId: "target-role", version: 3 } })}
        onAction={() => undefined}
        startCandidateProfile={{ version: 2 }}
        onOpenHome={() => undefined}
        {...(readiness === undefined ? {} : { providerSignInReadiness: readiness })}
      />,
    );
    const row = html.slice(html.lastIndexOf("<li", html.indexOf(">Provider sign-in ready<")));
    return { html, row: row.slice(0, row.indexOf("</li>")) };
  };

  it("renders provider sign-in as Done when the reads report it ready", () => {
    const { html, row } = signInRow({
      state: "ready",
      summary: "Anthropic API key & OpenAI API key configured",
    });
    expect(row).toContain('class="start-check start-check-done"');
    expect(row).toContain(">Done<");
    expect(row).toContain("Anthropic API key &amp; OpenAI API key configured.");
    expect(row).not.toContain("Open provider sign-in");
    expect(html).toContain(">Start author–critic review</button>");
  });

  it("renders missing sign-in as Not done with Open provider sign-in, the button enabled", () => {
    const { html, row } = signInRow({
      state: "missing",
      summary: "Configure Anthropic Claude session for live review",
    });
    expect(row).toContain('class="start-check start-check-todo"');
    expect(row).toContain(">Not done<");
    expect(row).toContain("Configure Anthropic Claude session for live review.");
    expect(row).toContain(">Open provider sign-in</button>");
    expect(html).toContain(">Start author–critic review</button>");
    expect(html).not.toContain("start-checklist-blocked");
  });

  it("renders unknown sign-in as checked when the review starts", () => {
    for (const readiness of [undefined, { state: "unknown" as const, summary: null }]) {
      const { row } = signInRow(readiness);
      expect(row).toContain('class="start-check start-check-at-start"');
      expect(row).toContain(">Checked when the review starts<");
      expect(row).toContain(">Open provider sign-in</button>");
    }
  });

  it("shows a refused start in the checklist, not above the setup cards", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={collecting()}
        onAction={() => undefined}
        errorMessage="Sign in to OpenAI before starting a review."
      />,
    );
    const alert = html.indexOf('role="alert"');
    expect(alert).toBeGreaterThan(html.indexOf('id="start-checklist"'));
    expect(html.indexOf('role="alert"', alert + 1)).toBe(-1);
  });
});
