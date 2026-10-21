import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AuthorRequest } from "@draft-loop/orchestrator";
import { droppedCoverageFindings } from "@draft-loop/orchestrator";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { authorRevisionPatchSchema, type DraftArtifact } from "@draft-loop/schemas";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authorPromptSupportsTargetedRevision,
  createAuthorAdjudicationPrompt,
} from "./author-adjudication.js";
import { buildAuthorArtifact } from "./author-output.js";
import { resetAuthorRevisionMemoryForTests } from "./author-revision-memory.js";
import { applyAuthorRevisionPatch } from "./author-revision-patch.js";
import { createProviderAuthorAgent } from "./provider-author-agent.js";

const manifest = [{ id: "source", path: "/private/resume.md", checksum: "a".repeat(64) }];

function chunk(id: string, text: string, line: number): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace",
    sourceId: "source",
    ordinal: line,
    lineStart: line,
    lineEnd: line,
    checksum: "b".repeat(64),
    text,
    rank: line,
  };
}

const summaryText = "Platform engineer with deep reliability focus.";
const migrationText = "Led the platform migration in 2021.";
const deployText = "Reduced deployment time by 40 percent.";
const toolsText = "Built TypeScript tools in 2023.";
const evidence = [
  chunk("chunk-summary", summaryText, 1),
  chunk("chunk-migration", migrationText, 2),
  chunk("chunk-deploy", deployText, 3),
  chunk("chunk-tools", toolsText, 4),
];

function block(type: "paragraph" | "bullet", text: string, chunkId: string): JsonObject {
  return { type, text, claims: [{ text, substantive: true, evidenceChunkIds: [chunkId] }] };
}

function currentArtifact(): DraftArtifact {
  return buildAuthorArtifact({
    proposal: {
      sections: [
        {
          title: "Summary",
          kind: "summary",
          blocks: [block("paragraph", summaryText, "chunk-summary")],
        },
        {
          title: "Experience",
          kind: "experience",
          blocks: [
            block("bullet", migrationText, "chunk-migration"),
            block("bullet", deployText, "chunk-deploy"),
          ],
        },
      ],
    },
    executionId: "execution-current",
    context: { language: "en", evidenceManifest: manifest },
    retrievedEvidence: evidence,
    createdAt: "2026-10-01T00:00:00.000Z",
  });
}

function ids(artifact: DraftArtifact) {
  const [summary, experience] = artifact.sections;
  return {
    summarySection: summary?.id ?? "",
    experienceSection: experience?.id ?? "",
    summaryBlock: summary?.blocks[0]?.id ?? "",
    migrationBlock: experience?.blocks[0]?.id ?? "",
    deployBlock: experience?.blocks[1]?.id ?? "",
  };
}

const noEdit = { blockId: null, sectionId: null, afterBlockId: null, block: null, findingIds: [] };

function apply(output: unknown, artifact = currentArtifact(), accepted: string[] = ["f-1"]) {
  return applyAuthorRevisionPatch({
    output,
    currentArtifact: artifact,
    retrievedEvidence: evidence,
    evidenceManifest: manifest,
    acceptedFindingIds: accepted,
  });
}

