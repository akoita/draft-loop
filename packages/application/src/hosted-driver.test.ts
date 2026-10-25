import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunTransitionError } from "@draft-loop/orchestrator";
import { type BlobStoragePort, openSqliteStorage } from "@draft-loop/storage";
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
import { type ApplicationService, createApplicationService } from "./index.js";
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

const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

/** Exported documents kept in memory by location, as a bucket keeps objects by key. */
const exportedDocuments = new Map<string, Uint8Array>();

const memoryBlobs: BlobStoragePort = {
  put: async (location, content) => {
    exportedDocuments.set(location, content);
    return { location, checksum: sha256(content), sizeBytes: content.byteLength };
  },
  get: async ({ location, checksum }) => {
    const content = exportedDocuments.get(location);
    return content !== undefined && sha256(content) === checksum ? content : undefined;
  },
  exists: async ({ location }) => exportedDocuments.has(location),
  delete: async ({ location }) => exportedDocuments.delete(location),
};

/** History kept away from the reference, as a database keeps it: one SQLite file per workspace. */
function scratchHistory(directory: string): StorageFactory {
  return {
    open: async (reference) =>
      openSqliteStorage(join(directory, `${sha256(Buffer.from(reference))}.sqlite`)),
    exportBlobs: memoryBlobs,
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
  const { service, begun, opened } = await begunRun();
  const resumed = await service.resume({ root: workspace, runId: begun.runId }, silent);
  return { service, begun, resumed, opened };
}

/** A hosted service with one approved fixture run, approved past failing checks if it must be. */
async function approvedRun() {
  const ready = await awaitingApprovalRun();
  const approve = (readinessOverrideRationale?: string) =>
    ready.service.lifecycle(
      {
        root: workspace,
        runId: ready.resumed.runId,
        action: "approve",
        ...(readinessOverrideRationale === undefined ? {} : { readinessOverrideRationale }),
      },
      silent,
    );
  await approve().catch(() => approve("Synthetic fixture draft, approved for the test."));
  return ready;
}

/** A hosted service with one fixture run begun and not yet executed, as the API leaves it. */
async function begunRun(prepare?: (service: ApplicationService) => Promise<void>) {
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
  await prepare?.(service);
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
  return { service, begun, opened, created: brief };
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

  it("extracts a fixture workspace's job brief without a provider approval", async () => {
    const { created } = await begunRun();

    expect(created.brief.version).toBe(1);
    expect(created.brief.role).toEqual({
      value: "Platform Engineer at Example Ledger",
      sourceIds: ["posting"],
    });
    expect(created.brief.requirements.map((requirement) => requirement.text)).toEqual([
      "Build TypeScript services",
      "Practise deterministic testing",
    ]);
  });

  it("lists the default application's briefs and runs from the hosted history", async () => {
    const { service, begun } = await begunRun();

    const [defaultApplication, ...others] = await service.listApplications({ root: workspace });

    expect(others).toEqual([]);
    expect(defaultApplication?.isDefault).toBe(true);
    expect(defaultApplication?.briefs).toEqual([
      expect.objectContaining({ latestVersion: 3, status: "reviewed" }),
    ]);
    expect(defaultApplication?.runs.map((run) => run.id)).toEqual([begun.runId]);
    await expect(
      service.getApplication({ root: workspace, applicationId: "default" }),
    ).resolves.toEqual(defaultApplication);
    await expect(access("/tenants")).rejects.toThrow();
  }, 120_000);

  it("keeps a created application's pasted job in its record, then renames, pairs and archives it", async () => {
    const { service, resumed } = await awaitingApprovalRun();

    const created = await service.createApplication({
      root: workspace,
      id: "app-platform",
      name: "Example Ledger platform engineer",
      jobSource: { kind: "pasted-text", text: "  Platform Engineer at Example Ledger\n" },
    });
    expect(created.jobSource).toEqual({
      kind: "stored-text",
      text: "Platform Engineer at Example Ledger",
    });

    const renamed = await service.renameApplication?.({
      root: workspace,
      applicationId: "app-platform",
      name: "Platform engineer",
    });
    const paired = await service.setApplicationModels?.({
      root: workspace,
      applicationId: "app-platform",
      modelProfiles: {
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "standard-openai-critic", version: 1 },
      },
    });
    const chosen = await service.chooseApplicationRun?.({
      root: workspace,
      applicationId: "default",
      runId: resumed.runId,
    });
    const archived = await service.archiveApplication?.({
      root: workspace,
      applicationId: "app-platform",
      archived: true,
    });

    expect(renamed?.name).toBe("Platform engineer");
    expect(paired?.modelProfiles?.author.id).toBe("standard-anthropic-author");
    expect(chosen?.chosenRun?.runId).toBe(resumed.runId);
    expect(archived?.archivedAt).toEqual(expect.any(String));
    expect((await service.listApplications({ root: workspace })).map(({ id }) => id)).toEqual([
      "default",
      "app-platform",
    ]);
    await expect(access("/tenants")).rejects.toThrow();
  }, 120_000);

  it("activates a writing policy given as text, and a run records its version", async () => {
    const policyText = "# Writing policy\n\nKeep each bullet to one sentence.";
    const { service, begun } = await begunRun(async (hosted) => {
      await hosted.configureWritingPolicy({ root: workspace, content: policyText }, silent);
    });

    const active = await service.getWritingPolicy?.({ root: workspace, includeContent: true });
    const versions = await service.listWritingPolicyVersions?.({ root: workspace });
    const recorded = await service.readRunWritingPolicy?.({
      root: workspace,
      runId: begun.runId,
    });

    expect(active?.policy?.content).toBe(policyText);
    expect(versions?.map((version) => version.checksum)).toEqual([active?.checksum]);
    expect(recorded?.effective.checksum).toBe(active?.checksum);
    await expect(access("/tenants")).rejects.toThrow();
  }, 120_000);

  it("refuses a hosted writing policy named by a file path", async () => {
    const { service } = await begunRun();

    await expect(
      service.configureWritingPolicy({ root: workspace, sourcePath: "/etc/hostname" }, silent),
    ).rejects.toThrow("A hosted writing policy comes as text, never a file path.");
    await expect(
      service.configureWritingPolicy({ root: workspace, content: "   " }, silent),
    ).rejects.toThrow("The writing policy is empty.");
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
    // The review screen names each finding's requirement from the run's recorded context.
    const requirements = await service.readRunRequirements?.({
      root: workspace,
      runId: resumed.runId,
    });
    expect(requirements?.length).toBeGreaterThan(0);
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

  it("approves a run without reaching a provider, then refuses review decisions", async () => {
    const { service, resumed } = await awaitingApprovalRun();
    const approve = (readinessOverrideRationale?: string) =>
      service.lifecycle(
        {
          root: workspace,
          runId: resumed.runId,
          action: "approve",
          ...(readinessOverrideRationale === undefined ? {} : { readinessOverrideRationale }),
        },
        silent,
      );

    // A fixture draft may fail the final CV checks; the owner's reason then approves it.
    const approved = await approve().catch(async (error: unknown) => {
      expect(error).toBeInstanceOf(RunTransitionError);
      expect((error as RunTransitionError).code).toBe("readiness_blocked");
      const review = await service.readRunReview?.({ root: workspace, runId: resumed.runId });
      expect(review?.approvalCheck?.applicationReady).toBe(false);
      return approve("Synthetic fixture draft, approved for the test.");
    });

    expect(approved.state).toBe("approved");
    await expect(
      service.recordReviewDecision({
        root: workspace,
        runId: resumed.runId,
        kind: "edit",
        targetId: approved.artifact?.sections[0]?.blocks[0]?.id ?? "",
        replacementText: "Too late.",
      }),
    ).rejects.toMatchObject({ code: "review_closed" });
    await expect(approve()).rejects.toBeInstanceOf(RunTransitionError);
  }, 120_000);

  it("stops a run once, and refuses actions on an unknown run", async () => {
    const { service, resumed } = await awaitingApprovalRun();
    const stop = (runId: string) =>
      service.lifecycle({ root: workspace, runId, action: "stop" }, silent);

    expect((await stop(resumed.runId)).state).toBe("stopped");
    expect((await stop(resumed.runId)).state).toBe("stopped");
    await expect(stop("missing")).rejects.toMatchObject({ code: "run_not_found" });
  }, 120_000);

  it("moves a revision to revising without executing it; a resume drafts the next round", async () => {
    const { service, resumed } = await awaitingApprovalRun();

    const revising = await service.lifecycle(
      {
        root: workspace,
        runId: resumed.runId,
        action: "revision",
        candidateDirection: "Lead with the testing practice.",
      },
      silent,
    );
    const drafted = await service.resume({ root: workspace, runId: resumed.runId }, silent);

    expect(revising).toMatchObject({ state: "revising", round: resumed.round + 1 });
    expect(drafted).toMatchObject({ state: "awaiting-approval", round: resumed.round + 1 });
  }, 120_000);

  it("releases a pause without executing, so a worker's resume continues the run", async () => {
    const { service, begun } = await begunRun();
    const pause = () =>
      service.lifecycle({ root: workspace, runId: begun.runId, action: "pause" }, silent);

    const paused = await pause();
    const released = await service.releasePause?.({ root: workspace, runId: begun.runId });
    const drafted = await service.resume({ root: workspace, runId: begun.runId }, silent);

    expect(paused.state).toBe("paused");
    expect(released).toMatchObject({ state: "drafting", artifact: null });
    expect(drafted.state).toBe("awaiting-approval");
    await expect(
      service.releasePause?.({ root: workspace, runId: begun.runId }),
    ).rejects.toBeInstanceOf(RunTransitionError);
    await expect(
      service.releasePause?.({ root: workspace, runId: "missing" }),
    ).rejects.toMatchObject({
      code: "run_not_found",
    });
  }, 120_000);

  it("exports an approved run under the workspace, a new document each time", async () => {
    const { service, resumed } = await approvedRun();
    const exportAs = (format: "docx" | "markdown") =>
      service.export({ root: workspace, runId: resumed.runId, format }, silent);

    const docxPath = await exportAs("docx");
    const markdownPath = await exportAs("markdown");
    const exports = await service.listRunExports?.({ root: workspace, runId: resumed.runId });
    const status = await service.status({ root: workspace, runId: resumed.runId }, silent);

    expect(docxPath.startsWith(`${workspace}/exports/${resumed.runId}/`)).toBe(true);
    expect(docxPath.endsWith(".docx")).toBe(true);
    expect(markdownPath).not.toBe(docxPath);
    expect(status?.state).toBe("exported");
    expect(exports?.map((entry) => entry.format).sort()).toEqual(["docx", "markdown"]);
    for (const entry of exports ?? []) {
      const content = exportedDocuments.get(entry.location);
      expect(content?.byteLength).toBe(entry.sizeBytes);
      expect(content === undefined ? undefined : sha256(content)).toBe(entry.checksum);
    }
  }, 120_000);

  it("reads an export's verified bytes, and refuses them once they change", async () => {
    const { service, resumed } = await approvedRun();
    await service.export({ root: workspace, runId: resumed.runId, format: "markdown" }, silent);
    const [entry] =
      (await service.listRunExports?.({ root: workspace, runId: resumed.runId })) ?? [];
    const read = (exportId: string) =>
      service.readRunExport?.({ root: workspace, runId: resumed.runId, exportId });

    const verified = await read(entry?.id ?? "");
    exportedDocuments.set(entry?.location ?? "", new TextEncoder().encode("Replaced."));

    expect(verified?.content).toBeDefined();
    expect(sha256(verified?.content ?? new Uint8Array())).toBe(entry?.checksum);
    await expect(read(entry?.id ?? "")).rejects.toMatchObject({ code: "export_integrity" });
    await expect(read("missing")).rejects.toMatchObject({ code: "export_not_found" });
  }, 120_000);

  it("refuses to export a run before approval, or at a path the client names", async () => {
    const { service, resumed } = await awaitingApprovalRun();

    await expect(
      service.export({ root: workspace, runId: resumed.runId, format: "docx" }, silent),
    ).rejects.toBeInstanceOf(RunTransitionError);
    await expect(
      service.export({ root: workspace, runId: "missing", format: "docx" }, silent),
    ).rejects.toMatchObject({ code: "run_not_found" });
    await expect(
      service.export(
        { root: workspace, runId: resumed.runId, format: "docx", outputPath: "../other.docx" },
        silent,
      ),
    ).rejects.toThrow("never an output path");
  }, 120_000);

  it("refuses the methods it does not offer yet", async () => {
    const driver = createHostedApplicationDriver({
      settings: memorySettings(),
      storage: scratchHistory(tmpdir()),
      openKnowledgeStore: async () => {
        throw new Error("unexpected open");
      },
    });

    await expect(
      driver.queryEvidence({ root: workspace, query: "testing" }, silent),
    ).rejects.toThrow("queryEvidence is not available in the hosted service yet.");
  });
});
