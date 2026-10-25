import type {
  ApplicationService,
  ApplicationView,
  HostedKnowledgeIntake,
  RunReview,
  WorkspaceDescriptor,
} from "@draft-loop/application";
import { type RunSnapshot, reviewFindingId } from "@draft-loop/orchestrator";
import { createCapabilityPort } from "@draft-loop/ui/bridge";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-10-25T00:00:00.000Z";
const root = "/tenants/owner/workspaces/workspace-1";
const url = "/v1/workspaces/workspace-1/review-state";
const jobText =
  "Platform Engineer at Example Ledger\n\nRequirements:\n- Build TypeScript services\n- Write deterministic tests\n";

const descriptor = {
  // The driver's own id differs from the one in the path, as on the hosted service.
  id: "workspace-0b5c",
  root,
  language: "en",
  requiredSections: ["summary", "experience"],
  maxRounds: 3,
  maxCostUsd: 3,
  author: { company: "anthropic", model: "claude-sonnet-5-5" },
  critic: { company: "openai", model: "gpt-6.1-sol" },
  fixtureMode: true,
  candidateKnowledgeSelection: [{ storeId: "store-1", knowledgeBaseId: "kb-1" }],
} as unknown as WorkspaceDescriptor;

const application = {
  schemaVersion: 1,
  id: "app-ledger",
  name: "Example Ledger platform engineer",
  jobSource: { kind: "stored-text", text: jobText },
  createdAt: at,
  updatedAt: at,
  status: "drafting",
  isDefault: false,
  briefs: [{ briefId: "brief-1", latestVersion: 2, status: "reviewed", createdAt: at }],
  runs: [],
  exports: [],
  archivedAt: null,
  nameChosen: true,
  suggestedName: null,
  modelProfiles: null,
  chosenRun: null,
} as unknown as ApplicationView;

/** A fictional candidate's draft, awaiting approval after one round. */
const artifact = {
  id: "artifact-1",
  version: 1,
  createdAt: at,
  sections: [
    {
      id: "experience",
      title: "Experience",
      kind: "experience",
      blocks: [
        {
          id: "block-1",
          type: "bullet",
          text: "Built TypeScript services for Example Ledger.",
          claimIds: ["claim-1"],
        },
      ],
    },
  ],
  claims: [
    {
      id: "claim-1",
      text: "Built TypeScript services for Example Ledger.",
      status: "supported",
      substantive: true,
      evidence: [{ sourcePath: "career.md", excerpt: "Built TypeScript services." }],
    },
  ],
};

const snapshot = {
  schemaVersion: 1,
  runId: "run-1",
  workspaceId: "workspace-1",
  contextSnapshotId: "context-1",
  state: "awaiting-approval",
  round: 1,
  currentStep: null,
  artifact,
  approvedArtifact: null,
  findings: [
    {
      code: "unsupported-claim",
      category: "grounding",
      severity: "warning",
      message: "The claim needs a dated source.",
      claimId: "claim-1",
      requirementId: "typescript-services",
    },
  ],
  latestEvaluation: null,
  readinessDecision: null,
  totalCostUsd: 0,
  budget: { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 },
  executionHistory: [],
  approval: "pending",
  startedAt: at,
  updatedAt: at,
  lastError: null,
} as unknown as RunSnapshot;

const findingId = reviewFindingId(snapshot, artifact, 0, "unsupported-claim");

const review = {
  snapshot,
  draft: {
    ...artifact,
    sections: [
      {
        ...artifact.sections[0],
        blocks: [
          {
            id: "block-1",
            type: "bullet",
            text: "Built and tested TypeScript services for Example Ledger.",
            edited: true,
            claimIds: ["claim-1"],
          },
        ],
      },
    ],
  },
  findings: [
    {
      id: findingId,
      code: "unsupported-claim",
      category: "grounding",
      severity: "warning",
      message: "The claim needs a dated source.",
      decision: "accepted",
    },
  ],
  independentReview: {
    authorLineage: "anthropic",
    criticLineage: "openai",
    lineagesDistinct: true,
    required: true,
  },
  readiness: null,
  approvalCheck: null,
  candidateDirection: null,
} as unknown as RunReview;

/** Only the methods a test scripts exist; calling any other one fails the test. */
function scriptedService(methods: Partial<ApplicationService>): ApplicationService {
  return new Proxy(methods, {
    get: (target, name) =>
      (target as Record<string | symbol, unknown>)[name] ??
      (() => {
        throw new Error(`unexpected service call: ${String(name)}`);
      }),
  }) as ApplicationService;
}

/** One knowledge base holding two sources of a fictional candidate's career. */
const knowledgeIntake = {
  listSources: vi.fn(async () => [{}, {}]),
} as unknown as HostedKnowledgeIntake;