describe("applyAuthorRevisionPatch", () => {
  it("replaces, inserts and deletes blocks and leaves every other block as it was", () => {
    const artifact = currentArtifact();
    const id = ids(artifact);
    const outcome = apply(
      {
        edits: [
          {
            ...noEdit,
            op: "replace",
            blockId: id.summaryBlock,
            block: block("paragraph", summaryText, "chunk-summary"),
            findingIds: ["f-1"],
          },
          {
            ...noEdit,
            op: "insert",
            sectionId: id.experienceSection,
            afterBlockId: id.migrationBlock,
            block: block("bullet", toolsText, "chunk-tools"),
          },
          { ...noEdit, op: "delete", blockId: id.deployBlock, findingIds: ["f-1"] },
        ],
      },
      artifact,
    );
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(
      outcome.proposal.sections.map((section) => section.blocks.map(({ text }) => text)),
    ).toEqual([[summaryText], [migrationText, toolsText]]);
    expect(outcome.edits).toEqual([
      {
        op: "replace",
        sourceBlockKey: "summary#0/b0",
        revisedBlockKey: "summary#0/b0",
        findingIds: ["f-1"],
      },
      { op: "insert", revisedBlockKey: "experience#0/b1", findingIds: [] },
      { op: "delete", sourceBlockKey: "experience#0/b1", findingIds: ["f-1"] },
    ]);
    // The unflagged migration block keeps its type, text, claims and evidence ids.
    expect(outcome.proposal.sections[1]?.blocks[0]).toEqual({
      type: "bullet",
      text: migrationText,
      claims: [
        {
          text: migrationText,
          substantive: true,
          evidenceChunkIds: expect.arrayContaining(["chunk-migration"]),
        },
      ],
    });
  });

  it("inserts at the start of a section when no block is named", () => {
    const artifact = currentArtifact();
    const outcome = apply(
      {
        edits: [
          {
            ...noEdit,
            op: "insert",
            sectionId: ids(artifact).experienceSection,
            block: block("bullet", toolsText, "chunk-tools"),
          },
        ],
      },
      artifact,
    );
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.proposal.sections[1]?.blocks.map(({ text }) => text)).toEqual([
      toolsText,
      migrationText,
      deployText,
    ]);
  });

  it.each([
    ["an unknown block", { op: "delete", blockId: "block-nowhere" }, "unknown-block"],
    [
      "an unknown section",
      { op: "insert", sectionId: "section-nowhere", block: "tools" },
      "unknown-section",
    ],
    [
      "an unknown finding",
      { op: "delete", blockId: "$deploy", findingIds: ["f-unknown"] },
      "unknown-finding",
    ],
    ["a section left empty", { op: "delete", blockId: "$summary" }, "empty-section"],
  ])("rejects %s", (_name, edit, reason) => {
    const artifact = currentArtifact();
    const id = ids(artifact);
    const resolved = { ...noEdit, ...edit } as Record<string, unknown>;
    if (resolved.blockId === "$deploy") resolved.blockId = id.deployBlock;
    if (resolved.blockId === "$summary") resolved.blockId = id.summaryBlock;
    if (resolved.block === "tools") resolved.block = block("bullet", toolsText, "chunk-tools");
    expect(apply({ edits: [resolved] }, artifact)).toEqual({ ok: false, reason });
  });

  it("rejects an insert that names a block of another section", () => {
    const artifact = currentArtifact();
    const id = ids(artifact);
    expect(
      apply(
        {
          edits: [
            {
              ...noEdit,
              op: "insert",
              sectionId: id.summarySection,
              afterBlockId: id.deployBlock,
              block: block("bullet", toolsText, "chunk-tools"),
            },
          ],
        },
        artifact,
      ),
    ).toEqual({ ok: false, reason: "unknown-block" });
  });

  it("rejects two edits to one block", () => {
    const artifact = currentArtifact();
    const id = ids(artifact);
    expect(
      apply(
        {
          edits: [
            { ...noEdit, op: "delete", blockId: id.deployBlock },
            { ...noEdit, op: "delete", blockId: id.deployBlock },
          ],
        },
        artifact,
      ),
    ).toEqual({ ok: false, reason: "conflicting-edits" });
  });

  it.each([
    ["no edits", { edits: [] }],
    ["an unknown member", { edits: [{ ...noEdit, op: "delete", blockId: "b", extra: 1 }] }],
    [
      "a delete that carries a block",
      { edits: [{ ...noEdit, op: "delete", blockId: "b", block: block("bullet", "x", "c") }] },
    ],
    ["a replace without a block", { edits: [{ ...noEdit, op: "replace", blockId: "b" }] }],
    ["a whole proposal", { sections: [] }],
  ])("rejects a malformed patch: %s", (_name, output) => {
    expect(authorRevisionPatchSchema.safeParse(output).success).toBe(false);
    expect(apply(output)).toEqual({ ok: false, reason: "malformed-patch" });
  });

  it("rejects the patch when an unflagged claim's evidence is not retrieved for this request", () => {
    const artifact = currentArtifact();
    const outcome = applyAuthorRevisionPatch({
      output: { edits: [{ ...noEdit, op: "delete", blockId: ids(artifact).deployBlock }] },
      currentArtifact: artifact,
      retrievedEvidence: evidence.filter(({ id }) => id !== "chunk-summary"),
      evidenceManifest: manifest,
      acceptedFindingIds: [],
    });
    expect(outcome).toEqual({ ok: false, reason: "unmappable-evidence" });
  });
});

