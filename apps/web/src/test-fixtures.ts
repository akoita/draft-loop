import type { Brief } from "./brief-model.js";
import type { ConsentEntry, Consents } from "./consent-model.js";
import type { RunReview } from "./review-model.js";
import type { Run } from "./run-model.js";

/** Fictional records for the screen's tests; no real candidate or employer. */
export const syntheticBrief: Brief = {
  schemaVersion: 1,
  id: "brief-1",
  version: 2,
  priorVersion: 1,
  status: "draft",
  createdAt: "2026-10-23T00:00:00.000Z",
  reviewedAt: null,
  sources: [
    {
      id: "job-posting",
      classification: "job-posting",
      status: "available",
      provenance: {
        kind: "pasted-content",
        capturedAt: "2026-10-23T00:00:00.000Z",
        checksum: null,
      },
    },
  ],
  role: { value: "Platform Engineer", sourceIds: ["job-posting"] },
  employer: { value: "Example Ledger", sourceIds: ["job-posting"] },
  responsibilities: [
    { id: "resp-1", text: "Run the billing platform", sourceIds: ["job-posting"] },
  ],
  requirements: [
    { id: "req-1", text: "TypeScript services", priority: "critical", sourceIds: ["job-posting"] },
  ],
  priorities: [],
  candidateInstructions: {
    tone: null,
    applicationGoal: null,
    forbiddenLanguage: [],
    focusAreas: [],
  },
  issues: [],
};

export const syntheticRun: Run = {
  runId: "run-1",
  workspaceId: "owner",
  state: "reviewing",
  round: 1,
  currentStep: "critic",
  approval: "pending",
  totalCostUsd: 0.0421,
  routes: [
    { step: "author", route: "vertex-ai" },
    { step: "critic", route: "openai-api" },
  ],
  findingCount: 0,
  hasDraft: true,
  startedAt: "2026-10-23T01:00:00.000Z",
  updatedAt: "2026-10-23T01:01:00.000Z",
  lastError: null,
};

export const syntheticReview: RunReview = {
  run: { ...syntheticRun, state: "awaiting-approval", currentStep: null, findingCount: 2 },
  draft: {
    id: "draft-1",
    version: 1,
    createdAt: "2026-10-23T01:02:00.000Z",
    sections: [
      {
        id: "experience",
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            id: "block-1",
            type: "bullet",
            text: "Built TypeScript services for Example Ledger's billing platform.",
            edited: false,
            claimIds: ["claim-1"],
          },
        ],
      },
      {
        id: "skills",
        title: "Skills",
        kind: "skills",
        blocks: [
          {
            id: "block-2",
            type: "paragraph",
            text: "TypeScript, Postgres",
            edited: true,
            claimIds: [],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: "Built TypeScript services",
        status: "supported",
        substantive: true,
        evidence: [
          {
            sourcePath: "career.md",
            locator: "Experience, line 4",
            excerpt: "Built TypeScript services with deterministic testing.",
          },
        ],
      },
    ],
  },
  findings: [
    {
      id: "finding-1",
      code: "weak-impact",
      category: "quality",
      severity: "warning",
      message: "Say what the services changed for the billing team.",
      decision: "pending",
      claimId: "claim-1",
    },
    {
      id: "finding-2",
      code: "uncovered-requirement",
      category: "coverage",
      severity: "error",
      message: "No block covers the Postgres requirement.",
      decision: "accepted",
      requirement: { id: "req-2", text: "Postgres" },
    },
  ],
  independentReview: {
    authorLineage: "anthropic",
    criticLineage: "openai",
    lineagesDistinct: true,
    required: true,
  },
  readiness: {
    status: "not-ready",
    ready: false,
    stopReason: "blocking-findings",
    scores: [{ dimension: "coverage", score: 0.75, threshold: 0.8, meets: false }],
  },
  approvalCheck: { applicationReady: false, blockers: ["One error finding is not resolved."] },
  candidateDirection: null,
};

const storageGrant: ConsentEntry = {
  id: "consent-1",
  kind: "material-storage",
  action: "granted",
  basis: "contract",
  recordedBy: { kind: "member", memberId: "member-1" },
  providers: [],
  recordedAt: "2026-10-23T09:00:00.000Z",
};

const transmissionWithdrawal: ConsentEntry = {
  id: "consent-3",
  kind: "provider-transmission",
  action: "withdrawn",
  basis: "candidate-consent",
  recordedBy: { kind: "member", memberId: "member-1" },
  providers: [],
  recordedAt: "2026-10-23T11:00:00.000Z",
};

/** A transmission grant recorded with the owner token. */
export const syntheticTransmissionGrant: ConsentEntry = {
  id: "consent-2",
  kind: "provider-transmission",
  action: "granted",
  basis: "candidate-consent",
  recordedBy: { kind: "owner" },
  providers: ["anthropic", "openai"],
  note: "Agreed by email.",
  recordedAt: "2026-10-23T10:00:00.000Z",
};

/** A storage grant, then a transmission grant the candidate later withdrew. */
export const syntheticConsents: Consents = {
  current: { "material-storage": storageGrant, "provider-transmission": transmissionWithdrawal },
  history: [storageGrant, syntheticTransmissionGrant, transmissionWithdrawal],
};
