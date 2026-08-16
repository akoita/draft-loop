import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createFixtureReviewState,
  reduceReviewState,
  reviewFindingSummary,
  unresolvedBlockingFindings,
} from "./model.js";
import {
  canExportReview,
  filterFindingQueue,
  findingQueueCounts,
  initialFindingQueueState,
  isOverrideEditorVisible,
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
        retrievalStatus: "not-indexed" as const,
        indexedEvidenceChunkCount: 0,
        selectedEvidenceChunkCount: 0,
        selectedEvidenceSourceCount: 0,
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
    expect(html).toContain("0 of 2 decided · 2 need action");
    expect(html).toContain("Needs action");
    expect(html).toContain("Blocking");
    expect(html).toContain("Warnings");
    expect(html).toContain("Resolved");
    expect(html.match(/aria-expanded="true"/gu)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/gu)).toHaveLength(1);
    expect(html).not.toContain("Override rationale (required)");
  });

  it("keeps fully resolved findings compact by default", () => {
    const initial = createFixtureReviewState();
    const resolved = {
      ...initial,
      findings: initial.findings.map((finding, index) => ({
        ...finding,
        decision: index === 0 ? ("accepted" as const) : ("rejected" as const),
      })),
    };

    expect(initialFindingQueueState(resolved.findings)).toEqual({
      filter: "resolved",
      expandedFindingId: null,
    });
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={resolved} onAction={() => undefined} />,
    );
    expect(html).toContain("2 of 2 decided · all findings decided");
    expect(html.match(/aria-expanded="false"/gu)).toHaveLength(2);
    expect(html).not.toContain("Linked claim:");
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
