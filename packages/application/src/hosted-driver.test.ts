import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";
import {
  type CandidateKnowledgeRunStore,
  candidateKnowledgeRunOperations,
  runOnlyCandidateKnowledgeStore,
} from "@draft-loop/storage/run-knowledge-store";
import { afterEach, describe, expect, it } from "vitest";

import { createHostedApplicationDriver } from "./hosted-driver.js";
import { createApplicationService } from "./index.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import type { StorageFactory } from "./local-storage-factory.js";
import type { WorkspaceSettingName, WorkspaceSettingsPort } from "./workspace-settings.js";

const silent = { write: () => undefined };
const workspace = "/tenants/tenant-a/workspaces/workspace-1";
const storeReference = "/tenants/tenant-a/knowledge-stores/hosted-store";
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function memorySettings(): WorkspaceSettingsPort {
  const documents = new Map<string, string>();
  const key = (reference: string, name: WorkspaceSettingName) => `${reference}#${name}`;
  return {
    read: async (reference, name) => documents.get(key(reference, name)),
    write: async (reference, name, content) => {
      documents.set(key(reference, name), content);
    },
    remove: async (reference, name) => documents.delete(key(reference, name)),
  };
}

/** History kept away from the reference, as a database keeps it: one SQLite file per workspace. */
function scratchHistory(directory: string): StorageFactory {
  return {
    open: async (reference) =>
      openSqliteStorage(
        join(directory, `${createHash("sha256").update(reference).digest("hex")}.sqlite`),
      ),
    exportBlobs: createFilesystemBlobStorage(),
  };
}

function runOperationsOf(handle: CandidateKnowledgeStoreHandle): CandidateKnowledgeRunStore {
  const operations = Object.fromEntries(
    candidateKnowledgeRunOperations.map((name) => [name, handle[name].bind(handle)]),
  );
  return { descriptor: handle.descriptor, ...operations } as CandidateKnowledgeRunStore;
}

/** A synthetic knowledge base in a local store that the hosted opener serves by reference. */
async function knowledgeStore(directory: string): Promise<string> {
  const storeRoot = join(directory, "store");
  const sourcePath = join(directory, "career.md");
  await writeFile(
    sourcePath,
    "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services with deterministic testing.\n",
  );
  const ids = ["hosted-store", "hosted-ckb", "hosted-source", "hosted-version"];
  const service = createCandidateKnowledgeStoreService({
    generateId: () => ids.shift() ?? "unexpected-id",
    now: () => "2026-10-21T10:00:00.000Z",
  });
  await service.initializeStore({ storeRoot });
  await service.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId: "hosted-ckb", sourcePath });
  return storeRoot;
}

/** A hosted service with one fixture run awaiting approval, drafted from a reviewed brief. */
async function awaitingApprovalRun() {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-hosted-"));
  scratch.push(directory);
  await mkdir(join(directory, "history"));
  const storeRoot = await knowledgeStore(directory);
  const opened: string[] = [];
  const service = createApplicationService(
    createHostedApplicationDriver({
      settings: memorySettings(),
      storage: scratchHistory(join(directory, "history")),
      openKnowledgeStore: async (reference) => {
        opened.push(reference);
        if (reference !== storeReference) throw new Error(`unknown store ${reference}`);
        return runOnlyCandidateKnowledgeStore(
          runOperationsOf(await openCandidateKnowledgeStore(storeRoot)),
        );
      },
    }),
  );
  await service.initialize(
    { root: workspace, jobDescription: "job.md", sources: "sources", fixtureMode: true },
    silent,
  );
  await service.configureKnowledgeSelection(
    {
      root: workspace,
      entries: [
        { storeRoot: storeReference, storeId: "hosted-store", knowledgeBaseId: "hosted-ckb" },
      ],
    },
    silent,
  );
  const brief = await service.createOpportunity({
    root: workspace,
    sources: [
      {
        id: "posting",
        kind: "pasted-content",
        classification: "job-posting",
        content:
          "Platform Engineer at Example Ledger\n\nRequirements:\n- Build TypeScript services\n- Practise deterministic testing\n",
      },
    ],
  });
  const edited = await service.editOpportunity({
    root: workspace,
    briefId: brief.brief.id,
    expectedVersion: brief.brief.version,
    patch: {
      role: { value: "Platform Engineer", sourceIds: ["posting"] },
      requirements: [
        {
          id: "typescript-services",
          text: "Build TypeScript services with deterministic testing",
          priority: "critical",
          sourceIds: ["posting"],
        },
      ],
    },
  });
  const reviewed = await service.reviewOpportunity({
    root: workspace,
    briefId: brief.brief.id,
    expectedVersion: edited.brief.version,
  });
  const begun = await service.begin(
    {
      root: workspace,
      opportunityBrief: { briefId: reviewed.brief.id, version: reviewed.brief.version },
    },
    silent,
  );
  const resumed = await service.resume({ root: workspace, runId: begun.runId }, silent);
  return { service, begun, resumed, opened };
}

