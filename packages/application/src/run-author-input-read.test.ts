import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JsonValue, openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { createApplicationService } from "./index.js";
import { createLocalApplicationDriver, readWorkspace } from "./local.js";
import { readRunAuthorInput } from "./run-author-input-read.js";

describe("run author input reader", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function workspace(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-run-author-input-"));
    roots.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "Deliver synthetic platform work.\n", "utf8");
    await writeFile(join(root, "evidence", "resume.md"), "Delivered synthetic work.\n", "utf8");
    await createLocalApplicationDriver().initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      { write: () => undefined },
    );
    return root;
  }

  let sequence = 0;
  async function record(root: string, runId: string, payload: JsonValue, eventType?: string) {
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      sequence += 1;
      const workspaceId = (await readWorkspace(root)).id;
      if ((await storage.getWorkspace(workspaceId)) === undefined) {
        const createdAt = "2026-10-14T10:00:00.000Z";
        await storage.saveWorkspace({
          id: workspaceId,
          state: "collecting",
          createdAt,
          updatedAt: createdAt,
        });
      }
      await storage.appendAuditEvent({
        id: `author-input:${runId}:${sequence}`,
        workspaceId,
        eventType: eventType ?? "run.author-input",
        entityType: "run",
        entityId: runId,
        payload,
        createdAt: "2026-10-14T10:00:00.000Z",
      });
    } finally {
      await storage.close();
    }
  }

  const roundOne = {
    round: 1,
    sentChunkCount: 12,
    sentFactCount: 3,
    knowledgeChunkCount: 181,
    knowledgeFactCount: 40,
    unmatchedRequirementIds: ["req-2"],
  };

  it("reads this run's latest author input among several runs", async () => {
    const root = await workspace();
    await record(root, "run-a", roundOne);
    await record(root, "run-b", { ...roundOne, sentChunkCount: 99 });
    await record(root, "run-a", { ...roundOne, round: 2, unmatchedRequirementIds: [] });
    await expect(readRunAuthorInput({ root, runId: "run-a" })).resolves.toEqual({
      ...roundOne,
      round: 2,
      unmatchedRequirementIds: [],
    });
    await expect(readRunAuthorInput({ root, runId: "run-b" })).resolves.toMatchObject({
      sentChunkCount: 99,
    });
  });

  it("is undefined when the run recorded no author input", async () => {
    const root = await workspace();
    await record(root, "run-a", { requestedMode: "full-source" }, "run.evidence-mode");
    await expect(readRunAuthorInput({ root, runId: "run-a" })).resolves.toBeUndefined();
    await expect(readRunAuthorInput({ root })).resolves.toBeUndefined();
  });

  it("is undefined when the payload is malformed", async () => {
    const root = await workspace();
    await record(root, "run-a", { ...roundOne, sentChunkCount: -1 });
    await expect(readRunAuthorInput({ root, runId: "run-a" })).resolves.toBeUndefined();
    await record(root, "run-b", "not an object");
    await expect(readRunAuthorInput({ root, runId: "run-b" })).resolves.toBeUndefined();
  });

  it("is undefined when the workspace has no run history yet", async () => {
    const root = await workspace();
    await rm(join(root, ".draft-loop", "history.sqlite"), { force: true });
    await expect(readRunAuthorInput({ root, runId: "run-a" })).resolves.toBeUndefined();
  });

  it("is offered by the local driver through the application service", async () => {
    const root = await workspace();
    await record(root, "run-a", roundOne);
    const service = createApplicationService(createLocalApplicationDriver());
    await expect(service.readRunAuthorInput?.({ root, runId: "run-a" })).resolves.toEqual(roundOne);
  });
});
