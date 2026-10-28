import type { ApiSchemas } from "./api-client.js";
import type { Brief } from "./brief-model.js";
import type { ConsentEntry, Consents } from "./consent-model.js";
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

/** A run error's rejection fields when DraftLoop rejected no output. */
export const noRejection = { failureStage: null, diagnostics: [], diagnosticCounts: [] } as const;

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

export const syntheticCredits: ApiSchemas["MemberCredits"] = {
  organisationId: "org-alder",
  planId: "pro",
  entitlements: {
    modelTiers: ["economy", "standard"],
    runsPerDay: 10,
    concurrentRuns: 2,
    seats: 3,
    candidateRecords: 20,
  },
  periodStart: "2026-10-24T00:00:00.000Z",
  periodEnd: "2026-11-24T00:00:00.000Z",
  unlimited: false,
  allowance: 50,
  used: 12,
  reserved: 0,
  grantsRemaining: 0,
  remaining: 38,
  warning: false,
};

export const syntheticEstimate: ApiSchemas["RunEstimate"] = {
  credits: 2,
  estimateVersion: 1,
  basis: { base: 1, premium: false, highReasoning: false, roundBlocks: 1 },
  maxRounds: 4,
  authorTier: "standard",
  criticTier: "standard",
  plan: { allowed: true, code: null },
  balance: { unlimited: false, remaining: 38, sufficient: true },
};
