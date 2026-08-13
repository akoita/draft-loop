export type ReviewRunState =
  | "collecting"
  | "drafting"
  | "reviewing"
  | "revising"
  | "awaiting-approval"
  | "approved"
  | "exported"
  | "paused"
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

export interface DesktopReviewState {
  readonly workspaceId: string;
  readonly runId: string;
  readonly state: ReviewRunState;
  readonly round: number;
  readonly approval: "pending" | "approved" | "rejected";
  readonly totalCostUsd: number;
  readonly budgetUsd: number | null;
  readonly providerExposure: ProviderExposureView;
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
  | { readonly type: "start" }
  | { readonly type: "resume" }
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
}

export function unresolvedBlockingFindings(state: DesktopReviewState): readonly ReviewFinding[] {
  return state.findings.filter(
    (finding) =>
      finding.severity === "error" &&
      (finding.decision === "pending" || finding.decision === "deferred"),
  );
}

export function reduceReviewState(
  state: DesktopReviewState,
  action: ReviewAction,
): DesktopReviewState {
  switch (action.type) {
    case "finding-decision":
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
        : { ...state, state: "paused" };
    case "start":
      return state.state === "collecting" && state.setup.ready
        ? { ...state, state: "drafting" }
        : state;
    case "resume":
      return state.state === "paused" ? { ...state, state: "reviewing" } : state;
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
    round: 2,
    approval: "pending",
    totalCostUsd: 0.042,
    budgetUsd: 0.25,
    providerExposure: {
      author: { company: "Anthropic", model: "claude-sonnet-4-5" },
      critic: { company: "OpenAI", model: "gpt-5" },
      transmissionAllowed: true,
      sensitiveData: true,
      requestedRetention: "ephemeral-request",
    },
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
  return {
    load: async () => createFixtureReviewState(),
    dispatch: async (state, action) => reduceReviewState(state, action),
  };
}
