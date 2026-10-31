/**
 * The shared screens' review state, projected from a run on the host side (ADR 0011, D9): the
 * desktop's Electron host and the hosted API call the same projection, each with its own inputs,
 * so the screens read one shape whichever host serves them. It runs orchestrator code, so it never
 * goes into a browser bundle; the view models it fills come from `packages/ui`.
 */

import type {
  IndependentReviewRecord,
  ProviderAuthModeConfiguration,
  WorkspaceDescriptor,
} from "@draft-loop/application";
import {
  candidateEditedBlockIds,
  hasCompletedIndependentCritique,
  type RunSnapshot,
  retriesAutomatically,
  reviewFindingId,
} from "@draft-loop/orchestrator";
import { defaultUserSessionTimeoutMs } from "@draft-loop/providers";
import type { ApplicationRunRowView } from "@draft-loop/ui/application-run-list";
import { projectApprovalReadiness } from "@draft-loop/ui/approval-readiness";
import type { RunWritingPolicyProjection } from "@draft-loop/ui/bridge";
import { findingRequirement } from "@draft-loop/ui/finding-requirement";
import type {
  DesktopReviewState,
  FindingDecision,
  IndependentReviewView,
  ProviderFailureView,
  ProviderTransmissionPreflight,
  ReviewArtifact,
  ReviewClaim,
  ReviewEvent,
  ReviewExecutionView,
  ReviewFinding,
  ReviewSection,
  WorkspaceReadiness,
} from "@draft-loop/ui/model";
import type { ProviderRoutesView } from "@draft-loop/ui/provider-routes";
import { providerSessionModelFeedback } from "@draft-loop/ui/provider-session-model-feedback";
import type { RunAuthorInputView } from "@draft-loop/ui/run-author-input";
import type { RunEvidenceModeView } from "@draft-loop/ui/run-evidence-mode";

import { withAutopilotPause } from "./autopilot-pause.js";
import { executionCallLimitMs } from "./execution-call-limit.js";
import { groupRepeatedWarnings } from "./finding-groups.js";
import { readableFindingMessage } from "./finding-message.js";
import { reviewCoverage } from "./review-coverage.js";
import { usageLimitView } from "./usage-limit-view.js";

/** The person's review choices a host keeps beside a run: finding decisions and block edits. */
export interface ReviewDecisions {
  readonly decisions: Readonly<Record<string, FindingDecision>>;
  readonly rationales: Readonly<Record<string, string>>;
  readonly edits: Readonly<Record<string, string>>;
  readonly history: readonly {
    readonly findingId: string;
    readonly decision: FindingDecision;
    readonly createdAt: string;
  }[];
  /** The person's own name for the workspace; its folder's name when absent. */
  readonly workspaceName?: string;
}

const noDecisions: ReviewDecisions = { decisions: {}, rationales: {}, edits: {}, history: [] };

/** The last segment of a workspace's address, on either path separator. */
function folderName(root: string): string {
  return (
    root
      .split(/[\\/]/u)
      .filter((segment) => segment !== "")
      .at(-1) ?? "DraftLoop workspace"
  );
}

export function runState(snapshot: RunSnapshot): DesktopReviewState["state"] {
  if (
    snapshot.state === "awaiting-approval" &&
    snapshot.artifact !== null &&
    snapshot.lastError?.step === "critic" &&
    !hasCompletedIndependentCritique(snapshot)
  ) {
    return "provider-error";
  }
  if (snapshot.state === "provider-error") return "provider-error";
  if (snapshot.state === "stopped") return "stopped";
  if (snapshot.state === "collecting" || snapshot.state === "ingesting") return "drafting";
  return snapshot.state;
}

export const executingRunStates = new Set(["drafting", "reviewing", "revising"]);

export interface BackgroundRunStatus {
  readonly running: boolean;
  /** The safe reason the last background attempt for this run failed, if it did. */
  readonly failure?: string;
  /**
   * The host retries a failed step itself, as the hosted worker does, so the person never retries
   * it by hand (#1764). Absent on the desktop, whose person retries.
   */
  readonly retriedByHost?: boolean;
}

