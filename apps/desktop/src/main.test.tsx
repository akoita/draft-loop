import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelCompany } from "./bridge.js";
import {
  dispatchFindingDecisions,
  filterModelOptions,
  type IndependencePreviewState,
  independencePreviewSummary,
  initialWorkspaceSetupDraft,
  type ModelDiscoveryState,
  type ModelFilterState,
  type ModelSide,
  modelDiscoveryNote,
  modelFilterText,
  modelInputMode,
  otherModelOptionValue,
  requiresLocalEndpoint,
  sharedLineageBlocksCreation,
  type WorkspaceSetupDraft,
  WorkspaceSetupForm,
  workspaceModelSelection,
  workspaceSetupBlocker,
  workspaceSetupFailureMessage,
} from "./main.js";
import {
  createFixtureReviewState,
  type DesktopReviewState,
  type IndependentReviewView,
  type ReviewAction,
  reduceReviewState,
  reviewFindingSummary,
  roundLimitRecoveryRequired,
  unresolvedBlockingFindings,
} from "./model.js";
import { DesktopBridgeError, workspaceCreateInput } from "./native.js";
import {
  bulkFindingDecisionTargets,
  canExportReview,
  filterFindingQueue,
  findingQueueCounts,
  initialFindingQueueState,
  isOverrideEditorVisible,
  ProviderAuthenticationMode,
  ReviewWorkspace,
} from "./review.js";
import { createReviewActionDispatcher } from "./review-dispatch.js";

const collectingState = () => ({
  ...createFixtureReviewState(),
  state: "collecting" as const,
  runId: "pending",
  setup: {
    ...createFixtureReviewState().setup,
    ready: true,
    nextSteps: [],
  },
});