const baseContext = {
  id: "context",
  language: "en",
  evidenceManifest: manifest,
  requirements: [{ id: "requirement-deploy", text: "Reduced deployment time" }],
  outputConstraints: { requiredSections: [] },
} as unknown as ContextSnapshot;

function contextFor(version: string): ContextSnapshot {
  return {
    ...baseContext,
    modelConfiguration: { author: { promptTemplateVersion: version } },
  } as unknown as ContextSnapshot;
}

/** An author agent over a fake adapter answering with the queued model-facing outputs. */
function agent(outputs: JsonObject[], version = "cli-author-v10") {
  const requests: ModelRequest<JsonObject>[] = [];
  const agentContext = contextFor(version);
  const author = createProviderAuthorAgent({
    context: agentContext,
    promptContext: agentContext,
    dataPolicy: () => ({
      allowTransmission: true,
      allowedCompanies: ["anthropic"],
      sensitiveData: true,
      sensitiveDataAcknowledged: true,
      requestedRetention: "ephemeral-request",
    }),
    createAdapter: async () => ({
      execute: async (request) => {
        requests.push(request);
        const output = outputs.shift();
        if (output === undefined) throw new Error("No queued author output.");
        return {
          output,
          contextSnapshotId: "context",
          provider: "anthropic",
          company: "anthropic",
          route: "anthropic-api",
          modelId: "test-model",
          providerRequestId: "request",
          structuredOutputSha256: "c".repeat(64),
          usage: { inputTokens: 10, outputTokens: 5 * (requests.length + 1), totalTokens: 20 },
          cost: { estimatedUsd: 0.5 },
        } satisfies ModelResponse<JsonObject>;
      },
    }),
    authorCompany: "anthropic",
    authorModel: "test-model",
    authorProposalCaptureDirectory: undefined,
    userError: (message) => new Error(message),
  });
  return { author, requests };
}

/** Evidence ids reach the model as request-local aliases E1..E4, in retrieved order. */
const alias = { summary: "E1", migration: "E2", deploy: "E3", tools: "E4" };

function aliasedBlock(type: "paragraph" | "bullet", text: string, evidenceAlias: string) {
  return block(type, text, evidenceAlias);
}

function request(
  artifact: DraftArtifact | null,
  extra: Partial<AuthorRequest> = {},
): AuthorRequest {
  return {
    executionId: "execution-revision",
    runId: "run-1",
    round: artifact === null ? 1 : 2,
    context: baseContext,
    currentArtifact: artifact,
    findings: [],
    retrievedEvidence: evidence,
    ...extra,
  };
}

const adjudication = {
  report: {},
  plan: { decisions: [{ findingId: "f-1", disposition: "accept" }] },
  acceptedEffectOverrides: [],
} as unknown as NonNullable<AuthorRequest["pendingAdjudication"]>;

function fullProposal(): JsonObject {
  return {
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [aliasedBlock("paragraph", summaryText, alias.summary)],
      },
      {
        title: "Experience",
        kind: "experience",
        blocks: [
          aliasedBlock("bullet", migrationText, alias.migration),
          aliasedBlock("bullet", deployText, alias.deploy),
        ],
      },
    ],
  } as unknown as JsonObject;
}