function reviewExecution(
  descriptor: WorkspaceDescriptor,
  snapshot: RunSnapshot,
  { running, failure }: BackgroundRunStatus,
  providerAuthModeConfiguration: ProviderAuthModeConfiguration,
): ReviewExecutionView {
  const step = snapshot.currentStep;
  const executing = executingRunStates.has(snapshot.state) && step !== null;
  const selection = step === "critic" ? descriptor.critic : descriptor.author;
  const attempt =
    step === null
      ? null
      : snapshot.executionHistory.filter(
          (execution) => execution.round === snapshot.round && execution.step === step,
        ).length + 1;
  const totalElapsedMs = Math.max(0, Date.now() - Date.parse(snapshot.startedAt));
  return {
    status: executing ? (running ? "running" : "interrupted") : "idle",
    step: executing ? step : null,
    provider: executing ? selection.company : null,
    model: executing ? selection.model : null,
    attempt: executing ? attempt : null,
    elapsedMs: executing ? Math.max(0, Date.now() - Date.parse(snapshot.updatedAt)) : 0,
    callLimitMs: executing
      ? executionCallLimitMs(
          selection.company,
          descriptor.fixtureMode,
          providerAuthModeConfiguration,
        )
      : null,
    timeoutRemainingMs:
      snapshot.budget.maxDurationMs === undefined
        ? null
        : Math.max(0, snapshot.budget.maxDurationMs - totalElapsedMs),
    ...(executing && !running && failure !== undefined ? { failure } : {}),
  };
}

export const providerFailureExplanations: Readonly<Record<ProviderFailureView["code"], string>> = {
  authentication: "The provider could not authenticate. Check the configured credential.",
  permission: "The provider denied permission for this request or model.",
  "rate-limit": "The provider rate limit was reached. Wait briefly before retrying.",
  "quota-exhausted":
    "The provider account's credit is used up, so no retry can pass. Add credits, then start a new run.",
  "usage-limit":
    "The subscription usage limit was reached. Resume the review after the limit resets.",
  timeout: "The provider did not respond before the request timed out.",
  cancelled: "The provider request was cancelled.",
  transient: "The provider is temporarily unavailable.",
  "invalid-request": "The provider rejected the request configuration.",
  "invalid-response": "The provider returned a response that could not be validated.",
  policy: "The provider transmission policy prevented this request.",
  unknown: "The provider request failed for an unknown reason.",
};

function providerFailure(
  snapshot: RunSnapshot,
  retriedByHost: boolean,
): ProviderFailureView | null {
  const legacyCriticRecovery =
    snapshot.state === "awaiting-approval" &&
    snapshot.artifact !== null &&
    snapshot.lastError?.step === "critic" &&
    !hasCompletedIndependentCritique(snapshot);
  if (
    (snapshot.state !== "provider-error" && !legacyCriticRecovery) ||
    snapshot.lastError === null
  ) {
    return null;
  }
  const supportedCodes = Object.keys(providerFailureExplanations) as ProviderFailureView["code"][];
  const code = supportedCodes.includes(snapshot.lastError.code as ProviderFailureView["code"])
    ? (snapshot.lastError.code as ProviderFailureView["code"])
    : "unknown";
  const retryable =
    snapshot.lastError.retryable && snapshot.lastError.attempt < snapshot.lastError.maxAttempts;
  const retryAvailable = retryable && !retriedByHost;
  const automaticRetry = retriedByHost && retryable && retriesAutomatically(snapshot);
  const retryNotBefore =
    snapshot.lastError.retryNotBefore !== undefined &&
    Number.isFinite(Date.parse(snapshot.lastError.retryNotBefore))
      ? new Date(snapshot.lastError.retryNotBefore).toISOString()
      : null;
  return {
    code,
    explanation: providerSessionModelFeedback({
      code,
      provider: snapshot.lastError.provider,
      diagnostics: snapshot.lastError.diagnostics ?? [],
      fallbackExplanation: providerFailureExplanations[code],
    }),
    provider: snapshot.lastError.provider,
    model: snapshot.lastError.modelId,
    step: snapshot.lastError.step,
    // A plan review fails the author step on the critic's call, so the call names its own role.
    role:
      snapshot.lastError.failedCall?.role ??
      (snapshot.lastError.step === "critic" ? "critic" : "author"),
    attempt: snapshot.lastError.attempt,
    maxAttempts: snapshot.lastError.maxAttempts,
    retryAvailable,
    automaticRetry,
    retryNotBefore,
    availableActions: [...(retryAvailable ? (["retry"] as const) : []), "stop" as const],
    diagnostics: snapshot.lastError.diagnostics ?? [],
  };
}

