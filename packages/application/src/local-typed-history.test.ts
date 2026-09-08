import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ContextSnapshot, createWorkspace, type JobRequirementId } from "@draft-loop/domain";
import {
  type AgentExecution,
  createOrchestrationEngine,
  createStorageRunStore,
} from "@draft-loop/orchestrator";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import { createLocalApplicationDriver } from "./local.js";
import { saveTypedHistory } from "./local-typed-history.js";

const silent = { write: () => undefined };
function execution<T>(output: T, provider: string): AgentExecution<T> {
  return {
    output,
    provider,
    modelId: `${provider}-fixture`,
    providerRequestId: null,
    outputChecksum: "a".repeat(64),
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    estimatedUsd: 0,
    completedAt: "2026-09-01T00:00:00.000Z",
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artifact-history-"));
  await mkdir(join(root, "evidence"));
  await writeFile(join(root, "job.md"), "TypeScript engineer");
  await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.");
  const driver = createLocalApplicationDriver();
  await driver.initialize(
    { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true, maxRounds: 3 },
    silent,
  );
  const seed = await driver.start({ root, allowProviderData: false }, silent);
  if (seed.artifact === null) throw new Error("Missing fixture artifact");
  const base = seed.artifact;
  const storage = await openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
  const store = createStorageRunStore(storage);
  const context = (await storage.getContextSnapshot(seed.contextSnapshotId))
    ?.payload as unknown as ContextSnapshot;
  if (context === undefined) throw new Error("Missing fixture context");
  const engine = createOrchestrationEngine({
    store,
    author: {
      execute: async ({ round }) =>
        execution(
          {
            ...base,
            id: `two-round-artifact-${round}`,
            version: round,
            parentVersionId: round === 1 ? null : `two-round-artifact-${round - 1}`,
          },
          "anthropic",
        ),
    },
    critic: {
      execute: async ({ round }) =>
        execution(
          {
            findings:
              round === 1
                ? [
                    {
                      id: "revise",
                      code: "revise",
                      severity: "warning" as const,
                      message: "Improve clarity.",
                      category: "quality" as const,
                    },
                  ]
                : [],
          },
          "openai",
        ),
    },
  });
  const snapshot = await engine.start({
    runId: "two-round-run",
    workspace: createWorkspace(seed.workspaceId),
    context: {
      ...context,
      requirements: [
        ...context.requirements,
        { id: "uncovered" as JobRequirementId, text: "Another required skill", priority: "high" },
      ],
      readinessRubric: {
        relevance: 1,
        evidence: 1,
        accuracy: 1,
        differentiation: 1,
        clarity: 1,
        format: 1,
        credibility: 1,
      },
    },
    budget: { maxRounds: 2 },
  });
  return {
    root,
    driver,
    storage,
    snapshot,
    config: { id: seed.workspaceId },
    cleanup: async () => {
      await storage.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe("automatic revision typed history", () => {
  it("projects both artifact versions and rounds from one call and replays idempotently", async () => {
    const f = await fixture();
    try {
      expect(
        f.snapshot.round,
        JSON.stringify({
          state: f.snapshot.state,
          findings: f.snapshot.findings,
          error: f.snapshot.lastError,
        }),
      ).toBe(2);
      expect(f.snapshot.state).toBe("awaiting-approval");
      const before = await f.storage.listRunSnapshots(f.snapshot.runId);
      const recovered = await f.driver.resume(
        { root: f.root, runId: f.snapshot.runId, allowProviderData: false },
        silent,
      );
      expect(recovered).toEqual(f.snapshot);
      await saveTypedHistory(f.storage, f.config, f.snapshot);
      for (const round of [1, 2]) {
        expect(await f.storage.getArtifactVersion(`two-round-artifact-${round}`)).toBeDefined();
        expect(await f.storage.getRound(`two-round-run:round:${round}`)).toBeDefined();
      }
      for (const entry of f.snapshot.executionHistory)
        expect(await f.storage.getExecution(entry.id)).toBeDefined();
      expect(await f.storage.listRunSnapshots(f.snapshot.runId)).toEqual(before);
    } finally {
      await f.cleanup();
    }
  });

  it.each(["missing", "checksum", "workspace", "conflict"])(
    "rejects %s ancestry before projection",
    async (failure) => {
      const f = await fixture();
      try {
        const records = await f.storage.listRunSnapshots(f.snapshot.runId);
        if (failure === "missing") {
          vi.spyOn(f.storage, "listRunSnapshots").mockResolvedValue(
            records.filter((r) => r.artifactId !== "two-round-artifact-1"),
          );
        } else if (failure === "checksum") {
          vi.spyOn(f.storage, "listRunSnapshots").mockResolvedValue(
            records.map((r) => ({ ...r, checksum: "0".repeat(64) })),
          );
        } else if (failure === "workspace") {
          f.config.id = "another-workspace";
        } else {
          const artifact = f.snapshot.artifact;
          if (artifact === null) throw new Error("Missing artifact");
          await f.storage.saveArtifactVersion({
            id: artifact.id,
            workspaceId: f.config.id,
            version: 1,
            parentVersionId: null,
            createdAt: artifact.createdAt,
            payload: {},
          });
        }
        await expect(saveTypedHistory(f.storage, f.config, f.snapshot)).rejects.toThrow(
          /missing or inconsistent/,
        );
        expect(await f.storage.getArtifactVersion("two-round-artifact-1")).toBeUndefined();
        expect(await f.storage.getRun(f.snapshot.runId)).toBeUndefined();
      } finally {
        vi.restoreAllMocks();
        await f.cleanup();
      }
    },
  );
});
