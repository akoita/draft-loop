import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createLocalApplicationDriver, readWorkspace } from "./local.js";
import { writeWorkspaceEvidenceMode } from "./workspace-evidence-mode.js";

const candidateMarkdown = [
  "# Fictional Candidate",
  "",
  ...Array.from(
    { length: 25 },
    (_, index) => `Synthetic delivery ${index} for an invented client.\n`,
  ),
].join("\n");

/** The mode is read when a run begins and again when it resumes, never cached between them. */
describe("full-source evidence in a run", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function workspace() {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-full-source-run-"));
    roots.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "Deliver synthetic platform work.\n", "utf8");
    await writeFile(join(root, "evidence", "resume.md"), "Delivered synthetic work.\n", "utf8");
    const storeRoot = join(root, "candidate-store");
    const candidatePath = join(root, "candidate.md");
    await writeFile(candidatePath, candidateMarkdown, "utf8");
    const ids = ["fs-store", "fs-ckb", "fs-source", "fs-version"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => "2026-08-23T10:00:00.000Z",
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: "fs-ckb",
      sourcePath: candidatePath,
    });
    const driver = createLocalApplicationDriver();
    const silent = { write: () => undefined };
    await driver.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    await driver.configureKnowledgeSelection(
      { root, entries: [{ storeRoot, storeId: "fs-store", knowledgeBaseId: "fs-ckb" }] },
      silent,
    );
    return { root, driver };
  }

  async function auditEvents(root: string, runId: string) {
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const workspaceId = (await readWorkspace(root)).id;
      return (await storage.listAuditEvents(workspaceId)).filter(
        (event) => event.eventType === "run.evidence-mode" && event.entityId === runId,
      );
    } finally {
      await storage.close();
    }
  }

  const modeLine = /^Evidence mode: full-source \(26 eligible chunks, \d+ of 240000 characters\)$/u;

  it("stays silent in the default retrieval mode", async () => {
    const { root, driver } = await workspace();
    const lines: string[] = [];
    const begun = await driver.begin(
      { root, allowProviderData: false },
      { write: (line) => lines.push(line) },
    );
    expect(lines.some((line) => line.startsWith("Evidence mode:"))).toBe(false);
    expect(await auditEvents(root, begun.runId)).toEqual([]);
  });

  it("shows the mode and chunk count at begin and records it in run history", async () => {
    const { root, driver } = await workspace();
    await writeWorkspaceEvidenceMode(root, "full-source");
    const lines: string[] = [];
    const begun = await driver.begin(
      { root, allowProviderData: false },
      { write: (line) => lines.push(line) },
    );
    expect(lines.filter((line) => modeLine.test(line))).toHaveLength(1);
    expect(lines).toContain(
      "retrieval: status=matched indexedChunks=26 selectedChunks=26 selectedSources=1",
    );
    const events = await auditEvents(root, begun.runId);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      requestedMode: "full-source",
      effectiveMode: "full-source",
      chunkCount: 26,
      budgetCharacters: 240000,
    });
  });

  it("reads the mode again when the run resumes", async () => {
    const { root, driver } = await workspace();
    const begun = await driver.begin(
      { root, allowProviderData: false },
      { write: () => undefined },
    );
    expect(await auditEvents(root, begun.runId)).toEqual([]);

    await writeWorkspaceEvidenceMode(root, "full-source");
    const resumedLines: string[] = [];
    await driver.resume(
      { root, runId: begun.runId, allowProviderData: false },
      { write: (line) => resumedLines.push(line) },
    );
    expect(resumedLines.filter((line) => modeLine.test(line))).toHaveLength(1);
    expect(await auditEvents(root, begun.runId)).toHaveLength(1);

    await writeWorkspaceEvidenceMode(root, "retrieval");
    const retrievalLines: string[] = [];
    await driver.resume(
      { root, runId: begun.runId, allowProviderData: false },
      { write: (line) => retrievalLines.push(line) },
    );
    expect(retrievalLines.some((line) => line.startsWith("Evidence mode:"))).toBe(false);
    expect(await auditEvents(root, begun.runId)).toHaveLength(1);
  });

  it("fails closed at begin and at resume when the setting is corrupt", async () => {
    const { root, driver } = await workspace();
    const begun = await driver.begin(
      { root, allowProviderData: false },
      { write: () => undefined },
    );
    await writeFile(join(root, ".draft-loop", "evidence-mode.json"), "{not json", "utf8");
    await expect(
      driver.begin({ root, allowProviderData: false }, { write: () => undefined }),
    ).rejects.toBeInstanceOf(CliUserError);
    await expect(
      driver.resume(
        { root, runId: begun.runId, allowProviderData: false },
        { write: () => undefined },
      ),
    ).rejects.toBeInstanceOf(CliUserError);
  });
});
