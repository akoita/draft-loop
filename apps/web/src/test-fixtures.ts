import type { Brief } from "./brief-model.js";
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