describe("desktop trust-centered review", () => {
  it("offers OpenAI subscription authentication without exposing an API-key editor in session mode", () => {
    const html = renderToStaticMarkup(
      <ProviderAuthenticationMode
        status={{
          provider: "openai",
          activeMode: "user-session",
          preferredMode: "user-session",
          restartRequired: false,
          environmentOverride: false,
        }}
        credentialStatus={{
          provider: "openai",
          configured: false,
          source: "user-session",
          protection: "provider-managed-session",
        }}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("Authenticated Codex / ChatGPT subscription");
    expect(html).toContain("Active now: Authenticated Codex / ChatGPT subscription.");
    expect(html).toContain("Codex session: not detected");
    expect(html).toContain("codex login");
    expect(html).not.toContain("OpenAI API key (GPT)");
    expect(html).not.toContain('type="password"');
  });

  it("makes a saved authentication change visibly pending restart", () => {
    const html = renderToStaticMarkup(
      <ProviderAuthenticationMode
        status={{
          provider: "openai",
          activeMode: "api-key",
          preferredMode: "user-session",
          restartRequired: true,
          environmentOverride: false,
        }}
        credentialStatus={{
          provider: "openai",
          configured: true,
          source: "app",
          protection: "os-backed",
        }}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("Active now: Provider API key.");
    expect(html).toContain("Saved preference: Authenticated Codex / ChatGPT subscription.");
    expect(html).toContain("Close and reopen DraftLoop to apply it");
  });

  it("shows live execution details and a stop control", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "reviewing" as const,
      execution: {
        status: "running" as const,
        step: "critic" as const,
        provider: "openai",
        model: "gpt-5",
        attempt: 1,
        elapsedMs: 4_200,
        timeoutRemainingMs: 55_000,
      },
    };
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain("Stop review");
    expect(html).toContain("critic · openai/gpt-5 · attempt 1 · elapsed 4s · timeout in 55s");
  });

  it("explains and offers recovery for an interrupted durable run", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "revising" as const,
      execution: {
        status: "interrupted" as const,
        step: "revision" as const,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        attempt: 1,
        elapsedMs: 0,
        timeoutRemainingMs: null,
      },
    };
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain("Resume interrupted review");
    expect(html).toContain("previous app session ended");
  });

  it("acknowledges a pending review start without claiming step progress", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={collectingState()}
        onAction={() => undefined}
        pendingReviewAction={{ action: "start", elapsedSeconds: 4 }}
      />,
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain("Starting review…");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Elapsed 4 seconds");
    expect(html).toContain("Keep this window open");
    expect(html).not.toContain("author step");
    expect(html).not.toContain("critic step");
  });

  it("clears the pending projection after deferred success", async () => {
    let resolveOperation!: () => void;
    const operation = new Promise<void>((resolve) => {
      resolveOperation = resolve;
    });
    const projections: Array<{ action: "start"; elapsedSeconds: number } | null> = [];
    const dispatcher = createReviewActionDispatcher(
      (pending) => projections.push(pending as { action: "start"; elapsedSeconds: number } | null),
      () => 1_000,
    );

    expect(dispatcher.dispatch({ type: "start" }, () => operation)).toBe(true);
    expect(projections.at(-1)).toEqual({ action: "start", elapsedSeconds: 0 });
    resolveOperation();
    await operation;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(projections.at(-1)).toBeNull();
  });

  it("clears the pending projection after deferred failure", async () => {
    let rejectOperation!: (reason: unknown) => void;
    const operation = new Promise<void>((_, reject) => {
      rejectOperation = reject;
    });
    const projections: unknown[] = [];
    const dispatcher = createReviewActionDispatcher((pending) => projections.push(pending));

    expect(dispatcher.dispatch({ type: "start" }, () => operation)).toBe(true);
    rejectOperation(new Error("provider failure"));
    await operation.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(projections.at(-1)).toBeNull();
  });

  it("suppresses duplicate review actions while the first is in flight", async () => {
    let resolveOperation!: () => void;
    const operation = new Promise<void>((resolve) => {
      resolveOperation = resolve;
    });
    const dispatcher = createReviewActionDispatcher(() => undefined);
    let calls = 0;
    const run = () => {
      calls += 1;
      return operation;
    };

    expect(dispatcher.dispatch({ type: "start" }, run)).toBe(true);
    expect(dispatcher.dispatch({ type: "start" }, run)).toBe(false);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolveOperation();
    await operation;
  });

  it("shows honest onboarding for a real workspace without inputs", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "collecting" as const,
      runId: "pending",
      setup: {
        fixtureMode: false,
        jobDescriptionReady: false,
        evidenceSourceCount: 0,
        writingPolicyStatus: "none" as const,
        writingPolicy: null,
        retrievalStatus: "not-indexed" as const,
        indexedEvidenceChunkCount: 0,
        selectedEvidenceChunkCount: 0,
        selectedEvidenceSourceCount: 0,
        requiredSections: ["Summary", "Experience"],
        ready: false,
        nextSteps: ["Add a target job description.", "Add at least one candidate evidence source."],
      },
      providerTransmissionPreflight: {
        ...createFixtureReviewState().providerTransmissionPreflight,
        required: true,
        acknowledged: false,
        acknowledgedAt: null,
        fingerprint: "a".repeat(64),
        author: {
          company: "anthropic",
          model: "claude-sonnet-4-5",
          endpoint: "https://api.anthropic.com/v1/messages",
        },
        critic: {
          company: "openai",
          model: "gpt-5",
          endpoint: "https://api.openai.com/v1/responses",
        },
      },
    };
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={state}
        onAction={() => undefined}
        onSelectFiles={() => undefined}
        onAddUrl={() => undefined}
      />,
    );

    expect(html).toContain("Bring your source material into the loop");
    expect(html).toContain("Add job description");
    expect(html).toContain("Review and fetch source URL");
    expect(html).toContain("Writing policy");
    expect(html).toContain("Choose policy file");
    expect(html).toContain("kept separate from career evidence");
    expect(html).toContain("Start author–critic review");
    expect(html).toContain("Acknowledgement required");
    expect(html).toContain("selected candidate-source excerpts");
    expect(html).toContain("complete candidate corpus");
    expect(html).toContain("https://api.anthropic.com/v1/messages");
    expect(html).toContain("Acknowledge provider transmission");
    expect(html.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(2);
  });

  it("distinguishes pending indexing from a bounded no-match fallback", () => {
    const base = collectingState();
    const pendingHtml = renderToStaticMarkup(
      <ReviewWorkspace
        state={{
          ...base,
          setup: {
            ...base.setup,
            retrievalStatus: "not-indexed",
            indexedEvidenceChunkCount: 0,
            selectedEvidenceChunkCount: 0,
            selectedEvidenceSourceCount: 0,
          },
        }}
        onAction={() => undefined}
      />,
    );
    const fallbackHtml = renderToStaticMarkup(
      <ReviewWorkspace
        state={{
          ...base,
          setup: {
            ...base.setup,
            retrievalStatus: "fallback",
            indexedEvidenceChunkCount: 3,
            selectedEvidenceChunkCount: 2,
            selectedEvidenceSourceCount: 1,
          },
        }}
        onAction={() => undefined}
      />,
    );
    const activeFallbackHtml = renderToStaticMarkup(
      <ReviewWorkspace
        state={{
          ...createFixtureReviewState(),
          setup: {
            ...createFixtureReviewState().setup,
            retrievalStatus: "fallback",
            indexedEvidenceChunkCount: 3,
            selectedEvidenceChunkCount: 2,
            selectedEvidenceSourceCount: 1,
          },
        }}
        onAction={() => undefined}
      />,
    );

    expect(pendingHtml).toContain("Evidence will be indexed when the review starts");
    expect(fallbackHtml).toContain("No lexical match; 2 bounded fallback excerpts selected");
    expect(activeFallbackHtml).toContain(
      "No lexical match; using 2 bounded fallback excerpts from candidate material",
    );
  });

  it("makes paused progress, provider exposure, and unresolved findings visible", () => {
    const state = createFixtureReviewState();
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain("paused");
    expect(html).toContain("Local only");
    expect(html).toContain("not-allowed");
    expect(state.providerTransmissionPreflight.dataClass).toBe("synthetic-demo-material");
    expect(html).toContain("Disagreement · critic-only finding");
    expect(html).toContain("Resolve or override 1 blocking finding before approval.");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Export Markdown");
    expect(html).toContain("source linked");
    expect(html).toContain("not linked to candidate materials");
    expect(html).not.toContain(">verified<");
    expect(html).not.toContain(">unverified<");
  });

  it("shows bounded provider recovery actions without exposing provider payloads", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "provider-error" as const,
      providerFailure: {
        code: "timeout" as const,
        explanation: "The provider did not respond before the request timed out.",
        provider: "openai",
        model: "gpt-5",
        step: "critic" as const,
        attempt: 2,
        maxAttempts: 3,
        retryAvailable: true,
        retryNotBefore: null,
        availableActions: ["retry", "stop"] as const,
        diagnostics: [{ code: "invalid_type", path: "sections.0.blocks" }],
      },
    };
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={state}
        onAction={() => undefined}
        errorMessage="The review action could not be completed."
      />,
    );

    expect(html).toContain("Provider request failed");
    expect(html).toContain('class="error-banner" role="alert"');
    expect(html).toContain("The review action could not be completed.");
    expect(html).toContain("Retry critic");
    expect(html).not.toContain("Return to review");
    expect(html).toContain("Stop run");
    expect(html).toContain("Validation details");
    expect(html).toContain("sections.0.blocks: invalid_type");
    expect(reduceReviewState(state, { type: "resume" }).state).toBe("reviewing");
    expect(reduceReviewState(state, { type: "recover-to-review" }).state).toBe("provider-error");
    expect(reduceReviewState(state, { type: "stop" }).state).toBe("stopped");
  });

  it("keeps retry disabled while the provider cooldown is active", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "provider-error" as const,
      providerFailure: {
        code: "rate-limit" as const,
        explanation: "The provider rate limit was reached. Wait briefly before retrying.",
        provider: "openai",
        model: "gpt-5",
        step: "critic" as const,
        attempt: 1,
        maxAttempts: 3,
        retryAvailable: true,
        retryNotBefore: new Date(Date.now() + 5_000).toISOString(),
        availableActions: ["retry", "stop"] as const,
        diagnostics: [],
      },
    };

    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain("Retry critic in 5 seconds");
    expect(html).toContain("Retry is paused until the provider retry window opens");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Provider recovery remains before approval");
  });

  it("shows pending finding feedback and disables every decision button", () => {
    const state = {
      ...createFixtureReviewState(),
      findings: createFixtureReviewState().findings.map((finding) => ({
        ...finding,
        rationale: "Existing rationale for test coverage.",
      })),
    };
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={state}
        onAction={() => undefined}
        pendingReviewAction={{ action: "finding-decision", elapsedSeconds: 2 }}
      />,
    );

    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("Saving finding decision… Elapsed 2 seconds.");
    for (const decision of ["Accept", "Reject", "Defer", "Override"]) {
      expect(html).toContain(`disabled="">${decision}</button>`);
    }
  });

  it("summarizes and filters findings as an actionable review queue", () => {
    const findings = createFixtureReviewState().findings;

    expect(findingQueueCounts(findings)).toEqual({
      needsAction: 2,
      blocking: 1,
      warnings: 1,
      resolved: 0,
    });
    expect(filterFindingQueue(findings, "blocking").map((finding) => finding.id)).toEqual([
      "finding-unsupported-claim",
    ]);
    expect(initialFindingQueueState(findings)).toEqual({
      filter: "needs-action",
      expandedFindingId: "finding-unsupported-claim",
    });

    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );
    expect(html).toContain("0 of 2 resolved · 2 need action");
    expect(html).toContain("Needs action");
    expect(html).toContain("Blocking");
    expect(html).toContain("Warnings");
    expect(html).toContain("Resolved");
    expect(html.match(/aria-expanded="true"/gu)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/gu)).toHaveLength(1);
    expect(html).not.toContain("Override rationale (required)");
  });

  it("offers bulk decisions for every actionable finding in the active queue", () => {
    const state = createFixtureReviewState();

    expect(bulkFindingDecisionTargets(state.findings, "needs-action", "accepted")).toEqual([
      "finding-unsupported-claim",
      "finding-coverage",
    ]);
    expect(bulkFindingDecisionTargets(state.findings, "warnings", "accepted")).toEqual([
      "finding-coverage",
    ]);
    expect(bulkFindingDecisionTargets(state.findings, "resolved", "accepted")).toEqual([]);

    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={state}
        onAction={() => undefined}
        onBulkFindingDecision={() => undefined}
      />,
    );
    expect(html).toContain("Apply to all 2 shown");
    expect(html).toContain("Accept all");
    expect(html).toContain("Reject all");
    expect(html).toContain("Defer all");
    expect(html).not.toContain("Override all");
  });

  it("reports and disables a bulk decision while it is being saved", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={createFixtureReviewState()}
        onAction={() => undefined}
        onBulkFindingDecision={() => undefined}
        pendingBulkFindingCount={2}
        pendingReviewAction={{ action: "finding-decision", elapsedSeconds: 3 }}
      />,
    );

    expect(html).toContain("Saving 2 finding decisions… Elapsed 3 seconds.");
    for (const decision of ["Accept all", "Reject all", "Defer all"]) {
      expect(html).toContain(`disabled="">${decision}</button>`);
    }
  });

  it("serializes bulk finding decisions through the existing durable action", async () => {
    const initial = createFixtureReviewState();
    const receivedStates: DesktopReviewState[] = [];
    const receivedActions: ReviewAction[] = [];

    const result = await dispatchFindingDecisions(
      initial,
      initial.findings.map((finding) => finding.id),
      "accepted",
      async (state, action) => {
        receivedStates.push(state);
        receivedActions.push(action);
        return reduceReviewState(state, action);
      },
    );

    expect(receivedActions).toEqual([
      {
        type: "finding-decision",
        findingId: "finding-unsupported-claim",
        decision: "accepted",
      },
      { type: "finding-decision", findingId: "finding-coverage", decision: "accepted" },
    ]);
    expect(receivedStates[1]?.findings[0]?.decision).toBe("accepted");
    expect(result.findings.map((finding) => finding.decision)).toEqual(["accepted", "accepted"]);
  });

  it("keeps fully resolved findings compact by default", () => {
    const initial = createFixtureReviewState();
    const resolved = {
      ...initial,
      findings: initial.findings.map((finding, index) => ({
        ...finding,
        decision: index === 0 ? ("overridden" as const) : ("rejected" as const),
        ...(index === 0 ? { rationale: "Verified against the candidate source." } : {}),
      })),
    };

    expect(initialFindingQueueState(resolved.findings)).toEqual({
      filter: "resolved",
      expandedFindingId: null,
    });
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={resolved} onAction={() => undefined} />,
    );
    expect(html).toContain("2 of 2 resolved · all findings resolved");
    expect(html.match(/aria-expanded="false"/gu)).toHaveLength(2);
    expect(html).not.toContain("Linked claim:");
  });

  it("keeps an accepted blocking finding actionable until the artifact is revised", () => {
    const initial = createFixtureReviewState();
    const accepted = reduceReviewState(initial, {
      type: "finding-decision",
      findingId: "finding-unsupported-claim",
      decision: "accepted",
    });
    const awaitingApproval = { ...accepted, state: "awaiting-approval" as const };

    expect(unresolvedBlockingFindings(awaitingApproval)).toHaveLength(1);
    expect(reduceReviewState(awaitingApproval, { type: "approve" }).approval).toBe("pending");

    const html = renderToStaticMarkup(
      <ReviewWorkspace state={awaitingApproval} onAction={() => undefined} />,
    );
    expect(html).toContain("Accepted · revision required");
    expect(html).toContain("Request a revision for 1 accepted blocking finding");
    expect(html).toMatch(/aria-keyshortcuts="Alt\+A"[^>]*disabled=""/u);
  });

  it("reveals override rationale only for the explicitly edited finding", () => {
    expect(isOverrideEditorVisible("finding-a", "finding-a")).toBe(true);
    expect(isOverrideEditorVisible("finding-a", "finding-b")).toBe(false);
    expect(isOverrideEditorVisible(null, "finding-a")).toBe(false);
  });

  it("does not describe an absent artifact as validated or approvable", () => {
    const initial = createFixtureReviewState();
    const state = {
      ...initial,
      state: "stopped" as const,
      artifact: {
        ...initial.artifact,
        id: "artifact-unavailable",
        version: 0,
        sections: [],
        claims: [],
      },
      previousArtifact: null,
      findings: [],
    };
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain("No draft artifact available");
    expect(html).toContain("Not evaluated");
    expect(html).toContain("Start a new review");
    expect(html).toContain(
      "Approval and export are unavailable until the author produces a valid draft.",
    );
    expect(html).not.toContain("All findings have a recorded decision.");
    expect(html).not.toContain("No unresolved blocking findings.");
    expect(html).toContain("Approve artifact");
    expect(html).toMatch(/aria-keyshortcuts="Alt\+A"[^>]*disabled=""/u);
  });

  it("requires an explicit override before approval can be committed", () => {
    const initial = createFixtureReviewState();
    expect(unresolvedBlockingFindings(initial)).toHaveLength(1);
    const blocked = reduceReviewState(initial, { type: "approve" });
    expect(blocked.state).toBe("paused");

    const overridden = reduceReviewState(initial, {
      type: "finding-decision",
      findingId: "finding-unsupported-claim",
      decision: "overridden",
      rationale: "Verified against the candidate's original source.",
    });
    const readyForApproval = { ...overridden, state: "awaiting-approval" as const };
    const approved = reduceReviewState(readyForApproval, { type: "approve" });
    expect(approved.state).toBe("approved");
    expect(approved.approval).toBe("approved");
  });

  it("keeps legacy approval unexportable when independent review is incomplete", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "approved" as const,
      approval: "approved" as const,
      reviewComplete: false,
      findings: [],
    };

    expect(canExportReview(state, null)).toBe(false);
    expect(reduceReviewState(state, { type: "export" })).toEqual(state);
    expect(
      reduceReviewState({ ...state, state: "awaiting-approval" }, { type: "request-revision" }),
    ).toEqual({
      ...state,
      state: "awaiting-approval",
    });
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
    expect(html).toContain("Independent critique did not complete");
    expect(html).toContain("Complete an independent critic review before approval or export.");
    expect(html).toContain("Unavailable until independent critique completes");
    expect(html).not.toContain("Available now");
    expect(html).not.toContain("All findings have a recorded decision.");
    expect(html).toContain("Export Markdown");
    expect(html).toMatch(/aria-keyshortcuts="Alt\+E"[^>]*disabled=""/u);
  });

  it("distinguishes non-blocking warnings from approval blockers", () => {
    const initial = createFixtureReviewState();
    const warningOnly = {
      ...initial,
      state: "awaiting-approval" as const,
      findings: initial.findings.map((finding) =>
        finding.severity === "error"
          ? {
              ...finding,
              decision: "overridden" as const,
              rationale: "Verified against the candidate's original source.",
            }
          : finding,
      ),
    };

    expect(reviewFindingSummary(warningOnly)).toMatchObject({
      blocking: [],
      warnings: [{ id: "finding-coverage" }],
      status: "warnings",
    });
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={warningOnly} onAction={() => undefined} />,
    );
    expect(html).toContain("1 unresolved warning");
    expect(html).toContain("Approval is available with 1 unresolved non-blocking warning");
    expect(reduceReviewState(warningOnly, { type: "approve" }).approval).toBe("approved");
  });

  it("does not accept an override without a rationale", () => {
    const initial = createFixtureReviewState();
    const unchanged = reduceReviewState(initial, {
      type: "finding-decision",
      findingId: "finding-unsupported-claim",
      decision: "overridden",
    });
    expect(unchanged.findings[0]?.decision).toBe("pending");
  });

  it("only acknowledges the currently projected provider policy", () => {
    const initial = {
      ...createFixtureReviewState(),
      providerTransmissionPreflight: {
        ...createFixtureReviewState().providerTransmissionPreflight,
        required: true,
        acknowledged: false,
        fingerprint: "b".repeat(64),
      },
    };
    expect(
      reduceReviewState(initial, {
        type: "acknowledge-provider-transmission",
        fingerprint: "a".repeat(64),
      }).providerTransmissionPreflight.acknowledged,
    ).toBe(false);
    expect(
      reduceReviewState(initial, {
        type: "acknowledge-provider-transmission",
        fingerprint: "b".repeat(64),
      }).providerTransmissionPreflight.acknowledged,
    ).toBe(true);
  });

  it("keeps export unavailable until after approval", () => {
    const state = createFixtureReviewState();
    expect(reduceReviewState(state, { type: "export" }).state).toBe("paused");
    const approved = {
      ...state,
      state: "approved" as const,
      approval: "approved" as const,
      findings: state.findings.map((finding) => ({ ...finding, decision: "overridden" as const })),
    };
    expect(reduceReviewState(approved, { type: "export" }).state).toBe("exported");
  });

  it("makes an in-flight Markdown export visible and prevents duplicate actions", () => {
    const initial = createFixtureReviewState();
    const approved = {
      ...initial,
      state: "approved" as const,
      approval: "approved" as const,
      findings: initial.findings.map((finding) => ({
        ...finding,
        decision: "overridden" as const,
      })),
    };

    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={approved}
        onAction={() => undefined}
        pendingReviewAction={{ action: "export", elapsedSeconds: 3 }}
        errorMessage="The Markdown file could not be written."
      />,
    );

    expect(html).toContain("Exporting Markdown…");
    expect(html).toContain("Elapsed 3 seconds");
    expect(html).toContain("Choose a destination in the Save As dialog");
    expect(html).toContain("the approved artifact will be written after you confirm.");
    expect(html).not.toContain("while the approved artifact is written");
    expect(html).toContain("The Markdown file could not be written.");
    expect(html).toContain('class="error-banner approval-action-error" role="alert"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

/**
 * The trust strip is the last thing a person reads before approving, so its
 * independence claim must be the record the run kept. It used to be a company
 * comparison computed here, which reported "independent" for two vendors
 * serving one base model — the exact over-claim ADR 0005 was written to remove.
 */
describe("desktop approval gate independence", () => {
  const withIndependence = (independentReview: IndependentReviewView | null) => {
    const fixture = createFixtureReviewState();
    return {
      ...fixture,
      providerExposure: { ...fixture.providerExposure, independentReview },
    };
  };
  const render = (independentReview: IndependentReviewView | null) =>
    renderToStaticMarkup(
      <ReviewWorkspace state={withIndependence(independentReview)} onAction={() => undefined} />,
    );

  it("never labels a completed critique as independent", () => {
    // `reviewComplete` says a critique finished, not that it was independent.
    const html = render({
      authorLineage: "openweights:llama-4-70b",
      criticLineage: "openweights:llama-4-70b",
      lineagesDistinct: false,
      required: true,
      overrideRationale: "Comparing two deployments of one base model on purpose.",
    });

    expect(html).not.toContain("Independent critique completed");
    expect(html).toContain("Critique completed");
  });

  it("reports an overridden shared lineage as not independent at the gate", () => {
    const html = render({
      authorLineage: "openweights:llama-4-70b",
      criticLineage: "openweights:llama-4-70b",
      lineagesDistinct: false,
      required: true,
      overrideRationale: "Comparing two deployments of one base model on purpose.",
    });

    expect(html).toContain(
      "Shared lineage overridden on a recorded rationale; critique was not independent",
    );
  });

  it("reports distinct lineages at the gate as a claim", () => {
    const html = render({
      authorLineage: "anthropic:claude-sonnet-4-5",
      criticLineage: "openai:gpt-5",
      lineagesDistinct: true,
      required: true,
      overrideRationale: null,
    });

    expect(html).toContain("Author and critic lineages differ, as claimed");
  });

  it("does not claim independence at the gate when nothing was recorded", () => {
    const html = render(null);

    expect(html).not.toContain("Independent critique completed");
    expect(html).toContain("Independence claim recorded");
  });
});

describe("desktop trust strip independence", () => {
  const withIndependence = (independentReview: IndependentReviewView | null) => {
    const fixture = createFixtureReviewState();
    return {
      ...fixture,
      providerExposure: { ...fixture.providerExposure, independentReview },
    };
  };
  const render = (independentReview: IndependentReviewView | null) =>
    renderToStaticMarkup(
      <ReviewWorkspace state={withIndependence(independentReview)} onAction={() => undefined} />,
    );

  it("reports distinct lineages as a claim rather than as proof", () => {
    const html = render({
      authorLineage: "anthropic:claude-sonnet-4-5",
      criticLineage: "openai:gpt-5",
      lineagesDistinct: true,
      required: true,
      overrideRationale: null,
    });

    expect(html).toContain("trust-badge-independent");
    expect(html).toContain("lineages differ");
    expect(html).toContain(
      "Author and critic lineages differ, as claimed. A lineage is an operator label that nothing verifies; two labels can name the same weights.",
    );
    expect(html).toContain("claimed lineage");
    expect(html).toContain("anthropic:claude-sonnet-4-5");
    expect(html).toContain("openai:gpt-5");
    expect(html).not.toContain("Override rationale");
  });

  it("never presents an overridden shared lineage as independent", () => {
    // Two companies, one lineage: the false accept the company comparison made
    // silently. The badge must not read as independent in any form.
    const html = render({
      authorLineage: "openweights:llama-4-70b",
      criticLineage: "openweights:llama-4-70b",
      lineagesDistinct: false,
      required: true,
      overrideRationale: "No second lineage is available offline; a human reviewed the critique.",
    });

    expect(html).toContain("trust-badge-shared");
    expect(html).not.toContain("trust-badge-independent");
    expect(html).not.toContain("lineages differ");
    expect(html).toContain("overridden");
    expect(html).toContain(
      "Author and critic share one lineage, so this critique was not independent; the run proceeded on a recorded rationale.",
    );
    expect(html).toContain("Override rationale");
    expect(html).toContain(
      "No second lineage is available offline; a human reviewed the critique.",
    );
    // The renderer no longer says anything about companies.
    expect(html).not.toContain("same company");
    expect(html).not.toContain("provider diversity not met");
  });

  it("says a shared lineage with no rationale was not independent", () => {
    const html = render({
      authorLineage: "local:mistral-small",
      criticLineage: "local:mistral-small",
      lineagesDistinct: false,
      required: true,
      overrideRationale: null,
    });

    expect(html).toContain("trust-badge-shared");
    expect(html).not.toContain("trust-badge-independent");
    expect(html).toContain("not independent");
    expect(html).toContain(
      "Author and critic share one lineage, and no override rationale was recorded, so this critique was not independent.",
    );
    expect(html).not.toContain("Override rationale");
  });

  it("says nothing was recorded when the run carries no independence claim", () => {
    const html = render(null);

    expect(html).toContain("trust-badge-unrecorded");
    expect(html).not.toContain("trust-badge-independent");
    expect(html).not.toContain("trust-badge-shared");
    expect(html).toContain("not recorded");
    expect(html).toContain(
      "No lineage claim was recorded. Either no run has started yet, or the run predates independence being recorded.",
    );
    expect(html).not.toContain("claimed lineage");
    expect(html).not.toContain("Override rationale");
  });

  it("keeps independence not being required distinct from independence holding", () => {
    const notRequiredAndShared = render({
      authorLineage: "local:mistral-small",
      criticLineage: "local:mistral-small",
      lineagesDistinct: false,
      required: false,
      overrideRationale: null,
    });

    expect(notRequiredAndShared).toContain("trust-badge-unrecorded");
    expect(notRequiredAndShared).not.toContain("trust-badge-independent");
    expect(notRequiredAndShared).toContain("not required");
    expect(notRequiredAndShared).toContain(
      "Independent review was not required for this run; the claimed lineages are the same.",
    );

    const notRequiredAndDistinct = render({
      authorLineage: "anthropic:claude-sonnet-4-5",
      criticLineage: "openai:gpt-5",
      lineagesDistinct: true,
      required: false,
      overrideRationale: null,
    });

    expect(notRequiredAndDistinct).not.toContain("trust-badge-independent");
    expect(notRequiredAndDistinct).toContain(
      "Independent review was not required for this run; the claimed lineages differ.",
    );
  });
});

/**
 * Choosing the two models before the workspace exists.
 *
 * The form is presentational and every answer it shows arrives as a prop, so
 * these render it directly rather than driving `App`: what is worth asserting
 * is the wording and the blocking, not React's own effect scheduling.
 */
describe("desktop workspace setup", () => {
  const findElement = (
    node: ReactNode,
    predicate: (element: ReactElement) => boolean,
  ): ReactElement | undefined => {
    for (const child of Children.toArray(node)) {
      if (!isValidElement(child)) continue;
      if (predicate(child)) return child;
      const nested = findElement(
        (child.props as { readonly children?: ReactNode }).children,
        predicate,
      );
      if (nested !== undefined) return nested;
    }
    return undefined;
  };

  const ready = (
    authorLineage: string,
    criticLineage: string,
    lineagesDistinct: boolean,
  ): IndependencePreviewState => ({
    status: "ready",
    result: { authorLineage, criticLineage, lineagesDistinct },
  });

  const idleDiscovery: Readonly<Record<ModelCompany, ModelDiscoveryState>> = {
    anthropic: { status: "idle" },
    openai: { status: "idle" },
    local: { status: "idle" },
  };

  const noFilters = (
    draft: WorkspaceSetupDraft,
  ): Readonly<Record<ModelSide, ModelFilterState>> => ({
    author: { company: draft.authorCompany, text: "" },
    critic: { company: draft.criticCompany, text: "" },
  });

  const renderForm = (
    draft: WorkspaceSetupDraft,
    preview: IndependencePreviewState,
    discovery: Readonly<Record<ModelCompany, ModelDiscoveryState>> = idleDiscovery,
    modelFilters: Readonly<Record<ModelSide, ModelFilterState>> = noFilters(draft),
  ) =>
    renderToStaticMarkup(
      <WorkspaceSetupForm
        draft={draft}
        discovery={discovery}
        preview={preview}
        typingOwnModel={{ author: false, critic: false }}
        modelFilters={modelFilters}
        busy={false}
        onDraftChange={() => undefined}
        onModelFilterChange={() => undefined}
        onTypeOwnModel={() => undefined}
        onCreate={() => undefined}
        onCreateDemo={() => undefined}
        onOpen={() => undefined}
      />,
    );

  const named: WorkspaceSetupDraft = {
    ...initialWorkspaceSetupDraft,
    authorModel: "claude-sonnet-4-5",
    criticModel: "gpt-5",
  };

  it("offers a company and a model for each side, and keeps the demo path", () => {
    const html = renderForm(initialWorkspaceSetupDraft, { status: "idle" });

    expect(html).toContain("Author model");
    expect(html).toContain("Critic model");
    expect(html).toContain('aria-label="Author company"');
    expect(html).toContain('aria-label="Critic company"');
    expect(html).toContain('aria-label="Author model"');
    expect(html).toContain('aria-label="Critic model"');
    for (const company of ["anthropic", "openai", "local"]) {
      expect(html).toContain(`value="${company}"`);
    }
    expect(html).toContain("Create workspace");
    expect(html).toContain("Try demo workspace");
    expect(html).toContain("Open workspace");
    expect(html).toContain("Maximum review rounds");
    expect(html).toContain('aria-label="Maximum review rounds"');
    // Nothing is claimed about a pairing that has not been named yet.
    expect(html).toContain(
      "Name an author model and a critic model, and this will say whether the pairing counts as independent.",
    );
    expect(html).not.toContain("as claimed");
  });

  it("lists discovered models and keeps a way to name one that is not listed", () => {
    const html = renderForm(named, ready("anthropic:claude-sonnet-4-5", "openai:gpt-5", true), {
      ...idleDiscovery,
      anthropic: {
        status: "ready",
        models: ["claude-sonnet-4-5", "claude-haiku-4-5"],
        source: "live",
        truncated: false,
      },
    });

    expect(html).toContain('<option value="claude-haiku-4-5">claude-haiku-4-5</option>');
    expect(html).toContain(`<option value="${otherModelOptionValue}">Other model…</option>`);
    expect(html).toContain("2 models listed by the provider");
  });

  /**
   * A provider that answers with 118 ids, which is the size that made the
   * plain select unusable. The two families are deliberately disjoint, so a
   * filter that matches one can be checked to have hidden the other.
   */
  const manyModels: readonly string[] = [
    ...Array.from({ length: 60 }, (_, index) => `gpt-5-preview-${index}`),
    ...Array.from({ length: 58 }, (_, index) => `o4-mini-${index}`),
  ];

  const filteredCritic = (
    draft: WorkspaceSetupDraft,
    text: string,
    models: readonly string[] = manyModels,
  ) =>
    renderForm(
      draft,
      { status: "idle" },
      {
        ...idleDiscovery,
        openai: { status: "ready", models, source: "live", truncated: false },
      },
      { ...noFilters(draft), critic: { company: "openai", text } },
    );

  it("narrows a long list to what was typed, and says how many are shown", () => {
    expect(manyModels).toHaveLength(118);
    const narrowed = filterModelOptions(manyModels, "GPT-5-preview-1", "");

    // Matching is case-insensitive and on any part of the id.
    expect(narrowed.options).toContain("gpt-5-preview-1");
    expect(narrowed.options).toContain("gpt-5-preview-19");
    expect(narrowed.options).not.toContain("o4-mini-1");
    expect(narrowed.matched).toBe(11);
    expect(narrowed.note).toBe("Showing 11 of 118 models matching “GPT-5-preview-1”.");
    // An empty filter is not a filter: everything stays, and nothing is said.
    expect(filterModelOptions(manyModels, "  ", "").options).toBe(manyModels);
    expect(filterModelOptions(manyModels, "  ", "").note).toBe("");

    const html = filteredCritic({ ...named, criticModel: "gpt-5-preview-3" }, "preview-3");
    expect(html).toContain('<option value="gpt-5-preview-3" selected="">gpt-5-preview-3</option>');
    expect(html).toContain('<option value="gpt-5-preview-30">gpt-5-preview-30</option>');
    expect(html).not.toContain(">o4-mini-3<");
    expect(html).toContain("Showing 11 of 118 models matching “preview-3”.");
    // Filtering is presentation: the provider's own count is still reported.
    expect(html).toContain("118 models listed by the provider");
    expect(html).toContain('aria-label="Filter Critic models"');
    // The author side is typing its id, so there is no list to filter there.
    expect(html).not.toContain('aria-label="Filter Author models"');

    const unfilteredHtml = filteredCritic({ ...named, criticModel: "gpt-5-preview-3" }, "");
    expect(unfilteredHtml).toContain(
      'id="setup-model-filter-note-critic" class="setup-note setup-filter-note" role="status" aria-live="polite"></p>',
    );
  });

  it("keeps the chosen model listed even when the filter does not match it", () => {
    const kept = filterModelOptions(manyModels, "o4-mini-2", "gpt-5-preview-7");

    expect(kept.options).toContain("gpt-5-preview-7");
    expect(kept.options).toContain("o4-mini-2");
    expect(kept.matched).toBe(11);
    expect(kept.keptSelected).toBe(true);
    expect(kept.note).toBe(
      "Showing 11 of 118 models matching “o4-mini-2”, and the model you chose.",
    );
    // The provider's order is kept, so the option does not jump about either.
    expect(kept.options.indexOf("gpt-5-preview-7")).toBeLessThan(kept.options.indexOf("o4-mini-2"));
    const unlisted = filterModelOptions(manyModels, "o4", "not-listed");
    expect(unlisted.keptSelected).toBe(true);
    expect(unlisted.options.at(-1)).toBe("not-listed");

    const html = filteredCritic({ ...named, criticModel: "gpt-5-preview-7" }, "o4-mini-2");
    expect(html).toContain('<option value="gpt-5-preview-7" selected="">gpt-5-preview-7</option>');
    expect(html).toContain(`<option value="${otherModelOptionValue}">Other model…</option>`);
  });

  it("keeps an unlisted typed id selected when discovery later produces a list", () => {
    const selected = "gpt-private-deployment";
    const unfiltered = filterModelOptions(manyModels, "", selected);

    expect(unfiltered.options.slice(0, manyModels.length)).toEqual(manyModels);
    expect(unfiltered.options.at(-1)).toBe(selected);
    expect(unfiltered.keptSelected).toBe(true);

    const unfilteredHtml = filteredCritic({ ...named, criticModel: selected }, "");
    expect(unfilteredHtml).toContain(
      `<option value="${selected}" selected="">${selected}</option>`,
    );

    const filteredHtml = filteredCritic({ ...named, criticModel: selected }, "o4-mini-2");
    expect(filteredHtml).toContain(`<option value="${selected}" selected="">${selected}</option>`);
    expect(filteredHtml).toContain(
      "Showing 11 of 118 models matching “o4-mini-2”, and the model you chose.",
    );
  });

  it("says what to do when nothing matches rather than showing an empty list", () => {
    expect(filterModelOptions(manyModels, "llama", "").note).toBe(
      "No model id contains “llama”. Clear the filter to see all 118 models, or choose “Other model…” to type an id.",
    );
    expect(filterModelOptions(manyModels, "llama", "gpt-5-preview-7").note).toBe(
      "No model id contains “llama”, so only the model you chose is listed. Clear the filter to see all 118 models, or choose “Other model…” to type an id.",
    );
    expect(filterModelOptions(["gpt-5"], "llama", "").note).toBe(
      "No model id contains “llama”. Clear the filter to see all 1 model, or choose “Other model…” to type an id.",
    );

    const html = filteredCritic(named, "llama");
    expect(html).toContain("setup-filter-empty");
    expect(html).toContain("No model id contains “llama”, so only the model you chose is listed.");
    // The escape hatch survives a filter that matched nothing at all.
    expect(html).toContain(`<option value="${otherModelOptionValue}">Other model…</option>`);
    // An empty list never stops a workspace being created.
    expect(html).not.toContain('type="submit" disabled=""');
  });

  it("clears that side's real filter state whenever its provider changes", () => {
    let currentDraft = { ...named };
    let currentFilters: Readonly<Record<ModelSide, ModelFilterState>> = {
      ...noFilters(currentDraft),
      critic: { company: "openai", text: "gpt" },
    };
    const form = () =>
      WorkspaceSetupForm({
        draft: currentDraft,
        discovery: idleDiscovery,
        preview: { status: "idle" },
        typingOwnModel: { author: false, critic: false },
        modelFilters: currentFilters,
        busy: false,
        onDraftChange: (next) => {
          currentDraft = next;
        },
        onModelFilterChange: (side, filter) => {
          currentFilters = { ...currentFilters, [side]: filter };
        },
        onTypeOwnModel: () => undefined,
      });
    const criticFields = () => {
      const fields = findElement(
        form(),
        (element) => (element.props as { readonly side?: ModelSide }).side === "critic",
      );
      expect(fields).toBeDefined();
      return fields as ReactElement<{
        readonly onCompanyChange: (company: ModelCompany) => void;
        readonly onFilterChange: (text: string) => void;
      }>;
    };

    expect(modelFilterText(currentFilters.critic, "openai")).toBe("gpt");
    criticFields().props.onCompanyChange("anthropic");
    expect(currentFilters.critic).toEqual({ company: "anthropic", text: "" });
    criticFields().props.onFilterChange("claude");
    expect(currentFilters.critic).toEqual({ company: "anthropic", text: "claude" });
    criticFields().props.onCompanyChange("openai");
    expect(currentFilters.critic).toEqual({ company: "openai", text: "" });
    expect(modelFilterText(currentFilters.critic, "openai")).toBe("");
  });

  it("filters what is offered without touching what is submitted", () => {
    const chosen: WorkspaceSetupDraft = { ...named, criticModel: "gpt-5-preview-7" };

    // The filter is not part of the draft, so there is nothing it could send.
    expect(Object.keys(chosen)).not.toContain("filter");
    expect(workspaceModelSelection(chosen).criticModel).toBe("gpt-5-preview-7");
    // A filter that hides the chosen id and one that shows it render the same
    // selection, and neither reaches the create path.
    expect(filteredCritic(chosen, "o4")).toContain(
      '<option value="gpt-5-preview-7" selected="">gpt-5-preview-7</option>',
    );
    expect(filteredCritic(chosen, "")).toContain(
      '<option value="gpt-5-preview-7" selected="">gpt-5-preview-7</option>',
    );
    expect(workspaceSetupBlocker(chosen, { status: "idle" })).toBeNull();
  });

  it("falls back to a typed model id and says why discovery failed", () => {
    const failed: ModelDiscoveryState = {
      status: "unavailable",
      reason: "No API key is configured for this provider. Add one before listing its models.",
    };

    expect(modelInputMode("anthropic", failed, false, false)).toBe("text");
    expect(modelDiscoveryNote("anthropic", failed, false)).toBe(
      "Models could not be listed. No API key is configured for this provider. Add one before listing its models. Type the model id instead; this does not stop the workspace being created.",
    );
    expect(
      modelInputMode(
        "anthropic",
        { status: "ready", models: [], source: "live", truncated: false },
        false,
        false,
      ),
    ).toBe("text");
    expect(modelInputMode("anthropic", { status: "idle" }, false, false)).toBe("text");

    const html = renderForm(named, { status: "idle" }, { ...idleDiscovery, anthropic: failed });
    expect(html).toContain("No API key is configured for this provider.");
    expect(html).toContain("this does not stop the workspace being created");
    // A discovery failure never disables creation.
    expect(html).not.toContain('type="submit" disabled=""');
  });

  it("reveals a local endpoint field and states what a local address may be", () => {
    const local: WorkspaceSetupDraft = { ...named, authorCompany: "local", authorModel: "qwen3" };

    expect(requiresLocalEndpoint(initialWorkspaceSetupDraft)).toBe(false);
    expect(requiresLocalEndpoint(local)).toBe(true);
    const html = renderForm(local, ready("local:qwen3", "openai:gpt-5", true));

    expect(html).toContain('aria-label="Local model server address"');
    expect(html).toContain("only a loopback address is accepted");
    expect(html).toContain("http://127.0.0.1:11434/v1");
  });

  it("stops asking a local server for models once the workspace names its own", () => {
    const listed: ModelDiscoveryState = {
      status: "ready",
      models: ["qwen3-coder-30b"],
      source: "live",
      truncated: false,
    };

    expect(modelInputMode("local", listed, false, false)).toBe("list");
    expect(modelInputMode("local", listed, true, false)).toBe("text");
    expect(modelDiscoveryNote("local", listed, true)).toContain(
      "Model discovery can only ask the default local server until this workspace exists",
    );
  });

  it("turns a refused local address into something correctable", () => {
    const local: WorkspaceSetupDraft = {
      ...named,
      criticCompany: "local",
      criticModel: "qwen3",
      localEndpoint: "http://10.0.0.4:11434/v1",
    };

    expect(
      workspaceSetupFailureMessage(
        new DesktopBridgeError("invalid-input", "The desktop command input is invalid."),
        local,
      ),
    ).toBe(
      "The desktop command input is invalid. Check the local model server address: it must be on this machine, such as http://127.0.0.1:11434/v1, and carry no username or password.",
    );
    expect(
      workspaceSetupFailureMessage(
        new DesktopBridgeError("operation-failed", "The desktop operation could not be completed."),
        local,
      ),
    ).toBe("The desktop operation could not be completed.");
    expect(
      workspaceSetupFailureMessage(
        new DesktopBridgeError("invalid-input", "The desktop command input is invalid."),
        named,
      ),
    ).toBe("The desktop command input is invalid.");
  });

  it("reports distinct lineages as a claim rather than as proof", () => {
    const html = renderForm(named, ready("anthropic:claude-sonnet-4-5", "openai:gpt-5", true));

    expect(html).toContain("trust-badge-independent");
    expect(html).toContain("lineages differ");
    expect(html).toContain(
      "Author and critic lineages differ, as claimed. A lineage is an operator label that nothing verifies; two labels can name the same weights.",
    );
    expect(html).toContain(
      "Claimed lineages: author anthropic:claude-sonnet-4-5; critic openai:gpt-5",
    );
    expect(html).not.toContain("Why is one lineage on both sides acceptable?");
    expect(html).not.toContain('type="submit" disabled=""');
  });

  it("blocks a shared lineage and unblocks it on a recorded rationale", () => {
    const shared = ready("anthropic:claude-sonnet-4-5", "anthropic:claude-sonnet-4-5", false);

    expect(sharedLineageBlocksCreation(shared, "")).toBe(true);
    expect(workspaceSetupBlocker(named, shared)).toBe(
      "Record why one lineage on both sides is acceptable before creating the workspace.",
    );
    const blocked = renderForm(named, shared);
    expect(blocked).toContain("trust-badge-shared");
    expect(blocked).not.toContain("trust-badge-independent");
    expect(blocked).toContain(
      "Author and critic would share one lineage, so this critique would not be independent. Choose a different model on one side, or record why one lineage on both sides is acceptable.",
    );
    expect(blocked).toContain("Why is one lineage on both sides acceptable? (required)");
    expect(blocked).toContain('aria-label="Independence override rationale"');
    expect(blocked).toContain('type="submit" disabled=""');

    const rationale = "One vendor is the only offline route; a person reads every critique.";
    const overridden: WorkspaceSetupDraft = {
      ...named,
      independenceOverrideRationale: rationale,
    };
    expect(sharedLineageBlocksCreation(shared, rationale)).toBe(false);
    expect(workspaceSetupBlocker(overridden, shared)).toBeNull();
    const proceeds = renderForm(overridden, shared);
    expect(proceeds).toContain(
      "Author and critic would share one lineage, so this critique would not be independent; the workspace will record your rationale.",
    );
    expect(proceeds).not.toContain("trust-badge-independent");
    expect(proceeds).not.toContain('type="submit" disabled=""');
    expect(workspaceModelSelection(overridden).independenceOverrideRationale).toBe(rationale);
  });

  it("never works the verdict out for itself", () => {
    // Two identical selections the domain reported as distinct, and two
    // different companies it reported as one lineage. A renderer that compared
    // anything itself would contradict the record in one of these.
    const identical: WorkspaceSetupDraft = {
      ...initialWorkspaceSetupDraft,
      criticCompany: "anthropic",
      authorModel: "claude-sonnet-4-5",
      criticModel: "claude-sonnet-4-5",
    };
    expect(renderForm(identical, ready("house-a", "house-b", true))).toContain(
      "Author and critic lineages differ, as claimed",
    );
    expect(
      renderForm(named, ready("openweights:llama-4-70b", "openweights:llama-4-70b", false)),
    ).toContain("would share one lineage");
  });

  it("does not claim anything when the pairing could not be checked", () => {
    const summary = independencePreviewSummary(
      { status: "unavailable", reason: "This host cannot check a pairing." },
      "",
    );

    expect(summary.tone).toBe("unrecorded");
    expect(summary.detail).toContain("This pairing could not be checked.");
    expect(summary.detail).toContain("the run itself refuses a shared lineage");
    expect(summary.lineages).toBeNull();
    expect(independencePreviewSummary({ status: "loading" }, "").mark).toBe("checking");

    const html = renderForm(named, { status: "unavailable", reason: "Nothing answered." });
    expect(html).toContain("trust-badge-unrecorded");
    // An unanswerable check must never stop a workspace being created.
    expect(html).not.toContain('type="submit" disabled=""');
  });

  it("requires a name and both models before creating anything", () => {
    expect(workspaceSetupBlocker({ ...named, name: "  " }, { status: "idle" })).toBe(
      "Name the workspace before creating it.",
    );
    expect(workspaceSetupBlocker(initialWorkspaceSetupDraft, { status: "idle" })).toBe(
      "Name an author model and a critic model before creating the workspace.",
    );
    expect(workspaceSetupBlocker(named, { status: "idle" })).toBeNull();
    expect(workspaceSetupBlocker({ ...named, maxRounds: 0 }, { status: "idle" })).toBe(
      "Choose a maximum round count between 1 and 20.",
    );
  });

  it("sends only what a person actually chose", () => {
    expect(workspaceCreateInput("  spaced-workspace  ", workspaceModelSelection(named))).toEqual({
      name: "spaced-workspace",
      mode: "real",
      authorCompany: "anthropic",
      authorModel: "claude-sonnet-4-5",
      criticCompany: "openai",
      criticModel: "gpt-5",
      maxRounds: 3,
    });
    expect(
      workspaceCreateInput(
        "local-workspace",
        workspaceModelSelection({
          ...named,
          authorCompany: "local",
          authorModel: " qwen3-coder-30b ",
          localEndpoint: " http://127.0.0.1:11434/v1 ",
          independenceOverrideRationale: "  ",
        }),
      ),
    ).toEqual({
      name: "local-workspace",
      mode: "real",
      authorCompany: "local",
      authorModel: "qwen3-coder-30b",
      criticCompany: "openai",
      criticModel: "gpt-5",
      localEndpoint: "http://127.0.0.1:11434/v1",
      maxRounds: 3,
    });
    expect(workspaceCreateInput("draft-loop-workspace")).toEqual({
      name: "draft-loop-workspace",
      mode: "real",
    });
  });

  it("explains and repairs an empty round opened past the configured limit", () => {
    const initial = createFixtureReviewState();
    const stranded = {
      ...initial,
      state: "awaiting-approval" as const,
      round: 3,
      reviewComplete: false,
      providerTransmissionPreflight: {
        ...initial.providerTransmissionPreflight,
        budget: { ...initial.providerTransmissionPreflight.budget, maxRounds: 2 },
      },
    };

    expect(roundLimitRecoveryRequired(stranded)).toBe(true);
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={stranded} onAction={() => undefined} />,
    );
    expect(html).toContain("Round limit recovery required");
    expect(html).toContain("Round 3 was opened after the configured maximum of 2");
    expect(html).toContain("Return to reviewed Round 2");
    expect(html).toMatch(/title="Request revision \(Alt\+R\)"[^>]*disabled=""/u);

    const recovered = reduceReviewState(stranded, { type: "recover-round-limit" });
    expect(recovered).toMatchObject({ round: 2, reviewComplete: true });
    expect(roundLimitRecoveryRequired(recovered)).toBe(false);
  });

  it("keeps the last fully reviewed artifact approvable when the round cap is reached", () => {
    const initial = createFixtureReviewState();
    const capped = {
      ...initial,
      state: "awaiting-approval" as const,
      round: 2,
      reviewComplete: true,
      findings: initial.findings.map((finding) => ({
        ...finding,
        decision: "rejected" as const,
      })),
      providerTransmissionPreflight: {
        ...initial.providerTransmissionPreflight,
        budget: { ...initial.providerTransmissionPreflight.budget, maxRounds: 2 },
      },
    };

    const html = renderToStaticMarkup(
      <ReviewWorkspace state={capped} onAction={() => undefined} />,
    );
    expect(html).toContain("Maximum of 2 review rounds reached");
    expect(html).toContain("This reviewed version remains available for approval");
    expect(html).toMatch(/title="Request revision \(Alt\+R\)"[^>]*disabled=""/u);
    expect(html).toMatch(/title="Approve artifact \(Alt\+A\)"/u);
  });
});