const baseMethods: Partial<ApplicationService> = {
  readWorkspace: async () => descriptor,
  getWritingPolicy: async () => undefined,
  listWritingPolicyVersions: async () => [],
  listApplications: async () => [application],
};

/** What the shared screens make of a response: the port validates every field it reads. */
async function throughPort(body: unknown) {
  const port = createCapabilityPort({
    capabilities: ["review.load"],
    invoke: async () => ({ ok: true, value: body }),
  });
  return port.execute({ type: "review.load", input: {} });
}

let app: FastifyInstance;

async function build(methods: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: scriptedService({ ...baseMethods, ...methods }),
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      knowledgeIntake,
    },
  });
}

afterEach(async () => {
  await app.close();
});

describe("review state", () => {
  it("opens an application without a run on its start state, ready from its job and sources", async () => {
    const getApplication = vi.fn(async () => application);
    await build({ getApplication });

    const response = await app.inject({
      method: "GET",
      url: `${url}?applicationId=app-ledger`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(getApplication).toHaveBeenCalledWith({ root, applicationId: "app-ledger" });
    const state = response.json();
    expect(state).toMatchObject({
      workspaceId: "workspace-1",
      workspaceName: "workspace-1",
      runId: "pending",
      state: "collecting",
      setup: {
        fixtureMode: true,
        jobDescriptionReady: true,
        evidenceSourceCount: 2,
        writingPolicyStatus: "none",
        reviewedOpportunity: { briefId: "brief-1", version: 2 },
        ready: true,
        nextSteps: [],
      },
      providerTransmissionPreflight: {
        required: false,
        acknowledged: true,
        author: { company: "anthropic", endpoint: "scripted fixture (no provider call)" },
      },
    });
    // The tenant's reference for the workspace never reaches the screen.
    expect(response.body).not.toContain("/tenants/");
    await expect(throughPort(state)).resolves.toMatchObject({
      ok: true,
      value: { runId: "pending" },
    });
  });

  it("names what is missing before a workspace without a job or sources can start", async () => {
    const empty = { ...application, jobSource: { kind: "local-file", path: "job.md" }, briefs: [] };
    await build({
      readWorkspace: async () => ({ ...descriptor, candidateKnowledgeSelection: [] }),
      listApplications: async () => [empty as unknown as ApplicationView],
      status: async () => undefined,
    });

    const response = await app.inject({ method: "GET", url, headers: { authorization } });

    expect(response.statusCode).toBe(200);
    expect(response.json().setup).toMatchObject({
      ready: false,
      nextSteps: [
        "Add a target job description.",
        "Add at least one source to the selected knowledge base.",
      ],
    });
  });

  it("shows an application's newest run with the person's decisions and edits", async () => {
    const withRun = {
      ...application,
      runs: [{ id: "run-1", state: "awaiting-approval", startedAt: at, updatedAt: at }],
    };
    const status = vi.fn(async () => snapshot);
    const readRunReview = vi.fn(async () => review);
    await build({
      getApplication: async () => withRun as unknown as ApplicationView,
      status,
      readRunReview,
      readRunRequirements: async () => [
        { id: "typescript-services", text: "Build TypeScript services" },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: `${url}?applicationId=app-ledger`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(status).toHaveBeenCalledWith({ root, runId: "run-1" });
    const state = response.json();
    expect(state).toMatchObject({
      runId: "run-1",
      state: "awaiting-approval",
      execution: { status: "idle" },
      artifact: {
        sections: [
          { blocks: [{ text: "Built and tested TypeScript services for Example Ledger." }] },
        ],
      },
      findings: [
        {
          id: findingId,
          decision: "accepted",
          requirement: { id: "typescript-services", text: "Build TypeScript services" },
        },
      ],
      providerExposure: { independentReview: { lineagesDistinct: true } },
    });
    await expect(throughPort(state)).resolves.toMatchObject({
      ok: true,
      value: { runId: "run-1" },
    });
  });

  it("refuses a run that is not the application's, and an unknown application", async () => {
    await build({
      getApplication: async ({ applicationId }) =>
        applicationId === "app-ledger" ? application : undefined,
    });

    const foreignRun = await app.inject({
      method: "GET",
      url: `${url}?applicationId=app-ledger&runId=run-elsewhere`,
      headers: { authorization },
    });
    const unknown = await app.inject({
      method: "GET",
      url: `${url}?applicationId=app-missing`,
      headers: { authorization },
    });

    expect(foreignRun.statusCode).toBe(404);
    expect(foreignRun.json()).toMatchObject({ error: { code: "not_found" } });
    expect(unknown.statusCode).toBe(404);
  });

  it("refuses an unknown run named without an application", async () => {
    await build({ status: async () => undefined });

    const response = await app.inject({
      method: "GET",
      url: `${url}?runId=run-missing`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
  });
});
