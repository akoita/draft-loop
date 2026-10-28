import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  applyCandidateEdits,
  CANDIDATE_EDIT_RATIONALE,
  CANDIDATE_EDIT_VERSION_SUFFIX,
  candidateEditedBlockIds,
} from "./candidate-edits.js";
import { reviewFindingId } from "./consensus-stop.js";
import {
  type AgentExecution,
  assertExactApprovedArtifact,
  type Critique,
  createOrchestrationEngine,
  InMemoryRunStore,
} from "./index.js";
import { RunTransitionError } from "./run-transition-error.js";

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

function artifact(createdAt: string, header?: string): DraftArtifact {
  const headerSection =
    header === undefined
      ? []
      : [
          {
            id: "header-1",
            title: "Header",
            kind: "header" as const,
            order: 0,
            blocks: [
              { id: "header-block-1", type: "paragraph" as const, text: header, claimIds: [] },
            ],
          },
        ];
  return {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt,
    language: "en",
    sections: [
      ...headerSection,
      {
        id: "summary-1",
        title: "Summary",
        kind: "summary",
        order: 1,
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

function engine(store: InMemoryRunStore, header?: string) {
  return createOrchestrationEngine({
    author: {
      execute: async () =>
        execution(artifact(new Date().toISOString(), header), "anthropic", "author-test"),
    },
    critic: {
      execute: async () => execution<Critique>({ findings: [] }, "openai", "critic-test"),
    },
    store,
    contextResolver: async () => context,
  });
}

const editedAt = "2026-08-12T11:00:00.000Z";
const edit = {
  blockId: "summary-block-1",
  text: "TypeScript experience and clear written communication.",
};

async function drafted() {
  const store = new InMemoryRunStore();
  const snapshot = await engine(store).start({
    runId: "run-1",
    workspace: createWorkspace("workspace-1"),
    context,
    budget: { maxRounds: 3 },
  });
  expect(snapshot.state).toBe("awaiting-approval");
  return { store, snapshot };
}

describe("applyCandidateEdits", () => {
  const reviewed = artifact("2026-08-12T10:00:00.000Z");

  it("makes the next version with the edited text, an edit decision and unverified claims", () => {
    const edited = applyCandidateEdits(reviewed, [edit], editedAt);

    expect(edited).toMatchObject({
      id: `artifact-1${CANDIDATE_EDIT_VERSION_SUFFIX}`,
      version: 2,
      parentVersionId: "artifact-1",
      createdAt: editedAt,
    });
    expect(edited?.sections[0]?.blocks[0]?.text).toBe(edit.text);
    expect(edited?.claims[0]).toMatchObject({
      text: edit.text,
      status: "unverified",
      evidence: reviewed.claims[0]?.evidence,
    });
    expect(edited?.decisions).toEqual([
      {
        id: "decision-candidate-edit-summary-block-1",
        type: "edit",
        rationale: CANDIDATE_EDIT_RATIONALE,
        createdAt: editedAt,
      },
    ]);
    expect(reviewed.sections[0]?.blocks[0]?.text).toBe(text);
  });

  it("names the blocks the edits set, and none in a version without edits", () => {
    const edited = applyCandidateEdits(reviewed, [edit], editedAt);
    if (edited === null) throw new Error("Expected an edited version.");
    expect([...candidateEditedBlockIds(edited)]).toEqual(["summary-block-1"]);
    expect(candidateEditedBlockIds(reviewed).size).toBe(0);
  });

  it("keeps the reviewed version when no edit changes any text", () => {
    expect(applyCandidateEdits(reviewed, [], editedAt)).toBeNull();
    expect(
      applyCandidateEdits(reviewed, [{ blockId: edit.blockId, text: ` ${text} ` }], editedAt),
    ).toBeNull();
  });

  it("takes the latest edit of a block", () => {
    const edited = applyCandidateEdits(
      reviewed,
      [edit, { blockId: edit.blockId, text: "TypeScript experience." }],
      editedAt,
    );
    expect(edited?.sections[0]?.blocks[0]?.text).toBe("TypeScript experience.");
  });

  it("keeps the reviewed draft's finding ids on the edited version, so decisions still match", () => {
    const edited = applyCandidateEdits(reviewed, [edit], editedAt);
    const run = { runId: "run-1", round: 1 };

    expect(reviewFindingId(run, edited, 0, "uncovered-requirement")).toBe(
      reviewFindingId(run, reviewed, 0, "uncovered-requirement"),
    );
    expect(
      reviewFindingId(run, { ...reviewed, id: "artifact-2" }, 0, "uncovered-requirement"),
    ).not.toBe(reviewFindingId(run, reviewed, 0, "uncovered-requirement"));
  });

  it("refuses an edit to a block the draft does not have, or one that empties a block", () => {
    expect(() =>
      applyCandidateEdits(reviewed, [{ blockId: "missing", text: "x" }], editedAt),
    ).toThrow(RunTransitionError);
    expect(() =>
      applyCandidateEdits(reviewed, [{ blockId: edit.blockId, text: "  " }], editedAt),
    ).toThrow(RunTransitionError);
  });
});

describe("approval with the candidate's review edits", () => {
  it("approves and exports the edited version", async () => {
    const { store } = await drafted();

    const approved = await engine(store).approve("run-1", { candidateEdits: [edit] });

    expect(approved).toMatchObject({ state: "approved", approval: "approved" });
    expect(approved.artifact?.version).toBe(2);
    expect(approved.artifact?.sections[0]?.blocks[0]?.text).toBe(edit.text);
    expect(approved.approvedArtifact).toMatchObject({
      id: `artifact-1${CANDIDATE_EDIT_VERSION_SUFFIX}`,
      version: 2,
    });
    expect(approved.readinessDecision?.artifact.id).toBe(approved.artifact?.id);
    expect(() =>
      assertExactApprovedArtifact(
        approved.artifact,
        approved.approvedArtifact,
        approved.readinessDecision,
      ),
    ).not.toThrow();
    const exported = await engine(store).markExported("run-1");
    expect(exported.state).toBe("exported");
  });

  it("approves the reviewed version unchanged without edits", async () => {
    const { store, snapshot } = await drafted();

    const approved = await engine(store).approve("run-1", { candidateEdits: [] });

    expect(approved.artifact).toEqual(snapshot.artifact);
    expect(approved.approvedArtifact?.id).toBe("artifact-1");
  });

  it("re-runs the final checks on the edited text and saves nothing when they fail", async () => {
    const { store, snapshot } = await drafted();
    const unsupported = {
      blockId: edit.blockId,
      text: "Cut deployment time by 73% with TypeScript.",
    };

    await expect(
      engine(store).approve("run-1", { candidateEdits: [unsupported] }),
    ).rejects.toMatchObject({
      code: "edits_readiness_blocked",
      message: expect.stringContaining("unsupported-quantification"),
    });
    const stored = await store.loadRun("run-1");
    expect(stored?.state).toBe("awaiting-approval");
    expect(stored?.artifact).toEqual(snapshot.artifact);

    const overridden = await engine(store).approve("run-1", {
      candidateEdits: [unsupported],
      readinessOverrideRationale: "The figure comes from my own records.",
    });
    expect(overridden.artifact?.sections[0]?.blocks[0]?.text).toBe(unsupported.text);
    expect(overridden.approvedArtifact?.readinessOverride?.rationale).toBe(
      "The figure comes from my own records.",
    );
  });
});

describe("a placeholder header at approval", () => {
  const placeholders = "[Your name] | [Email] | [Phone] | [City]";

  it("blocks approval until the candidate replaces the placeholders in the review", async () => {
    const store = new InMemoryRunStore();
    await engine(store, placeholders).start({
      runId: "run-1",
      workspace: createWorkspace("workspace-1"),
      context,
      budget: { maxRounds: 3 },
    });

    const blocked = engine(store, placeholders).approve("run-1");
    await expect(blocked).rejects.toMatchObject({ code: "readiness_blocked" });
    expect((await store.loadRun("run-1"))?.readinessDecision?.blockers).toContainEqual(
      expect.objectContaining({ code: "deterministic-error", checkCode: "missing-cv-header" }),
    );

    const approved = await engine(store, placeholders).approve("run-1", {
      candidateEdits: [{ blockId: "header-block-1", text: "Alex Example | alex@example.com" }],
    });
    expect(approved.state).toBe("approved");
    expect(approved.artifact?.sections[0]?.blocks[0]?.text).toBe("Alex Example | alex@example.com");
  });
});
