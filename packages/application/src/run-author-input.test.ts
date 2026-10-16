import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { JsonObject, ModelResponse } from "@draft-loop/providers";
import { type AuditEvent, type AuditEventInput, openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createLocalApplicationDriver, readWorkspace } from "./local.js";
import { profileFactEvidenceIdPrefix } from "./profile-fact-evidence.js";
import { type AuthorInputRecord, createProviderAuthorAgent } from "./provider-author-agent.js";
import {
  parseRunAuthorInputPayload,
  recordRunAuthorInput,
  runAuthorInputRecorder,
  summarizeAuthorInput,
} from "./run-author-input.js";
import { writeWorkspaceEvidenceMode } from "./workspace-evidence-mode.js";

const item = (id: string) => ({ id });

/** A fake audit log that echoes each appended event back as stored. */
const auditLog = () =>
  vi.fn(async (event: AuditEventInput) => ({ ...event, sequence: 1 }) as unknown as AuditEvent);

describe("summarizeAuthorInput", () => {
  it("counts distinct chunks and facts and keeps the unmatched requirement ids", () => {
    const summary = summarizeAuthorInput({
      round: 2,
      retrievedEvidence: [
        item(`${profileFactEvidenceIdPrefix}a`),
        item("chunk-1"),
        item("chunk-2"),
        item("chunk-1"),
        item(`${profileFactEvidenceIdPrefix}a`),
      ],
      uncoveredRequirementIds: ["requirement-2", "responsibility-1"],
    });
    expect(summary).toEqual({
      round: 2,
      sentChunkCount: 2,
      sentFactCount: 1,
      unmatchedRequirementIds: ["requirement-2", "responsibility-1"],
    });
  });

  it("adds the selection totals when they are known", () => {
    const base = { round: 1, retrievedEvidence: [item("chunk-1")], uncoveredRequirementIds: [] };
    expect(summarizeAuthorInput({ ...base, totals: { knowledgeChunkCount: 26 } })).toEqual({
      round: 1,
      sentChunkCount: 1,
      sentFactCount: 0,
      knowledgeChunkCount: 26,
      unmatchedRequirementIds: [],
    });
    expect(
      summarizeAuthorInput({ ...base, totals: { knowledgeChunkCount: 26, knowledgeFactCount: 4 } }),
    ).toMatchObject({ knowledgeChunkCount: 26, knowledgeFactCount: 4 });
  });
});

describe("parseRunAuthorInputPayload", () => {
  const valid = {
    round: 1,
    sentChunkCount: 3,
    sentFactCount: 1,
    knowledgeChunkCount: 10,
    knowledgeFactCount: 2,
    unmatchedRequirementIds: ["requirement-1"],
  };

  it("reads a recorded payload, with or without totals", () => {
    expect(parseRunAuthorInputPayload(valid)).toEqual(valid);
    const { knowledgeChunkCount: _chunks, knowledgeFactCount: _facts, ...legacy } = valid;
    expect(parseRunAuthorInputPayload(legacy)).toEqual(legacy);
  });

  it("rejects a malformed payload", () => {
    expect(parseRunAuthorInputPayload(undefined)).toBeUndefined();
    expect(parseRunAuthorInputPayload({ ...valid, sentChunkCount: -1 })).toBeUndefined();
    expect(parseRunAuthorInputPayload({ ...valid, round: "1" })).toBeUndefined();
    expect(parseRunAuthorInputPayload({ ...valid, unmatchedRequirementIds: [1] })).toBeUndefined();
  });
});

describe("runAuthorInputRecorder", () => {
  const input: AuthorInputRecord = {
    runId: "run-1",
    round: 1,
    retrievedEvidence: [item("chunk-1")] as unknown as readonly ScoredEvidenceChunk[],
    uncoveredRequirementIds: [],
  };

  it("appends a run event and counts the selection once per engine", async () => {
    const appendAuditEvent = auditLog();
    const knowledgeChunkCount = vi.fn(async () => 7);
    const record = runAuthorInputRecorder({ appendAuditEvent }, "workspace-1", {
      knowledgeChunkCount,
      knowledgeFactCount: async () => 2,
    });
    await record(input);
    await record({ ...input, round: 2 });
    expect(knowledgeChunkCount).toHaveBeenCalledTimes(1);
    expect(appendAuditEvent).toHaveBeenCalledTimes(2);
    expect(appendAuditEvent.mock.calls[1]?.[0]).toMatchObject({
      workspaceId: "workspace-1",
      eventType: "run.author-input",
      entityType: "run",
      entityId: "run-1",
      payload: { round: 2, knowledgeChunkCount: 7, knowledgeFactCount: 2 },
    });
  });

  it("omits totals without a selection or when they cannot be counted", async () => {
    const appendAuditEvent = auditLog();
    await runAuthorInputRecorder({ appendAuditEvent }, "workspace-1", undefined)(input);
    await runAuthorInputRecorder({ appendAuditEvent }, "workspace-1", {
      knowledgeChunkCount: async () => {
        throw new Error("unreadable store");
      },
    })(input);
    for (const [event] of appendAuditEvent.mock.calls) {
      expect(event.payload).not.toHaveProperty("knowledgeChunkCount");
      expect(event.payload).not.toHaveProperty("knowledgeFactCount");
    }
  });

  it("writes the summary as the payload", async () => {
    const appendAuditEvent = auditLog();
    const summary = summarizeAuthorInput({ ...input, uncoveredRequirementIds: ["r"] });
    await recordRunAuthorInput({ appendAuditEvent }, { workspaceId: "w", runId: "run-1", summary });
    expect(appendAuditEvent.mock.calls[0]).toMatchObject([{ payload: summary }]);
  });
});

