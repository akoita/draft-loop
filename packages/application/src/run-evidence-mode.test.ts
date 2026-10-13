import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JsonValue, openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { createApplicationService } from "./index.js";
import { createLocalApplicationDriver, readWorkspace } from "./local.js";
import { parseRunEvidenceModePayload, readRunEvidenceMode } from "./run-evidence-mode.js";

describe("run evidence mode reader", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function workspace(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-run-evidence-mode-"));
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
        id: `evidence-mode:${runId}:${sequence}`,
        workspaceId,
        eventType: eventType ?? "run.evidence-mode",
        entityType: "run",
        entityId: runId,
        payload,
        createdAt: "2026-10-14T10:00:00.000Z",
      });
    } finally {
      await storage.close();
    }
  }

  const fullSource = {
    requestedMode: "full-source",
    effectiveMode: "full-source",
    chunkCount: 181,
    sourceCount: 1,
    serializedCharacterCount: 90_000,
    budgetCharacters: 240_000,
  };

  it("reads the recorded full-source mode with its chunk and source counts", async () => {
    const root = await workspace();
    await record(root, "run-a", fullSource);
    await expect(readRunEvidenceMode({ root, runId: "run-a" })).resolves.toEqual({
      requestedMode: "full-source",
      effectiveMode: "full-source",
      chunkCount: 181,
      sourceCount: 1,
    });
  });

  it("reads a fallback to retrieval with its reason", async () => {
    const root = await workspace();
    await record(root, "run-a", {
      ...fullSource,
      effectiveMode: "retrieval",
      fallbackReason: "budget-exceeded",
    });
    await expect(readRunEvidenceMode({ root, runId: "run-a" })).resolves.toEqual({
      requestedMode: "full-source",
      effectiveMode: "retrieval",
      chunkCount: 181,
      sourceCount: 1,
      fallbackReason: "budget-exceeded",
    });
  });

  it("reads an older event that has no source count", async () => {
    const { sourceCount: _omitted, ...older } = fullSource;
    expect(parseRunEvidenceModePayload(older)).toEqual({
      requestedMode: "full-source",
      effectiveMode: "full-source",
      chunkCount: 181,
    });
  });

  it("is undefined when the run recorded no evidence mode", async () => {
    const root = await workspace();
    await record(root, "run-a", { requestedMode: "lexical" }, "run.retrieval-mode");
    await expect(readRunEvidenceMode({ root, runId: "run-a" })).resolves.toBeUndefined();
    await expect(readRunEvidenceMode({ root })).resolves.toBeUndefined();
  });

  it("is undefined when the payload is malformed", async () => {
    const root = await workspace();
    await record(root, "run-a", { ...fullSource, effectiveMode: "everything" });
    await expect(readRunEvidenceMode({ root, runId: "run-a" })).resolves.toBeUndefined();
    await record(root, "run-b", "not an object");
    await expect(readRunEvidenceMode({ root, runId: "run-b" })).resolves.toBeUndefined();
  });

  it("picks this run's latest event among several runs", async () => {
    const root = await workspace();
    await record(root, "run-a", { ...fullSource, chunkCount: 10 });
    await record(root, "run-b", { ...fullSource, chunkCount: 20, sourceCount: 2 });
    await record(root, "run-a", { ...fullSource, chunkCount: 11 });
    await expect(readRunEvidenceMode({ root, runId: "run-a" })).resolves.toMatchObject({
      chunkCount: 11,
      sourceCount: 1,
    });
    await expect(readRunEvidenceMode({ root, runId: "run-b" })).resolves.toMatchObject({
      chunkCount: 20,
      sourceCount: 2,
    });
  });

  it("is offered by the local driver through the application service", async () => {
    const root = await workspace();
    await record(root, "run-a", fullSource);
    const service = createApplicationService(createLocalApplicationDriver());
    await expect(service.readRunEvidenceMode?.({ root, runId: "run-a" })).resolves.toMatchObject({
      effectiveMode: "full-source",
      chunkCount: 181,
    });
  });
});