export function reviewArtifact(
  artifact: RunSnapshot["artifact"],
  overrides: ReviewDecisions,
): ReviewArtifact {
  if (artifact === null) throw new Error("The run has no draft artifact yet.");
  const approvedEdits = candidateEditedBlockIds(artifact);
  const sections: readonly ReviewSection[] = artifact.sections.map((section) => ({
    id: section.id,
    title: section.title,
    kind: section.kind,
    blocks: section.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      text: overrides.edits[block.id] ?? block.text,
      claimIds: [...block.claimIds],
      ...(overrides.edits[block.id] !== undefined || approvedEdits.has(block.id)
        ? { edited: true }
        : {}),
    })),
  }));
  const claims: readonly ReviewClaim[] = artifact.claims.map((claim) => ({
    id: claim.id,
    text: claim.text,
    status: claim.status,
    evidence: claim.evidence.map((evidence) => ({
      sourcePath: evidence.sourcePath,
      locator: "linked claim evidence",
      excerpt: evidence.excerpt,
      status: "supports",
    })),
  }));
  return {
    id: artifact.id,
    version: artifact.version,
    createdAt: artifact.createdAt,
    sections,
    claims,
  };
}

function previousArtifact(snapshot: RunSnapshot, current: ReviewArtifact): ReviewArtifact | null {
  const candidates = snapshot.executionHistory
    .filter(
      (execution) =>
        (execution.step === "author" || execution.step === "revision") &&
        execution.output !== undefined &&
        typeof execution.output === "object" &&
        execution.output !== null &&
        "version" in execution.output,
    )
    .map((execution) => execution.output as RunSnapshot["artifact"])
    .filter((artifact): artifact is NonNullable<RunSnapshot["artifact"]> => artifact !== null)
    .filter((artifact) => artifact.version < current.version)
    .sort((left, right) => right.version - left.version);
  return candidates[0] === undefined ? null : reviewArtifact(candidates[0], noDecisions);
}

function findingId(snapshot: RunSnapshot, index: number, code: string): string {
  // Shared with the orchestrator, which matches the candidate's decisions to findings by this id.
  return reviewFindingId(snapshot, snapshot.artifact, index, code);
}

export function reviewFinding(
  snapshot: RunSnapshot,
  index: number,
  overrides: ReviewDecisions,
  requirementTexts?: ReadonlyMap<string, string>,
): ReviewFinding {
  const finding = snapshot.findings[index];
  if (finding === undefined) throw new Error("The run finding is missing.");
  const id = findingId(snapshot, index, finding.code);
  const requirement = findingRequirement(finding.requirementId, requirementTexts);
  return {
    id,
    code: finding.code,
    category: finding.category ?? "quality",
    severity: finding.severity,
    message: readableFindingMessage(finding.message, {
      ...(requirementTexts === undefined ? {} : { requirements: requirementTexts }),
      claims: new Map((snapshot.artifact?.claims ?? []).map(({ id, text }) => [id, text])),
    }),
    decision: overrides.decisions[id] ?? "pending",
    agreement: "critic-only",
    ...(overrides.rationales[id] === undefined ? {} : { rationale: overrides.rationales[id] }),
    ...(finding.claimId === undefined ? {} : { claimId: finding.claimId }),
    ...(finding.sectionId === undefined ? {} : { sectionId: finding.sectionId }),
    ...(requirement === undefined ? {} : { requirement }),
  };
}

