import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  exportLengthWarningLine,
  exportLengthWarningPrefix,
  pageOverflowWarningLine,
  parseExportFormat,
} from "./export-document.js";

function artifactWithBullets(count: number): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-length",
    version: 1,
    parentVersionId: null,
    createdAt: "2026-10-15T09:00:00.000Z",
    language: "en",
    sections: [
      {
        id: "experience",
        title: "Experience",
        kind: "experience",
        order: 0,
        blocks: Array.from({ length: count }, (_, index) => ({
          id: `bullet-${index}`,
          type: "bullet" as const,
          text: `Delivered outcome ${index} with measurable impact for the team.`,
          claimIds: [],
        })),
      },
    ],
    claims: [],
    decisions: [],
  };
}

function readerWithPolicy(pageTarget: string | undefined) {
  return {
    getContextSnapshot: async () => ({
      payload: {
        schemaVersion: 1,
        id: "context-1",
        workspaceId: "workspace-1",
        createdAt: "2026-10-15T09:00:00.000Z",
        jobDescription: "Role",
        requirements: [],
        evidence: [],
        writingPolicy: {
          content: "policy",
          checksum: "a".repeat(64),
          version: "v1",
          ...(pageTarget === undefined ? {} : { preferences: { pageTarget } }),
        },
      },
    }),
  };
}

describe("export format names", () => {
  it("accepts md as the short spelling of markdown", () => {
    expect(parseExportFormat("md")).toBe("markdown");
    expect(parseExportFormat("Markdown")).toBe("markdown");
    expect(parseExportFormat("DOCX")).toBe("docx");
    expect(parseExportFormat("pdf")).toBe("pdf");
    expect(parseExportFormat("rtf")).toBeUndefined();
  });
});

describe("export length warning", () => {
  const long = { contextSnapshotId: "context-1", artifact: artifactWithBullets(100) };

  it("warns, as an estimate, when the content clearly exceeds the policy's page target", async () => {
    const line = await exportLengthWarningLine(readerWithPolicy("one-page"), long);
    expect(line?.startsWith(exportLengthWarningPrefix)).toBe(true);
    expect(line).toContain("estimate");
    expect(line).toContain("1-page target");
  });

  it("says nothing without a page target, when it fits, or when the context cannot be read", async () => {
    expect(await exportLengthWarningLine(readerWithPolicy(undefined), long)).toBeUndefined();
    expect(await exportLengthWarningLine(readerWithPolicy("two-page"), long)).toBeUndefined();
    expect(
      await exportLengthWarningLine(readerWithPolicy("one-page"), {
        contextSnapshotId: "context-1",
        artifact: artifactWithBullets(3),
      }),
    ).toBeUndefined();
    expect(
      await exportLengthWarningLine(
        {
          getContextSnapshot: async () => {
            throw new Error("unreadable");
          },
        },
        long,
      ),
    ).toBeUndefined();
  });
});

describe("PDF page overflow warning", () => {
  it("names the real page count and the layout's target, and replaces the estimate", async () => {
    const standard = { pageCount: 4, targetPageCount: 2, layoutName: "standard" };
    expect(pageOverflowWarningLine(standard)).toBe(
      "Length warning: The PDF runs to 4 pages; the standard layout targets 2 pages.",
    );
    expect(
      pageOverflowWarningLine({ pageCount: 2, targetPageCount: 1, layoutName: "compact" }),
    ).toBe("Length warning: The PDF runs to 2 pages; the compact layout targets 1 page.");
    const long = { contextSnapshotId: "context-1", artifact: artifactWithBullets(70) };
    expect(await exportLengthWarningLine(readerWithPolicy("one-page"), long, standard)).toBe(
      pageOverflowWarningLine(standard),
    );
  });
});
