import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderArtifact } from "@draft-loop/rendering";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { assertExportRenderingQa } from "./export-qa.js";
import { createLocalApplicationDriver } from "./local.js";

const generatedAt = "2026-08-30T10:00:00.000Z";

function sampleArtifact() {
  return {
    schemaVersion: 1 as const,
    id: "export-qa-artifact",
    version: 1,
    parentVersionId: null,
    createdAt: generatedAt,
    language: "en" as const,
    sections: [
      {
        id: "summary",
        title: "Summary",
        kind: "summary" as const,
        order: 0,
        blocks: [
          { id: "summary-1", type: "paragraph" as const, text: "Reliable systems.", claimIds: [] },
        ],
      },
    ],
    claims: [],
    decisions: [],
  };
}

describe("application export rendering QA", () => {
  it("rejects a tampered rendered document before an output can be written", () => {
    const artifact = sampleArtifact();
    const rendered = renderArtifact(artifact, "pdf", { generatedAt });
    const content = rendered.content.slice(0, -24);
    const tampered = {
      ...rendered,
      content,
      metadata: {
        ...rendered.metadata,
        checksum: createHash("sha256").update(content).digest("hex"),
      },
    };
    expect(() => assertExportRenderingQa(artifact, tampered)).toThrow(/PDF|QA|marker|end/u);
  });

  it("runs bounded QA for approved PDF/DOCX exports and persists the content-free report", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-export-qa-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Synthetic evidence\n", "utf8");
      const io = { write: () => undefined };
      const driver = createLocalApplicationDriver();
      const workspace = await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        io,
      );
      const started = await driver.start({ root, allowProviderData: false }, io);
      await driver.lifecycle({ root, runId: started.runId, action: "revision" }, io);
      await driver.resume({ root, runId: started.runId, allowProviderData: false }, io);
      const approved = await driver.lifecycle(
        { root, runId: started.runId, action: "approve" },
        io,
      );
      expect(approved.state).toBe("approved");

      const pdfPath = await driver.export({ root, runId: started.runId, format: "pdf" }, io);
      const docxPath = await driver.export({ root, runId: started.runId, format: "docx" }, io);
      expect((await stat(pdfPath)).isFile()).toBe(true);
      expect((await stat(docxPath)).isFile()).toBe(true);
      expect((await readFile(pdfPath)).byteLength).toBeGreaterThan(0);
      expect((await readFile(docxPath)).byteLength).toBeGreaterThan(0);

      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const exports = await storage.listExports(started.runId);
        expect(exports).toHaveLength(2);
        for (const record of exports) {
          expect(record.workspaceId).toBe(workspace.id);
          expect(record.payload).toMatchObject({
            format: record.format,
            approved: true,
            renderingQa: { complete: true, passed: true },
          });
          expect(JSON.stringify(record.payload)).not.toContain("Synthetic evidence");
        }
      } finally {
        await storage.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
