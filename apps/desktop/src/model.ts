import type { CredentialStatus } from "./bridge.js";

export type ReviewRunState =
  | "collecting"
  | "drafting"
  | "reviewing"
  | "revising"
  | "awaiting-approval"
  | "approved"
  | "exported"
  | "paused"
  | "provider-error"
  | "stopped"
  | "budget-exhausted";

export type FindingSeverity = "error" | "warning";
export type FindingCategory = "format" | "factuality" | "coverage" | "evidence" | "quality";
export type FindingDecision = "pending" | "accepted" | "rejected" | "deferred" | "overridden";
export type EvidenceStatus = "supports" | "needs-review" | "disputed";

export interface ReviewEvidence {
  readonly sourcePath: string;
  readonly locator: string;
  readonly excerpt: string;
  readonly status: EvidenceStatus;
}

export interface ReviewClaim {
  readonly id: string;
  readonly text: string;
  readonly status: "unverified" | "verified" | "disputed";
  readonly evidence: readonly ReviewEvidence[];
}

export interface ReviewBlock {
  readonly id: string;
  readonly type: "paragraph" | "bullet";
  readonly text: string;
  readonly claimIds: readonly string[];
}

export interface ReviewSection {
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly ReviewBlock[];
}

export interface ReviewArtifact {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly sections: readonly ReviewSection[];
  readonly claims: readonly ReviewClaim[];
}

export interface ReviewFinding {
  readonly id: string;
  readonly code: string;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly decision: FindingDecision;
  readonly agreement: "critic-only" | "author-and-critic" | "user-disputed";
  readonly rationale?: string;
  readonly claimId?: string;
  readonly sectionId?: string;
}

export interface ProviderExposureView {
  readonly author: { readonly company: string; readonly model: string };
  readonly critic: { readonly company: string; readonly model: string };
  readonly transmissionAllowed: boolean;
  readonly sensitiveData: boolean;
  readonly requestedRetention: "ephemeral-request" | "provider-default" | "not-allowed";
}

export type ProviderFailureAction = "retry" | "return-to-review" | "stop";

export interface ProviderFailureView {
  readonly code:
    | "authentication"
    | "permission"
    | "rate-limit"
    | "timeout"
    | "cancelled"
    | "transient"
    | "invalid-request"
    | "invalid-response"
    | "policy"
    | "unknown";
  readonly explanation: string;
  readonly provider: string;
  readonly model: string;
  readonly step: "author" | "critic" | "revision";
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retryAvailable: boolean;
  readonly availableActions: readonly ProviderFailureAction[];
  readonly diagnostics: readonly ProviderFailureDiagnostic[];
}

export interface ProviderFailureDiagnostic {
  readonly code: string;
  readonly path: string;
}

export interface ProviderTransmissionIdentity {
  readonly company: string;
  readonly model: string;
  readonly endpoint: string;
}

export interface ProviderTransmissionPolicy {
  readonly dataClass: "candidate-application-material" | "synthetic-demo-material";
  readonly transmissionScope: readonly [
    "job description and requirements",
    "evidence manifest",
    "selected retrieved evidence chunks",
    "current draft and structured findings",
  ];
  readonly excludedScope: readonly ["complete candidate corpus"];
  readonly author: ProviderTransmissionIdentity;
  readonly critic: ProviderTransmissionIdentity;
  readonly retentionPreference: "ephemeral-request" | "not-allowed";
  readonly budget: {
    readonly maxRounds: number;
    readonly maxCostUsd: number | null;
    readonly maxDurationMs: number | null;
  };
}

export interface ProviderTransmissionPreflight extends ProviderTransmissionPolicy {
  readonly required: boolean;
  readonly fingerprint: string;
  readonly acknowledged: boolean;
  readonly acknowledgedAt: string | null;
}

export interface ReviewEvaluation {
  readonly ready: boolean;
  readonly stopReason: string;
  readonly scores: Readonly<Record<string, number>>;
}

export interface WorkspaceReadiness {
  readonly fixtureMode: boolean;
  readonly jobDescriptionReady: boolean;
  readonly evidenceSourceCount: number;
  readonly ready: boolean;
  readonly nextSteps: readonly string[];
}