function reviewEvents(
  snapshot: RunSnapshot,
  overrides: ReviewDecisions,
  preflight: ProviderTransmissionPreflight,
): readonly ReviewEvent[] {
  const events: ReviewEvent[] = [
    {
      id: `${snapshot.runId}:created`,
      label: "Run created",
      state: "drafting",
      createdAt: snapshot.startedAt,
    },
  ];
  for (const execution of snapshot.executionHistory) {
    const succeeded = execution.status === "completed";
    events.push({
      id: execution.id,
      label: `${execution.step} execution ${succeeded ? "completed" : "failed"}`,
      state: succeeded
        ? execution.step === "author"
          ? "drafting"
          : execution.step === "critic"
            ? "reviewing"
            : "revising"
        : "provider-error",
      createdAt: execution.completedAt,
    });
  }
  for (const [index, decision] of overrides.history.entries()) {
    events.push({
      id: `${snapshot.runId}:decision:${index}:${decision.findingId}`,
      label: `Finding decision recorded: ${decision.decision}`,
      state: "awaiting-approval",
      createdAt: decision.createdAt,
    });
  }
  if (preflight.acknowledgedAt !== null) {
    events.push({
      id: `${snapshot.runId}:provider-transmission:${preflight.fingerprint}`,
      label: "Provider transmission policy acknowledged",
      state: "collecting",
      createdAt: preflight.acknowledgedAt,
    });
  }
  events.push({
    id: `${snapshot.runId}:updated:${snapshot.updatedAt}`,
    label: `Run ${snapshot.state.replaceAll("-", " ")}`,
    state: runState(snapshot),
    createdAt: snapshot.updatedAt,
  });
  return events;
}

/**
 * The recorded independence claim, in the renderer's vocabulary.
 *
 * The absent rationale becomes an explicit `null` rather than a missing key so
 * that "no override was needed" survives the bridge as a value a reader can
 * see, instead of as the absence of one.
 */
export function independentReviewView(
  record: IndependentReviewRecord | undefined,
): IndependentReviewView | null {
  if (record === undefined) return null;
  return {
    authorLineage: record.authorLineage,
    criticLineage: record.criticLineage,
    lineagesDistinct: record.lineagesDistinct,
    required: record.required,
    overrideRationale: record.overrideRationale ?? null,
  };
}

export function reviewState(
  descriptor: WorkspaceDescriptor,
  snapshot: RunSnapshot,
  independentReview: IndependentReviewView | null,
  overrides: ReviewDecisions,
  exportPath: string | null,
  setup: WorkspaceReadiness,
  preflight: ProviderTransmissionPreflight,
  background: BackgroundRunStatus = { running: false },
  writingPolicy?: RunWritingPolicyProjection,
  requirementTexts?: ReadonlyMap<string, string>,
  evidenceMode: RunEvidenceModeView | null = null,
  authorInput: RunAuthorInputView | null = null,
  applicationRuns: readonly ApplicationRunRowView[] | null = null,
  providerAuthModeConfiguration: ProviderAuthModeConfiguration = {
    anthropic: "api-key",
    openai: "api-key",
  },
): DesktopReviewState {
  const artifact =
    snapshot.artifact === null
      ? {
          id: "artifact-unavailable",
          version: 0,
          createdAt: snapshot.updatedAt,
          sections: [],
          claims: [],
        }
      : reviewArtifact(snapshot.artifact, overrides);
  const evaluation = snapshot.latestEvaluation;
  return {
    workspaceId: descriptor.id,
    workspaceName: overrides.workspaceName ?? folderName(descriptor.root),
    runId: snapshot.runId,
    state: runState(snapshot),
    execution: reviewExecution(descriptor, snapshot, background, providerAuthModeConfiguration),
    round: snapshot.round,
    approval: snapshot.approval,
    approvalReadiness: withAutopilotPause(
      projectApprovalReadiness(snapshot.readinessDecision, artifact, snapshot.approvedArtifact),
      snapshot,
    ),
    reviewComplete: hasCompletedIndependentCritique(snapshot),
    totalCostUsd: snapshot.totalCostUsd,
    unpricedCallCount: snapshot.executionHistory.filter(({ estimatedUsd }) => estimatedUsd === null)
      .length,
    budgetUsd: descriptor.maxCostUsd ?? null,
    providerExposure: {
      author: descriptor.author,
      critic: descriptor.critic,
      transmissionAllowed: preflight.required && preflight.acknowledged,
      sensitiveData: true,
      requestedRetention: preflight.retentionPreference,
      independentReview,
    },
    providerTransmissionPreflight: preflight,
    providerRoutes: providerRoutesView(providerAuthModeConfiguration),
    providerFailure: providerFailure(snapshot, background.retriedByHost === true),
    usageLimit: usageLimitView(snapshot),
    previousArtifact: previousArtifact(snapshot, artifact),
    artifact,
    findings: groupRepeatedWarnings(
      snapshot.findings.map((_finding, index) =>
        reviewFinding(snapshot, index, overrides, requirementTexts),
      ),
      new Map((snapshot.artifact?.sections ?? []).map(({ id, title }) => [id, title])),
      overrides,
    ),
    evaluation: {
      ready: evaluation?.ready ?? false,
      stopReason: evaluation?.stopReason ?? "continue",
      scores: evaluation?.scoreVector ?? {},
    },
    events: reviewEvents(snapshot, overrides, preflight),
    exportPath,
    coverage: reviewCoverage(snapshot, requirementTexts),
    ...(writingPolicy === undefined ? {} : { writingPolicy }),
    ...(evidenceMode === null ? {} : { evidenceMode }),
    ...(authorInput === null ? {} : { authorInput }),
    ...(applicationRuns === null ? {} : { applicationRuns }),
    setup,
  };
}