describe("the provider author agent", () => {
  const context = {
    id: "context",
    language: "en",
    evidenceManifest: [{ id: "source", path: "/private/resume.md", checksum: "a".repeat(64) }],
    requirements: [
      { id: "requirement-1", text: "TypeScript tools" },
      { id: "requirement-2", text: "Kubernetes operations" },
    ],
    outputConstraints: { requiredSections: [] },
    modelConfiguration: { author: { promptTemplateVersion: "cli-author-v3" } },
  } as unknown as ContextSnapshot;
  const evidence: readonly ScoredEvidenceChunk[] = [
    {
      id: "chunk",
      workspaceId: "workspace",
      sourceId: "source",
      ordinal: 0,
      lineStart: 1,
      lineEnd: 1,
      checksum: "b".repeat(64),
      text: "Built TypeScript tools in 2021.",
      rank: 0,
    },
  ];
  const text = "Built TypeScript tools in 2021.";
  const output: JsonObject = {
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text,
            claims: [{ text, substantive: true, evidenceChunkIds: ["E1"] }],
          },
        ],
      },
    ],
  };

  function agent(recordAuthorInput: (input: AuthorInputRecord) => Promise<void>) {
    const calls: string[] = [];
    const author = createProviderAuthorAgent({
      context,
      promptContext: context,
      dataPolicy: () => ({
        allowTransmission: true,
        allowedCompanies: ["anthropic"],
        sensitiveData: true,
        sensitiveDataAcknowledged: true,
        requestedRetention: "ephemeral-request",
      }),
      createAdapter: async () => ({
        execute: async () => {
          calls.push("provider");
          return {
            output,
            contextSnapshotId: "context",
            provider: "anthropic",
            company: "anthropic",
            modelId: "test-model",
            providerRequestId: "request",
            structuredOutputSha256: "c".repeat(64),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            cost: { estimatedUsd: null },
          } satisfies ModelResponse<JsonObject>;
        },
      }),
      authorCompany: "anthropic",
      authorModel: "test-model",
      authorProposalCaptureDirectory: undefined,
      userError: (message) => new Error(message),
      recordAuthorInput: async (input) => {
        calls.push("record");
        await recordAuthorInput(input);
      },
    });
    const request = {
      executionId: "execution",
      runId: "run-1",
      round: 1,
      context,
      currentArtifact: null,
      findings: [],
      retrievedEvidence: evidence,
    };
    return { author, request, calls };
  }

  it("records what it was given before the provider call", async () => {
    const recorded: AuthorInputRecord[] = [];
    const { author, request, calls } = agent(async (input) => {
      recorded.push(input);
    });
    await author.execute(request);
    expect(calls).toEqual(["record", "provider"]);
    expect(recorded).toEqual([
      {
        runId: "run-1",
        round: 1,
        retrievedEvidence: evidence,
        uncoveredRequirementIds: ["requirement-2"],
      },
    ]);
  });

  it("drafts even when recording fails", async () => {
    const { author, request } = agent(async () => {
      throw new Error("history unavailable");
    });
    await expect(author.execute(request)).resolves.toMatchObject({ output: expect.anything() });
  });
});

