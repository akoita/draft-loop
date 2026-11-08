import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  type AgentExecution,
  type Critique,
  createOrchestrationEngine,
  InMemoryRunStore,
} from "./index.js";

const checksum = "a".repeat(64);
const text = "TypeScript experience and clear technical communication.";

const context = createContextSnapshot({
  id: "context-1",
  workspaceId: "workspace-1",
  createdAt: "2026-08-12T09:00:00.000Z",
  jobDescription: "Build reliable local-first software.",
  requirements: [
    { id: "requirement-1", text: "TypeScript experience", priority: "critical" },
    { id: "requirement-2", text: "Clear technical communication", priority: "high" },
  ],
  candidateInstructions: "Use concise, evidence-backed language.",
  language: "en",
  outputConstraints: { format: "markdown", maxWords: 800, requiredSections: ["Summary"] },
  truthfulnessPolicy: "Do not add unsupported claims.",
  readinessRubric: {
    relevance: 0.8,
    evidence: 0.8,
    accuracy: 0.8,
    differentiation: 0.8,
    clarity: 0.8,
    format: 0.8,
    credibility: 0.8,
  },
  evidenceManifest: [
    { id: "source-1", path: "/local/candidate/resume.md", mediaType: "text/markdown", checksum },
  ],
  modelConfiguration: {
    author: {
      company: "anthropic",
      modelId: "author-test",
      role: "author",
      promptTemplateVersion: "author-v1",
    },
    critic: {
      company: "openai",
      modelId: "critic-test",
      role: "critic",
      promptTemplateVersion: "critic-v1",
    },
    requireProviderDiversity: true,
  },
});

function artifact(createdAt: string): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt,
    language: "en",
    sections: [
      {
        id: "summary-1",
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [{ id: "summary-block-1", type: "paragraph", text, claimIds: ["claim-1"] }],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text,
        sectionId: "summary-1",
        blockId: "summary-block-1",
        substantive: true,
        status: "verified",
        evidence: [
          { sourcePath: "/local/candidate/resume.md", sourceChecksum: checksum, excerpt: text },
        ],
      },
    ],
    decisions: [],
  };
}

function execution<T>(output: T, provider: string, modelId: string): AgentExecution<T> {
  return {
    output,
    provider,
    modelId,
    providerRequestId: `${provider}-request-1`,
    outputChecksum: checksum,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    estimatedUsd: 0.01,
    completedAt: new Date().toISOString(),
  };
}

/** A provider call that waits until the test lets it answer, and says when it started. */
function gatedCall<T>(answer: () => AgentExecution<T>) {
  let release: () => void = () => undefined;
  let started: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const execute = async (): Promise<AgentExecution<T>> => {
    calls += 1;
    started();
    await gate;
    return answer();
  };
  return { execute, entered, release, calls: () => calls };
}

/** One store shared by a worker's engine and the API's engine, as in the hosted stack. */
function engines(
  critic: () => Promise<AgentExecution<Critique>>,
  author?: () => Promise<AgentExecution<DraftArtifact>>,
) {
  const store = new InMemoryRunStore();
  const options = {
    author: {
      execute:
        author ??
        (async () => execution(artifact("2026-08-12T10:00:00.000Z"), "anthropic", "author-test")),
    },
    critic: { execute: critic },
    store,
    contextResolver: async () => context,
    now: () => "2026-08-12T10:00:00.000Z",
  };
  return {
    store,
    worker: createOrchestrationEngine(options),
    api: createOrchestrationEngine(options),
  };
}

const request = {
  runId: "run-1",
  workspace: createWorkspace("workspace-1"),
  context,
  budget: { maxRounds: 3 },
};

describe("a person's stop during a running step", () => {
  it("keeps the run stopped when the critic answers after Stop", async () => {
    const critic = gatedCall(() => execution<Critique>({ findings: [] }, "openai", "critic-test"));
    const { store, worker, api } = engines(critic.execute);

    const running = worker.start(request);
    await critic.entered;
    expect((await api.stop("run-1")).state).toBe("stopped");
    critic.release();

    const answered = await running;
    expect(answered.state).toBe("stopped");
    expect((await store.loadRun("run-1"))?.state).toBe("stopped");
    expect(critic.calls()).toBe(1);
    // The finished call is still recorded, so a resume of another run never repeats it.
    expect(await store.findCompletedExecution("run-1", 1, "critic")).toBeDefined();
  });

  it("keeps the run stopped when the critic fails after Stop, so no retry is queued", async () => {
    const critic = gatedCall<Critique>(() => {
      throw Object.assign(new Error("rejected"), { code: "invalid-response", retryable: true });
    });
    const { store, worker, api } = engines(critic.execute);

    const running = worker.start(request);
    await critic.entered;
    await api.stop("run-1");
    critic.release();

    const answered = await running;
    expect(answered.state).toBe("stopped");
    expect(answered.lastError).toBeNull();
    expect((await store.loadRun("run-1"))?.state).toBe("stopped");
  });

  it("keeps a pause made during the step, and a later resume carries on", async () => {
    const critic = gatedCall(() => execution<Critique>({ findings: [] }, "openai", "critic-test"));
    const { store, worker, api } = engines(critic.execute);

    const running = worker.start(request);
    await critic.entered;
    expect((await api.pause("run-1")).state).toBe("paused");
    critic.release();
    expect((await running).state).toBe("paused");

    const resumed = await api.resume("run-1", { context });
    expect(resumed.state).toBe("awaiting-approval");
    expect((await store.loadRun("run-1"))?.state).toBe("awaiting-approval");
  });
});