export interface ReviewEvent {
  readonly id: string;
  readonly label: string;
  readonly state: ReviewRunState;
  readonly createdAt: string;
}

export interface ReviewExecutionView {
  readonly status: "idle" | "running" | "interrupted";
  readonly step: "author" | "critic" | "revision" | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly attempt: number | null;
  readonly elapsedMs: number;
  readonly timeoutRemainingMs: number | null;
}

export interface DesktopReviewState {
  readonly workspaceId: string;
  readonly runId: string;
  readonly state: ReviewRunState;
  readonly execution: ReviewExecutionView;
  readonly round: number;
  readonly approval: "pending" | "approved" | "rejected";
  readonly totalCostUsd: number;
  readonly budgetUsd: number | null;
  readonly providerExposure: ProviderExposureView;
  readonly providerTransmissionPreflight: ProviderTransmissionPreflight;
  readonly providerFailure: ProviderFailureView | null;
  readonly previousArtifact: ReviewArtifact | null;
  readonly artifact: ReviewArtifact;
  readonly findings: readonly ReviewFinding[];
  readonly evaluation: ReviewEvaluation;
  readonly events: readonly ReviewEvent[];
  readonly exportPath: string | null;
  readonly setup: WorkspaceReadiness;
}

export type ReviewAction =
  | {
      readonly type: "finding-decision";
      readonly findingId: string;
      readonly decision: FindingDecision;
      readonly rationale?: string;
    }
  | { readonly type: "edit-block"; readonly blockId: string; readonly text: string }
  | { readonly type: "pause" }
  | { readonly type: "acknowledge-provider-transmission"; readonly fingerprint: string }
  | { readonly type: "start" }
  | { readonly type: "resume" }
  | { readonly type: "recover-to-review" }
  | { readonly type: "stop" }
  | { readonly type: "request-revision" }
  | { readonly type: "approve" }
  | { readonly type: "export" };

export interface DesktopReviewPort {
  readonly load: () => Promise<DesktopReviewState>;
  readonly dispatch: (
    state: DesktopReviewState,
    action: ReviewAction,
  ) => Promise<DesktopReviewState>;
  readonly openWorkspace?: () => Promise<DesktopReviewState>;
  readonly createWorkspace?: (name: string) => Promise<DesktopReviewState>;
  readonly createDemoWorkspace?: (name: string) => Promise<DesktopReviewState>;
  readonly selectFiles?: (target: "evidence" | "job-description") => Promise<DesktopReviewState>;
  readonly addUrl?: (
    target: "evidence" | "job-description",
    url: string,
  ) => Promise<DesktopReviewState>;
  readonly getCredentialStatus?: (provider: "anthropic" | "openai") => Promise<CredentialStatus>;
  readonly setCredential?: (
    provider: "anthropic" | "openai",
    apiKey: string,
  ) => Promise<CredentialStatus>;
  readonly removeCredential?: (provider: "anthropic" | "openai") => Promise<CredentialStatus>;
}

export type ReviewValidationStatus = "blocked" | "warnings" | "clear";

export interface ReviewFindingSummary {
  readonly unresolved: readonly ReviewFinding[];
  readonly blocking: readonly ReviewFinding[];
  readonly warnings: readonly ReviewFinding[];
  readonly status: ReviewValidationStatus;
}

function isUnresolved(finding: ReviewFinding): boolean {
  return finding.decision === "pending" || finding.decision === "deferred";
}

export function reviewFindingSummary(state: DesktopReviewState): ReviewFindingSummary {
  const unresolved = state.findings.filter(isUnresolved);
  const blocking = unresolved.filter((finding) => finding.severity === "error");
  const warnings = unresolved.filter((finding) => finding.severity === "warning");
  return {
    unresolved,
    blocking,
    warnings,
    status: blocking.length > 0 ? "blocked" : warnings.length > 0 ? "warnings" : "clear",
  };
}

export function unresolvedBlockingFindings(state: DesktopReviewState): readonly ReviewFinding[] {
  return reviewFindingSummary(state).blocking;
}