describe("author input in a local run", { timeout: 60_000 }, () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  const evidenceLine = "Built local-first TypeScript tools with deterministic testing.";
  const silent = { write: () => undefined };

  function completion(output: object, id: string): unknown {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id,
        choices: [{ message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
      }),
    };
  }

  function authorProposal(evidenceId: string): object {
    const claim = (claimText: string) => ({
      text: claimText,
      substantive: true,
      evidenceChunkIds: [evidenceId],
    });
    const section = (title: string, kind: string, type: string, blockText: string) => ({
      title,
      kind,
      blocks: [{ type, text: blockText, claims: [claim(blockText)] }],
    });
    return {
      sections: [
        section("Summary", "summary", "paragraph", evidenceLine),
        section("Experience", "experience", "bullet", evidenceLine),
        {
          title: "Education",
          kind: "education",
          blocks: [{ type: "bullet", text: "Education information unavailable", claims: [] }],
        },
        section("Skills", "skills", "bullet", "TypeScript tools and deterministic testing."),
      ],
    };
  }

  async function workspace() {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-author-input-"));
    roots.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "Build TypeScript tools. Operate Kubernetes.\n", "utf8");
    await writeFile(join(root, "evidence", "resume.md"), `${evidenceLine}\n`, "utf8");
    const storeRoot = join(root, "candidate-store");
    const candidatePath = join(root, "candidate.md");
    await writeFile(
      candidatePath,
      `Ada Lovelace\n\n${evidenceLine}\n\nMaintained deterministic testing suites.\n`,
      "utf8",
    );
    const ids = ["ai-store", "ai-ckb", "ai-source", "ai-version"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-10-10T08:00:00.000Z",
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "ai-ckb",
      sourcePath: candidatePath,
    });
    const sent: (readonly ScoredEvidenceChunk[])[] = [];
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        readonly model: string;
        readonly messages: readonly { readonly content: string }[];
      };
      if (body.model === "critic-model") return completion({ findings: [] }, "critic");
      // A revision first asks for a patch; an unusable one falls back to the full proposal, and
      // both calls belong to one author step.
      if ((body.messages[0]?.content ?? "").includes("This request is a targeted revision")) {
        return completion({ edits: [] }, "author-patch");
      }
      const input = JSON.parse(body.messages[1]?.content ?? "{}") as {
        readonly retrievedEvidence?: readonly ScoredEvidenceChunk[];
      };
      const evidence = input.retrievedEvidence ?? [];
      sent.push(evidence);
      const cited = evidence.find(({ text }) => text.includes(evidenceLine)) ?? evidence[0];
      if (cited === undefined) throw new Error("The author received no evidence.");
      return completion(authorProposal(cited.id), "author");
    });
    const driver = createLocalApplicationDriver({
      providerClientFactories: {
        local: (endpoint) => ({
          ...(endpoint === undefined ? {} : { endpoint }),
          fetch: transport as unknown as typeof fetch,
        }),
      },
    });
    await driver.initialize(
      {
        root,
        jobDescription: "job.md",
        sources: "evidence",
        authorCompany: "local",
        authorModel: "author-model",
        criticCompany: "local",
        criticModel: "critic-model",
        localEndpoint: "http://127.0.0.1:8080/v1",
      },
      silent,
    );
    await driver.configureKnowledgeSelection(
      { root, entries: [{ storeRoot, storeId: "ai-store", knowledgeBaseId: "ai-ckb" }] },
      silent,
    );
    return { root, driver, sent };
  }

  async function authorInputEvents(root: string) {
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const config = await readWorkspace(root);
      const events = (await storage.listAuditEvents(config.id)).filter(
        ({ eventType }) => eventType === "run.author-input",
      );
      return { runId: config.latestRunId, events };
    } finally {
      await storage.close();
    }
  }

  it("records each author step with the run id, round and selection totals", async () => {
    const { root, driver, sent } = await workspace();
    await driver.start({ root, allowProviderData: true }, silent);

    const { runId, events } = await authorInputEvents(root);
    expect(events).toHaveLength(sent.length);
    expect(events.length).toBeGreaterThan(0);
    const [event] = events;
    expect(event).toMatchObject({ entityType: "run", entityId: runId });
    const payload = parseRunAuthorInputPayload(event?.payload);
    // Full source, the default, sends every eligible chunk of the pinned selection.
    expect(payload).toEqual({
      round: 1,
      sentChunkCount: sent[0]?.length,
      sentFactCount: 0,
      knowledgeChunkCount: sent[0]?.length,
      unmatchedRequirementIds: expect.any(Array),
    });
    const recorded = JSON.stringify(events);
    for (const content of ["TypeScript", "Lovelace", "deterministic"]) {
      expect(recorded).not.toContain(content);
    }
  });

  it("counts the pinned selection, not just what retrieval sent", async () => {
    const { root, driver, sent } = await workspace();
    await writeWorkspaceEvidenceMode(root, "retrieval");
    await driver.start({ root, allowProviderData: true }, silent);

    const { events } = await authorInputEvents(root);
    const payload = parseRunAuthorInputPayload(events[0]?.payload);
    expect(payload?.sentChunkCount).toBe(sent[0]?.length);
    expect(payload?.knowledgeChunkCount).toBeGreaterThanOrEqual(payload?.sentChunkCount ?? 0);
    expect(payload).not.toHaveProperty("knowledgeFactCount");
  });
});