/** How a new run reaches each company with a choice of route, for the start confirmation. */
function providerRoutesView(configuration: ProviderAuthModeConfiguration): ProviderRoutesView {
  return {
    anthropic: configuration.anthropic,
    openai: configuration.openai,
    sessionCallLimitMs: defaultUserSessionTimeoutMs,
  };
}

export function emptyReviewState(
  descriptor: WorkspaceDescriptor,
  setup: WorkspaceReadiness,
  preflight: ProviderTransmissionPreflight,
  overrides: ReviewDecisions,
  providerAuthModeConfiguration: ProviderAuthModeConfiguration = {
    anthropic: "api-key",
    openai: "api-key",
  },
): DesktopReviewState {
  return {
    workspaceId: descriptor.id,
    workspaceName: overrides.workspaceName ?? folderName(descriptor.root),
    runId: "pending",
    state: "collecting",
    execution: {
      status: "idle",
      step: null,
      provider: null,
      model: null,
      attempt: null,
      elapsedMs: 0,
      callLimitMs: null,
      timeoutRemainingMs: null,
    },
    round: 0,
    approval: "pending",
    reviewComplete: false,
    totalCostUsd: 0,
    budgetUsd: descriptor.maxCostUsd ?? null,
    providerExposure: {
      author: descriptor.author,
      critic: descriptor.critic,
      transmissionAllowed: preflight.required && preflight.acknowledged,
      sensitiveData: setup.evidenceSourceCount > 0,
      requestedRetention: preflight.retentionPreference,
      /** No run means no recorded claim; nothing here can be invented. */
      independentReview: null,
    },
    providerTransmissionPreflight: preflight,
    providerRoutes: providerRoutesView(providerAuthModeConfiguration),
    providerFailure: null,
    previousArtifact: null,
    artifact: {
      id: "artifact-pending",
      version: 0,
      createdAt: new Date().toISOString(),
      sections: [],
      claims: [],
    },
    findings: [],
    evaluation: {
      ready: setup.ready,
      stopReason: setup.ready ? "ready" : "collecting-inputs",
      scores: {},
    },
    events:
      preflight.acknowledgedAt === null
        ? []
        : [
            {
              id: `pending:provider-transmission:${preflight.fingerprint}`,
              label: "Provider transmission policy acknowledged",
              state: "collecting",
              createdAt: preflight.acknowledgedAt,
            },
          ],
    exportPath: null,
    setup,
  };
}