export function reduceReviewState(
  state: DesktopReviewState,
  action: ReviewAction,
): DesktopReviewState {
  switch (action.type) {
    case "finding-decision":
      if (action.decision === "overridden" && (action.rationale ?? "").trim() === "") return state;
      return {
        ...state,
        findings: state.findings.map((finding) =>
          finding.id === action.findingId
            ? {
                ...finding,
                decision: action.decision,
                ...(action.rationale === undefined ? {} : { rationale: action.rationale }),
              }
            : finding,
        ),
      };
    case "edit-block":
      return {
        ...state,
        artifact: {
          ...state.artifact,
          sections: state.artifact.sections.map((section) => ({
            ...section,
            blocks: section.blocks.map((block) =>
              block.id === action.blockId ? { ...block, text: action.text } : block,
            ),
          })),
        },
      };
    case "pause":
      return state.state === "approved" || state.state === "exported"
        ? state
        : { ...state, state: "paused", execution: { ...state.execution, status: "idle" } };
    case "acknowledge-provider-transmission":
      if (
        !state.providerTransmissionPreflight.required ||
        action.fingerprint !== state.providerTransmissionPreflight.fingerprint
      ) {
        return state;
      }
      return {
        ...state,
        providerExposure: { ...state.providerExposure, transmissionAllowed: true },
        providerTransmissionPreflight: {
          ...state.providerTransmissionPreflight,
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
        },
      };
    case "start":
      return state.state === "collecting" && state.setup.ready
        ? { ...state, state: "drafting", execution: { ...state.execution, status: "running" } }
        : state;
    case "resume":
      return state.state === "paused" ||
        (state.state === "provider-error" && state.providerFailure?.retryAvailable === true)
        ? {
            ...state,
            state: "reviewing",
            providerFailure: null,
            execution: { ...state.execution, status: "running" },
          }
        : state;
    case "recover-to-review":
      return state.state === "provider-error" &&
        state.providerFailure?.availableActions.includes("return-to-review")
        ? { ...state, state: "awaiting-approval", providerFailure: null }
        : state;
    case "stop":
      return state.state === "provider-error" || state.execution.status !== "idle"
        ? {
            ...state,
            state: "stopped",
            providerFailure: null,
            execution: { ...state.execution, status: "idle" },
          }
        : state;
    case "request-revision":
      return state.state === "awaiting-approval"
        ? { ...state, state: "revising", approval: "rejected", round: state.round + 1 }
        : state;
    case "approve":
      return state.state === "awaiting-approval" && unresolvedBlockingFindings(state).length === 0
        ? { ...state, state: "approved", approval: "approved" }
        : state;
    case "export":
      return state.state === "approved"
        ? { ...state, state: "exported", exportPath: `exports/${state.runId}.md` }
        : state;
  }
}

const evidence = (status: EvidenceStatus = "supports"): ReviewEvidence => ({
  sourcePath: "evidence/resume.md",
  locator: "lines 12-15",
  excerpt: "Synthetic evidence reference for the review fixture.",
  status,
});

