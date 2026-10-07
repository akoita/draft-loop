import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
  ContextSnapshot,
} from "@draft-loop/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as lexicalSync from "./candidate-knowledge-lexical-sync.js";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

vi.mock("./candidate-knowledge-lexical-sync.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./candidate-knowledge-lexical-sync.js")>();
  return {
    ...actual,
    synchronizeCandidateKnowledgeLexicalSelection: vi.fn(
      actual.synchronizeCandidateKnowledgeLexicalSelection,
    ),
  };
});

const selectionChanged = "The candidate knowledge selection changed during retrieval.";

describe("candidate knowledge query batches", () => {
  const temporaryRoots: string[] = [];
  const synchronize = vi.mocked(lexicalSync.synchronizeCandidateKnowledgeLexicalSelection);

  beforeEach(() => {
    synchronize.mockClear();
  });

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  async function fixture() {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-query-batch-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "fictional-candidate.md");
    await writeFile(
      sourcePath,
      [
        "# Fictional Candidate",
        "",
        "## Summary",
        "Fictional candidate with a background in platform engineering.",
        "",
        "## Experience",
        "Maintained a fictional service and documented reliable operations.",
        "",
        "## Skills",
        "Java, reliable operations, incident response.",
      ].join("\n"),
      "utf8",
    );
    const ids = [
      "batch-store",
      "batch-ckb",
      "batch-source",
      "batch-version",
      "extra-source",
      "extra-version",
    ];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "batch-ckb",
      sourcePath,
    });
    const selections = [{ storeRoot, knowledgeBaseId: "batch-ckb" }];
    const importExtraSource = async () => {
      const extraPath = join(parent, "extra.md");
      await writeFile(extraPath, "# Extra\n\nAn additional fictional source.", "utf8");
      await service.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId: "batch-ckb",
        sourcePath: extraPath,
      });
    };
    return { service, selections, importExtraSource };
  }

  async function runtimeFor(
    value: Awaited<ReturnType<typeof fixture>>,
    appendTrace: (input: CandidateKnowledgeRetrievalTraceInput) => Promise<void>,
  ) {
    const selection = await value.service.createKnowledgeSelectionSnapshot({
      selections: value.selections,
    });
    const runtime = candidateKnowledgeRuntimeRetrieval(
      {
        appendCandidateKnowledgeRetrievalTrace: async (
          input: CandidateKnowledgeRetrievalTraceInput,
        ) => {
          await appendTrace(input);
          return input as unknown as CandidateKnowledgeRetrievalTrace;
        },
      },
      {
        id: "workspace-query-batch",
        requiredSections: ["Summary", "Experience", "Skills"],
        candidateKnowledgeSelection: { entries: value.selections },
      },
      { candidateKnowledgeSelection: selection } as ContextSnapshot,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge retrieval.");
    return runtime;
  }

  it("runs one synchronization for every query of one inspection", async () => {
    const value = await fixture();
    const traces: CandidateKnowledgeRetrievalTraceInput[] = [];
    const runtime = await runtimeFor(value, async (input) => {
      traces.push(input);
    });

    const result = await runtime.inspect("platform engineering");

    expect(result.hits.length).toBeGreaterThan(0);
    // Each raw query still leaves its own trace and diagnostic.
    expect(new Set(traces.map(({ operationId }) => operationId)).size).toBeGreaterThanOrEqual(5);
    expect(synchronize).toHaveBeenCalledTimes(1);
  });

  it("fails the operation when the selection changes while it runs", async () => {
    const value = await fixture();
    let changed = false;
    const runtime = await runtimeFor(value, async () => {
      if (changed) return;
      changed = true;
      await value.importExtraSource();
    });

    await expect(runtime.inspect("platform engineering")).rejects.toThrow(selectionChanged);
  });

  it("does not reuse results from an operation that failed verification", async () => {
    const value = await fixture();
    let changed = false;
    const runtime = await runtimeFor(value, async () => {
      if (changed) return;
      changed = true;
      await value.importExtraSource();
    });
    await expect(runtime.inspect("platform engineering")).rejects.toThrow(selectionChanged);
    synchronize.mockClear();

    await expect(runtime.inspect("reliable operations")).resolves.toBeDefined();
    // The failed operation's cached results were evicted, so the retry synchronizes again.
    expect(synchronize).toHaveBeenCalled();
  });

  it("verifies the batch selection only after it has been prepared", async () => {
    const value = await fixture();
    const batch = value.service.createCandidateKnowledgeQueryBatch({
      selections: value.selections,
    });
    await expect(batch.verify()).resolves.toBeUndefined();
    expect(synchronize).not.toHaveBeenCalled();

    await batch.query({ purpose: "achievement-recall", query: "platform" });
    await batch.query({ purpose: "achievement-recall", query: "operations", limit: 3 });
    await expect(batch.verify()).resolves.toBeUndefined();
    expect(synchronize).toHaveBeenCalledTimes(1);

    await value.importExtraSource();
    await expect(batch.verify()).rejects.toThrow(selectionChanged);
  });

  it("keeps a standalone query a self-contained synchronized query", async () => {
    const value = await fixture();
    const command = {
      selections: value.selections,
      purpose: "achievement-recall",
      query: "platform",
    } as const;

    await value.service.queryCandidateKnowledge(command);
    await value.service.queryCandidateKnowledge(command);

    expect(synchronize).toHaveBeenCalledTimes(2);
  });
});