describe("provider author agent targeted revisions", () => {
  beforeEach(() => resetAuthorRevisionMemoryForTests());

  it("applies the patch locally, keeps unflagged blocks identical and records the edit's findings", async () => {
    const previous = currentArtifact();
    const id = ids(previous);
    const { author, requests } = agent([
      {
        edits: [
          {
            ...noEdit,
            op: "replace",
            blockId: id.deployBlock,
            block: aliasedBlock("bullet", "Reduced deployment time by 40 percent.", alias.deploy),
            findingIds: ["f-1"],
          },
          {
            ...noEdit,
            op: "insert",
            sectionId: id.experienceSection,
            afterBlockId: id.deployBlock,
            block: aliasedBlock("bullet", toolsText, alias.tools),
            findingIds: ["f-1"],
          },
        ],
      },
    ]);

    const execution = await author.execute(
      request(previous, { pendingAdjudication: adjudication }),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.outputName).toBe("author_revision_patch");
    expect(requests[0]?.systemPrompt).toContain("This request is a targeted revision");
    expect(execution.revisionMode).toBe("patch");
    expect(execution.appliedEdits).toEqual([
      {
        op: "replace",
        sourceBlockKey: "experience#0/b1",
        revisedBlockKey: "experience#0/b1",
        findingIds: ["f-1"],
      },
      { op: "insert", revisedBlockKey: "experience#0/b2", findingIds: ["f-1"] },
    ]);
    const revised = execution.output;
    expect(revised.sections.map((section) => section.blocks.map(({ text }) => text))).toEqual([
      [summaryText],
      [migrationText, deployText, toolsText],
    ]);
    // Unflagged blocks and their claims are copied exactly.
    const claimsOf = (artifact: DraftArtifact, blockIndex: number, section: number) =>
      artifact.claims
        .filter((claim) => claim.blockId === artifact.sections[section]?.blocks[blockIndex]?.id)
        .map(({ text, substantive, evidence: refs }) => ({ text, substantive, refs }));
    expect(claimsOf(revised, 0, 0)).toEqual(claimsOf(previous, 0, 0));
    expect(claimsOf(revised, 0, 1)).toEqual(claimsOf(previous, 0, 1));
    expect(JSON.stringify(revised.sections[0]?.blocks[0]?.text)).toBe(
      JSON.stringify(previous.sections[0]?.blocks[0]?.text),
    );
    expect(revised.parentVersionId).toBe(previous.id);
  });

  it("falls back to the full revision, as one attempt, when the patch is malformed", async () => {
    const previous = currentArtifact();
    const { author, requests } = agent([{ edits: "not edits" } as JsonObject, fullProposal()]);

    const execution = await author.execute(request(previous));

    expect(requests.map(({ outputName }) => outputName)).toEqual([
      "author_revision_patch",
      "author_artifact_proposal",
    ]);
    expect(requests[1]?.systemPrompt).not.toContain("This request is a targeted revision");
    expect(execution.revisionMode).toBe("patch-fallback");
    expect(execution.appliedEdits).toBeUndefined();
    // Both calls are paid for in the one execution.
    expect(execution.inputTokens).toBe(20);
    expect(execution.outputTokens).toBe(10 + 15);
    expect(execution.estimatedUsd).toBe(1);
  });

  it.each([
    [
      "an unknown block id",
      (_id: ReturnType<typeof ids>) => ({ ...noEdit, op: "delete", blockId: "block-nowhere" }),
    ],
    [
      "a finding the run did not accept",
      (id: ReturnType<typeof ids>) => ({
        ...noEdit,
        op: "delete",
        blockId: id.deployBlock,
        findingIds: ["f-unknown"],
      }),
    ],
  ])("falls back to the full revision for %s", async (_name, edit) => {
    const previous = currentArtifact();
    const { author } = agent([{ edits: [edit(ids(previous))] } as JsonObject, fullProposal()]);
    const execution = await author.execute(
      request(previous, { pendingAdjudication: adjudication }),
    );
    expect(execution.revisionMode).toBe("patch-fallback");
  });

  it("grounds the patched artifact and falls back when an edit states an unsupported claim", async () => {
    const previous = currentArtifact();
    const unsupported = "Reduced deployment time by 90 percent.";
    const { author } = agent([
      {
        edits: [
          {
            ...noEdit,
            op: "replace",
            blockId: ids(previous).deployBlock,
            block: aliasedBlock("bullet", unsupported, alias.deploy),
          },
        ],
      },
      fullProposal(),
    ]);

    const execution = await author.execute(request(previous));

    expect(execution.revisionMode).toBe("patch-fallback");
    expect(JSON.stringify(execution.output.sections)).not.toContain("90 percent");
  });

  it("warns when a delete removes the only block that covered a requirement", async () => {
    const previous = currentArtifact();
    const id = ids(previous);
    const { author } = agent([
      { edits: [{ ...noEdit, op: "delete", blockId: id.deployBlock, findingIds: ["f-1"] }] },
    ]);

    const execution = await author.execute(
      request(previous, { pendingAdjudication: adjudication }),
    );

    expect(execution.revisionMode).toBe("patch");
    expect(
      droppedCoverageFindings({
        previousCoverage: [
          {
            requirementId: "requirement-deploy",
            verdict: "covered",
            rationale: "The block states the faster deployments.",
            citedBlockIds: [id.deployBlock],
          },
        ],
        previousArtifact: previous,
        revisedArtifact: execution.output,
      }),
    ).toMatchObject([{ code: "coverage-block-dropped", requirementId: "requirement-deploy" }]);
    expect(execution.appliedEdits).toEqual([
      { op: "delete", sourceBlockKey: "experience#0/b1", findingIds: ["f-1"] },
    ]);
  });

  it("asks for the full proposal for a first draft, a retry and a run on an older prompt version", async () => {
    const previous = currentArtifact();
    const first = agent([fullProposal()]);
    const firstExecution = await first.author.execute(request(null));
    expect(first.requests[0]?.outputName).toBe("author_artifact_proposal");
    expect(firstExecution.revisionMode).toBeUndefined();

    const retry = agent([fullProposal()]);
    const retryExecution = await retry.author.execute(
      request(previous, {
        retryFeedback: {
          failureCode: "invalid-response",
          failureStage: "factual-invariant-rejection",
          diagnostics: [],
        } as unknown as NonNullable<AuthorRequest["retryFeedback"]>,
      }),
    );
    expect(retry.requests).toHaveLength(1);
    expect(retry.requests[0]?.outputName).toBe("author_artifact_proposal");
    expect(retryExecution.revisionMode).toBe("full");

    const older = agent([fullProposal()], "cli-author-v9");
    const olderExecution = await older.author.execute(request(previous));
    expect(older.requests).toHaveLength(1);
    expect(older.requests[0]?.outputName).toBe("author_artifact_proposal");
    expect(older.requests[0]?.systemPrompt).not.toContain("targeted revision");
    expect(olderExecution.revisionMode).toBe("full");
  });
});

describe("author prompt cli-author-v10", () => {
  it("adds the patch instructions only to a patch request of a version that states them", () => {
    const full = createAuthorAdjudicationPrompt("cli-author-v10", undefined);
    const patch = createAuthorAdjudicationPrompt(
      "cli-author-v10",
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      "patch",
    );
    expect(patch.systemPrompt.startsWith(full.systemPrompt)).toBe(true);
    expect(patch.systemPrompt).toContain("This request is a targeted revision");
    expect(full.systemPrompt).not.toContain("targeted revision");
    // A first draft and a full revision on v10 read exactly like v9.
    expect(full.systemPrompt).toBe(
      createAuthorAdjudicationPrompt("cli-author-v9", undefined).systemPrompt,
    );

    const olderPatch = createAuthorAdjudicationPrompt(
      "cli-author-v9",
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      "patch",
    );
    expect(olderPatch.systemPrompt).not.toContain("targeted revision");
  });

  it("is stated only from v10 on", () => {
    expect(authorPromptSupportsTargetedRevision("cli-author-v10")).toBe(true);
    for (const version of ["cli-author-v1", "cli-author-v8", "cli-author-v9"]) {
      expect(authorPromptSupportsTargetedRevision(version)).toBe(false);
    }
  });
});