describe("hosted application driver", () => {
  it("runs a fixture round from a reviewed brief without touching the workspace reference", async () => {
    const { service, begun, resumed, opened } = await awaitingApprovalRun();
    const status = await service.status({ root: workspace, runId: begun.runId }, silent);

    expect(begun.state).toBe("drafting");
    expect(resumed.state).toBe("awaiting-approval");
    expect(status?.state).toBe("awaiting-approval");
    expect(new Set(opened)).toEqual(new Set([storeReference]));
    await expect(access("/tenants")).rejects.toThrow();
  }, 120_000);

  it("reads a run's review: the draft, its findings and the recorded independence", async () => {
    const { service, resumed } = await awaitingApprovalRun();

    const review = await service.readRunReview?.({ root: workspace, runId: resumed.runId });

    expect(review?.snapshot.state).toBe("awaiting-approval");
    expect(review?.draft?.version).toBe(resumed.artifact?.version);
    expect(review?.draft?.sections.length).toBeGreaterThan(0);
    expect(
      review?.draft?.sections.flatMap((section) => section.blocks).every((block) => !block.edited),
    ).toBe(true);
    expect(review?.findings).toHaveLength(resumed.findings.length);
    for (const finding of review?.findings ?? []) {
      expect(finding.id.startsWith(`${resumed.runId}:finding:`)).toBe(true);
      expect(finding.decision).toBe("pending");
    }
    expect(review?.independentReview).not.toBeNull();
    expect(review?.readiness).not.toBeNull();
    await expect(
      service.readRunReview?.({ root: workspace, runId: "missing" }),
    ).resolves.toBeUndefined();
  }, 120_000);

  it("records the owner's finding decisions and block edits in the review", async () => {
    const { service, resumed } = await awaitingApprovalRun();
    const before = await service.readRunReview?.({ root: workspace, runId: resumed.runId });
    const block = before?.draft?.sections[0]?.blocks[0];
    const finding = before?.findings[0];
    expect(block).toBeDefined();

    await service.recordReviewDecision({
      root: workspace,
      runId: resumed.runId,
      kind: "edit",
      targetId: block?.id ?? "",
      replacementText: "Built TypeScript services with deterministic tests.",
    });
    if (finding !== undefined) {
      await service.recordReviewDecision({
        root: workspace,
        runId: resumed.runId,
        kind: "finding",
        targetId: finding.id,
        decision: "accepted",
      });
    }
    const after = await service.readRunReview?.({ root: workspace, runId: resumed.runId });

    const edited = after?.draft?.sections[0]?.blocks[0];
    expect(edited).toMatchObject({
      id: block?.id,
      text: "Built TypeScript services with deterministic tests.",
      edited: true,
    });
    if (finding !== undefined) expect(after?.findings[0]?.decision).toBe("accepted");
  }, 120_000);

  it("refuses a decision on an unknown run, finding or block", async () => {
    const { service, resumed } = await awaitingApprovalRun();
    const decide = (runId: string, targetId: string) =>
      service.recordReviewDecision({
        root: workspace,
        runId,
        kind: "finding",
        targetId,
        decision: "rejected",
      });

    await expect(decide("missing", "missing:finding:0")).rejects.toMatchObject({
      code: "run_not_found",
    });
    await expect(
      decide(resumed.runId, `${resumed.runId}:finding:0000000000000000:99:unknown`),
    ).rejects.toMatchObject({ code: "review_target_not_found" });
    await expect(
      service.recordReviewDecision({
        root: workspace,
        runId: resumed.runId,
        kind: "edit",
        targetId: "missing-block",
        replacementText: "Synthetic text.",
      }),
    ).rejects.toMatchObject({ code: "review_target_not_found" });
  }, 120_000);

  it("refuses the methods it does not offer yet", async () => {
    const driver = createHostedApplicationDriver({
      settings: memorySettings(),
      storage: scratchHistory(tmpdir()),
      openKnowledgeStore: async () => {
        throw new Error("unexpected open");
      },
    });

    await expect(driver.export({ root: workspace, format: "markdown" }, silent)).rejects.toThrow(
      "export is not available in the hosted service yet.",
    );
  });
});