export function createFixtureReviewState(): DesktopReviewState {
  const previousArtifact: ReviewArtifact = {
    id: "artifact-1",
    version: 1,
    createdAt: "2026-08-12T10:00:00.000Z",
    sections: [
      {
        id: "summary-1",
        title: "Summary",
        blocks: [
          {
            id: "summary-block-1",
            type: "paragraph",
            text: "TypeScript engineer with systems experience.",
            claimIds: ["claim-1"],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: "TypeScript engineer with systems experience.",
        status: "verified",
        evidence: [evidence()],
      },
    ],
  };
  const artifact: ReviewArtifact = {
    id: "artifact-2",
    version: 2,
    createdAt: "2026-08-12T10:05:00.000Z",
    sections: [
      {
        id: "summary-2",
        title: "Summary",
        blocks: [
          {
            id: "summary-block-2",
            type: "paragraph",
            text: "TypeScript systems engineer focused on reliable local-first products.",
            claimIds: ["claim-2"],
          },
        ],
      },
      {
        id: "experience-2",
        title: "Experience",
        blocks: [
          {
            id: "experience-block-2",
            type: "bullet",
            text: "Led a 40% improvement in deployment speed.",
            claimIds: ["claim-3"],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-2",
        text: "TypeScript systems engineer.",
        status: "verified",
        evidence: [evidence()],
      },
      {
        id: "claim-3",
        text: "Led a 40% improvement in deployment speed.",
        status: "unverified",
        evidence: [],
      },
    ],
  };
  return {
    workspaceId: "workspace-demo",
    runId: "run-demo-1",
    state: "paused",
    execution: {
      status: "idle",
      step: null,
      provider: null,
      model: null,
      attempt: null,
      elapsedMs: 0,
      timeoutRemainingMs: null,
    },
    round: 2,
    approval: "pending",
    totalCostUsd: 0.042,
    budgetUsd: 0.25,
    providerExposure: {
      author: { company: "Anthropic", model: "claude-sonnet-4-5" },
      critic: { company: "OpenAI", model: "gpt-5" },
      transmissionAllowed: false,
      sensitiveData: true,
      requestedRetention: "not-allowed",
    },
    providerTransmissionPreflight: {
      required: false,
      fingerprint: "fixture-local-only",
      acknowledged: true,
      acknowledgedAt: null,
      dataClass: "synthetic-demo-material",
      transmissionScope: [
        "job description and requirements",
        "evidence manifest",
        "selected retrieved evidence chunks",
        "current draft and structured findings",
      ],
      excludedScope: ["complete candidate corpus"],
      author: {
        company: "Anthropic",
        model: "claude-sonnet-4-5",
        endpoint: "local fixture (no network)",
      },
      critic: {
        company: "OpenAI",
        model: "gpt-5",
        endpoint: "local fixture (no network)",
      },
      retentionPreference: "not-allowed",
      budget: { maxRounds: 2, maxCostUsd: 0.25, maxDurationMs: null },
    },
    providerFailure: null,
    previousArtifact,
    artifact,
    findings: [
      {
        id: "finding-unsupported-claim",
        code: "unsupported-claim",
        category: "factuality",
        severity: "error",
        message: "A quantified claim has no linked evidence.",
        decision: "pending",
        agreement: "critic-only",
        claimId: "claim-3",
        sectionId: "experience-2",
      },
      {
        id: "finding-coverage",
        code: "uncovered-requirement",
        category: "coverage",
        severity: "warning",
        message: "One job requirement remains only partially covered.",
        decision: "pending",
        agreement: "author-and-critic",
      },
    ],
    evaluation: {
      ready: false,
      stopReason: "blocked-findings",
      scores: { relevance: 0.82, evidence: 0.5, accuracy: 0.65, credibility: 0.5 },
    },
    events: [
      {
        id: "event-1",
        label: "Author draft completed",
        state: "drafting",
        createdAt: "2026-08-12T10:01:00.000Z",
      },
      {
        id: "event-2",
        label: "Critic found an unsupported claim",
        state: "reviewing",
        createdAt: "2026-08-12T10:04:00.000Z",
      },
      {
        id: "event-3",
        label: "Run paused by user",
        state: "paused",
        createdAt: "2026-08-12T10:05:00.000Z",
      },
    ],
    exportPath: null,
    setup: {
      fixtureMode: true,
      jobDescriptionReady: true,
      evidenceSourceCount: 1,
      ready: true,
      nextSteps: [],
    },
  };
}

export function createFixtureReviewPort(): DesktopReviewPort {
  const credentials = new Map<"anthropic" | "openai", string>();
  return {
    load: async () => createFixtureReviewState(),
    dispatch: async (state, action) => reduceReviewState(state, action),
    getCredentialStatus: async (provider) => ({
      provider,
      configured: credentials.has(provider),
      source: credentials.has(provider) ? "app" : "none",
      protection: credentials.has(provider) ? "session-memory" : "none",
    }),
    setCredential: async (provider, apiKey) => {
      credentials.set(provider, apiKey);
      return { provider, configured: true, source: "app", protection: "session-memory" };
    },
    removeCredential: async (provider) => {
      credentials.delete(provider);
      return { provider, configured: false, source: "none", protection: "none" };
    },
  };
}
