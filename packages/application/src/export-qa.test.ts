import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderArtifact } from "@draft-loop/rendering";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import {
  assertExportRenderingQa,
  buildExportRenderingQa,
  ExportRenderingQaError,
  exportRenderingQaDecision,
} from "./export-qa.js";
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

  describe("page fit versus other rendering failures", () => {
    function longArtifact(bullets: number) {
      const artifact = sampleArtifact();
      const [section] = artifact.sections;
      return {
        ...artifact,
        sections: [
          {
            ...(section as NonNullable<typeof section>),
            blocks: Array.from({ length: bullets }, (_, index) => ({
              id: `bullet-${index}`,
              // Paragraphs: a run of short bullets is drawn as one compact paragraph.
              type: "paragraph" as const,
              text: `Delivered outcome ${index} with measurable impact for the whole team.`,
              claimIds: [],
            })),
          },
        ],
      };
    }

    it("returns a long PDF's honest failed report with the real page count", () => {
      const artifact = longArtifact(260);
      const rendered = renderArtifact(artifact, "pdf", { generatedAt });
      const { report, pageOverflow } = assertExportRenderingQa(artifact, rendered);
      expect(report.passed).toBe(false);
      expect(report.deterministicPageCount).toBeGreaterThan(2);
      expect(pageOverflow).toEqual({
        pageCount: report.deterministicPageCount,
        targetPageCount: 2,
        layoutName: "standard",
      });
    });

    it("reports no overflow for a PDF that fits", () => {
      const artifact = sampleArtifact();
      const rendered = renderArtifact(artifact, "pdf", { generatedAt });
      const result = assertExportRenderingQa(artifact, rendered);
      expect(result.report.passed).toBe(true);
      expect(result.pageOverflow).toBeUndefined();
    });

    it("still refuses every other failure with a path-free user error", () => {
      const artifact = longArtifact(260);
      const report = buildExportRenderingQa(
        artifact,
        renderArtifact(artifact, "pdf", { generatedAt }),
      );
      const observation = report.viewerObservation;
      if (observation === null) throw new Error("expected a PDF viewer observation");
      const failures = {
        incomplete: { ...report, complete: false },
        "block order": {
          ...report,
          contentIntegrity: { ...report.contentIntegrity, blockOrderMatches: false },
        },
        "content count": {
          ...report,
          contentIntegrity: { ...report.contentIntegrity, recoveredVisibleContentCount: 1 },
        },
        "active content": {
          ...report,
          activeContent: { detected: true, signatures: ["pdf-javascript" as const] },
        },
        "missing observation": { ...report, viewerObservation: null },
        "unbound observation": {
          ...report,
          viewerObservation: { ...observation, renderedChecksum: "0".repeat(64) },
        },
        "clipped text": { ...report, viewerObservation: { ...observation, clippedText: true } },
        "blank page": { ...report, viewerObservation: { ...observation, blankPageNumbers: [2] } },
        orphan: {
          ...report,
          viewerObservation: { ...observation, orphanSectionIds: ["summary"] },
        },
        "order lost": {
          ...report,
          viewerObservation: {
            ...observation,
            recoveredVisibleContentOrder: "not-preserved" as const,
          },
        },
        "no page overflow": { ...report, deterministicPageCount: 2 },
      };
      for (const [name, failing] of Object.entries(failures)) {
        let thrown: unknown;
        try {
          exportRenderingQaDecision(failing as typeof report);
        } catch (error) {
          thrown = error;
        }
        expect(thrown, name).toBeInstanceOf(ExportRenderingQaError);
        expect((thrown as Error).message, name).toBe(
          "The PDF export failed rendering checks; no file was written.",
        );
      }
    });
  });

  it("exports a PDF that only runs past the page target, with an honest report and one length line", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-export-overflow-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      const requirements = Array.from(
        { length: 100 },
        (_, index) =>
          `- Requirement ${index}: build reliable synthetic systems for the platform team and document every operational decision for later review by colleagues, ${"and keep every synthetic stakeholder informed through clear written updates, ".repeat(3)}`,
      );
      await writeFile(join(root, "job.md"), `${requirements.join("\n")}\n`, "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Synthetic evidence\n", "utf8");
      const lines: string[] = [];
      const io = { write: (line: string) => void lines.push(line) };
      const driver = createLocalApplicationDriver();
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        io,
      );
      const started = await driver.start({ root, allowProviderData: false }, io);
      await driver.lifecycle({ root, runId: started.runId, action: "revision" }, io);
      await driver.resume({ root, runId: started.runId, allowProviderData: false }, io);
      await driver.lifecycle(
        {
          root,
          runId: started.runId,
          action: "approve",
          readinessOverrideRationale: "Synthetic override: the fixture draft is long on purpose.",
        },
        io,
      );

      const pdfPath = await driver.export({ root, runId: started.runId, format: "pdf" }, io);
      expect((await stat(pdfPath)).isFile()).toBe(true);
      const warnings = lines.filter((line) => line.startsWith("Length warning: "));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(
        /^Length warning: The PDF runs to \d+ pages; the standard layout targets 2 pages\.$/u,
      );

      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const [record] = await storage.listExports(started.runId);
        expect(record?.payload).toMatchObject({
          format: "pdf",
          renderingQa: { complete: true, passed: false, deterministicPassed: false },
        });
      } finally {
        await storage.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

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
      // Without a format, the latest completed export of any format is found.
      const latestAny = await driver.latestExportPath({ root, runId: started.runId });
      expect([pdfPath, docxPath]).toContain(latestAny);
      await expect(
        driver.latestExportPath({ root, runId: started.runId, format: "docx" }),
      ).resolves.toBe(docxPath);

      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const exports = await storage.listExports(started.runId);
        expect(exports).toHaveLength(2);
        for (const record of exports) {
          expect(record.workspaceId).toBe(workspace.id);
          expect(record.payload).toMatchObject({
            format: record.format,
            approved: true,
            renderingTemplate: { id: "modern", version: 1 },
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
