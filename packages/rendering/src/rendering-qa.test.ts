import { createHash } from "node:crypto";

import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  buildRenderingQaReport,
  computeArtifactContentChecksum,
  defaultLayoutProfileId,
  extractTextFromRenderedDocument,
  renderArtifact,
  renderHtml,
  renderingLayoutProfiles,
} from "./index.js";

const generatedAt = "2026-08-26T10:00:00.000Z";
const checksum = (content: Uint8Array): string =>
  createHash("sha256").update(content).digest("hex");

function littleEndian(value: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let remaining = value >>> 0;
  for (let index = 0; index < length; index += 1) {
    bytes[index] = remaining & 0xff;
    remaining >>>= 8;
  }
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function storedZip(entries: Readonly<Record<string, string>>): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const valueBytes = encoder.encode(value);
    const header = concatBytes(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      littleEndian(20, 2),
      new Uint8Array(8),
      littleEndian(crc32(valueBytes), 4),
      littleEndian(valueBytes.length, 4),
      littleEndian(valueBytes.length, 4),
      littleEndian(nameBytes.length, 2),
      littleEndian(0, 2),
      nameBytes,
      valueBytes,
    );
    local.push(header);
    central.push(
      concatBytes(
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
        littleEndian(20, 2),
        littleEndian(20, 2),
        new Uint8Array(8),
        littleEndian(crc32(valueBytes), 4),
        littleEndian(valueBytes.length, 4),
        littleEndian(valueBytes.length, 4),
        littleEndian(nameBytes.length, 2),
        new Uint8Array(6),
        littleEndian(0, 4),
        littleEndian(offset, 4),
        nameBytes,
      ),
    );
    offset += header.length;
  }
  const localBytes = concatBytes(...local);
  const centralBytes = concatBytes(...central);
  return concatBytes(
    localBytes,
    centralBytes,
    new Uint8Array([
      0x50,
      0x4b,
      0x05,
      0x06,
      0,
      0,
      0,
      0,
      central.length & 0xff,
      (central.length >>> 8) & 0xff,
      central.length & 0xff,
      (central.length >>> 8) & 0xff,
      centralBytes.length & 0xff,
      (centralBytes.length >>> 8) & 0xff,
      (centralBytes.length >>> 16) & 0xff,
      (centralBytes.length >>> 24) & 0xff,
      localBytes.length & 0xff,
      (localBytes.length >>> 8) & 0xff,
      (localBytes.length >>> 16) & 0xff,
      (localBytes.length >>> 24) & 0xff,
      0,
      0,
    ]),
  );
}

function withContent(
  rendered: ReturnType<typeof renderArtifact>,
  content: Uint8Array,
  metadata: Partial<ReturnType<typeof renderArtifact>["metadata"]> = {},
) {
  return {
    ...rendered,
    content,
    metadata: { ...rendered.metadata, checksum: checksum(content), ...metadata },
  };
}

function artifact(overrides: Partial<DraftArtifact> = {}): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-qa",
    version: 1,
    parentVersionId: null,
    createdAt: generatedAt,
    language: "en",
    sections: [
      {
        id: "summary",
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          { id: "summary-1", type: "paragraph", text: "TypeScript engineer.", claimIds: [] },
        ],
      },
      {
        id: "experience",
        title: "Experience",
        kind: "experience",
        order: 1,
        blocks: [
          { id: "experience-1", type: "bullet", text: "Built reliable systems.", claimIds: [] },
          { id: "experience-2", type: "bullet", text: "Built reliable systems.", claimIds: [] },
        ],
      },
    ],
    claims: [],
    decisions: [],
    ...overrides,
  };
}

describe("controlled layout profiles and rendering QA", () => {
  it("uses an immutable standard profile by default and changes presentation by profile", () => {
    const sample = artifact();
    const options = { generatedAt, layoutProfile: defaultLayoutProfileId } as const;
    const standard = renderArtifact(sample, "pdf", options);
    const compact = renderArtifact(sample, "pdf", {
      generatedAt,
      layoutProfile: "compact-one-page",
    });

    expect(standard.metadata.layoutProfile).toBe("standard-two-page");
    expect(standard.metadata.sourceContentChecksum).toBe(computeArtifactContentChecksum(sample));
    expect(standard.metadata.checksum).toBe(
      renderArtifact(sample, "pdf", options).metadata.checksum,
    );
    expect(compact.metadata.layoutProfile).toBe("compact-one-page");
    expect(compact.metadata.checksum).not.toBe(standard.metadata.checksum);
    expect(extractTextFromRenderedDocument(compact)).toContain("Built reliable systems.");
    expect(extractTextFromRenderedDocument(compact)).toBe(
      extractTextFromRenderedDocument(standard),
    );
    expect(renderHtml(sample, { layoutProfile: "compact-one-page" })).not.toBe(
      renderHtml(sample, { layoutProfile: "standard-two-page" }),
    );
    expect(Object.isFrozen(renderingLayoutProfiles)).toBe(true);
    expect(Object.isFrozen(renderingLayoutProfiles["compact-one-page"])).toBe(true);
    expect(() =>
      renderArtifact(sample, "pdf", {
        layoutProfile: "uncontrolled" as never,
      }),
    ).toThrow(/unknown.*layout profile/i);
    expect(() =>
      renderArtifact(sample, "pdf", {
        templateVersion: "uncontrolled",
      } as never),
    ).toThrow(/unknown render option/i);
  });

  it("builds a content-free Markdown report with exact integrity signals", () => {
    const sample = artifact();
    const rendered = renderArtifact(sample, "markdown", { generatedAt });
    const report = buildRenderingQaReport({ artifact: sample, rendered, createdAt: generatedAt });

    expect(report.deterministicPassed).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.viewerObservation).toBeNull();
    expect(report.contentIntegrity.expectedVisibleContentCount).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain("TypeScript engineer");
    expect(JSON.stringify(report)).not.toContain("sourcePath");
    expect(report.deterministicPageCount).toBeNull();
    expect(report.limitations).toEqual([
      "deterministic-page-count-not-assessed",
      "structured-images-unsupported",
      "structured-links-unsupported",
    ]);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.contentIntegrity)).toBe(true);
  });

  it("keeps PDF and DOCX incomplete without independent viewer evidence", () => {
    const sample = artifact();
    for (const format of ["pdf", "docx"] as const) {
      const rendered = renderArtifact(sample, format, { generatedAt });
      const report = buildRenderingQaReport({ artifact: sample, rendered, createdAt: generatedAt });
      expect(report.complete).toBe(false);
      expect(report.passed).toBe(false);
      expect(report.viewerObservation).toBeNull();
    }
  });

  it("accepts a bounded passing viewer observation and rejects visual failures", () => {
    const sample = artifact();
    const rendered = renderArtifact(sample, "pdf", { generatedAt });
    const deterministic = buildRenderingQaReport({
      artifact: sample,
      rendered,
      createdAt: generatedAt,
    });
    const pageCount = deterministic.deterministicPageCount ?? 1;
    const observation = {
      renderedChecksum: rendered.metadata.checksum,
      viewerName: "Independent PDF Inspector",
      viewerVersion: "1.0.0",
      recoveredVisibleContentChecksum:
        deterministic.contentIntegrity.expectedVisibleContentChecksum,
      recoveredVisibleContentCount: deterministic.contentIntegrity.expectedVisibleContentCount,
      recoveredVisibleContentOrder: "preserved" as const,
      pageCount,
      blankPageNumbers: [],
      overflowPageNumbers: [],
      orphanSectionIds: [],
      clippedText: false,
    };
    const report = buildRenderingQaReport({
      artifact: sample,
      rendered,
      createdAt: generatedAt,
      viewerObservation: observation,
    });
    expect(report.complete).toBe(true);
    expect(report.passed).toBe(true);
    expect(
      buildRenderingQaReport({
        artifact: sample,
        rendered,
        createdAt: generatedAt,
        viewerObservation: { ...observation, overflowPageNumbers: [pageCount] },
      }).passed,
    ).toBe(false);
  });

  it("rejects stale bindings, chronology, unknown fields, null observations, and orphan ids", () => {
    const sample = artifact();
    const rendered = renderArtifact(sample, "markdown", { generatedAt });
    expect(() =>
      buildRenderingQaReport({
        artifact: sample,
        rendered: withContent(rendered, rendered.content, {
          sourceContentChecksum: checksum(new TextEncoder().encode("different source")),
        }),
        createdAt: generatedAt,
      }),
    ).toThrow(/source content checksum/i);
    expect(() =>
      buildRenderingQaReport({
        artifact: { ...sample, id: "different-artifact" },
        rendered,
        createdAt: generatedAt,
      }),
    ).toThrow(/artifact identity/i);
    expect(() =>
      buildRenderingQaReport({ artifact: sample, rendered, createdAt: "2026-08-26T09:59:00.000Z" }),
    ).toThrow(/createdAt/i);
    expect(() =>
      buildRenderingQaReport({
        artifact: sample,
        rendered,
        createdAt: generatedAt,
        viewerObservation: null as never,
      }),
    ).toThrow();
    expect(() =>
      buildRenderingQaReport({
        artifact: sample,
        rendered: withContent(rendered, rendered.content, { templateVersion: "old-template" }),
        createdAt: generatedAt,
      }),
    ).toThrow(/template version/i);
    expect(() =>
      buildRenderingQaReport({
        artifact: sample,
        rendered,
        createdAt: generatedAt,
        unexpected: true,
      } as never),
    ).toThrow(/unknown rendering QA input field/i);

    const pdf = renderArtifact(sample, "pdf", { generatedAt });
    const deterministic = buildRenderingQaReport({
      artifact: sample,
      rendered: pdf,
      createdAt: generatedAt,
    });
    const pageCount = deterministic.deterministicPageCount ?? 1;
    const viewer = {
      renderedChecksum: pdf.metadata.checksum,
      viewerName: "Independent PDF Inspector",
      viewerVersion: "1.0.0",
      recoveredVisibleContentChecksum:
        deterministic.contentIntegrity.expectedVisibleContentChecksum,
      recoveredVisibleContentCount: deterministic.contentIntegrity.expectedVisibleContentCount,
      recoveredVisibleContentOrder: "preserved" as const,
      pageCount,
      blankPageNumbers: [],
      overflowPageNumbers: [],
      orphanSectionIds: ["missing-section"],
      clippedText: false,
    };
    expect(() =>
      buildRenderingQaReport({
        artifact: sample,
        rendered: pdf,
        createdAt: generatedAt,
        viewerObservation: viewer,
      }),
    ).toThrow(/orphan section/i);
  });

  it("binds declared formats to their byte containers and viewer page counts", () => {
    const sample = artifact();
    const markdown = renderArtifact(sample, "markdown", { generatedAt });
    const declaredPdf = {
      ...markdown,
      extension: ".pdf" as const,
      mimeType: "application/pdf",
      metadata: { ...markdown.metadata, format: "pdf" as const },
    };
    expect(() =>
      buildRenderingQaReport({ artifact: sample, rendered: declaredPdf, createdAt: generatedAt }),
    ).toThrow(/PDF content/i);

    const pdf = renderArtifact(sample, "pdf", { generatedAt });
    const deterministic = buildRenderingQaReport({
      artifact: sample,
      rendered: pdf,
      createdAt: generatedAt,
    });
    const pageCount = deterministic.deterministicPageCount ?? 1;
    const observation = {
      renderedChecksum: pdf.metadata.checksum,
      viewerName: "Independent PDF Inspector",
      viewerVersion: "1.0.0",
      recoveredVisibleContentChecksum:
        deterministic.contentIntegrity.expectedVisibleContentChecksum,
      recoveredVisibleContentCount: deterministic.contentIntegrity.expectedVisibleContentCount,
      recoveredVisibleContentOrder: "preserved" as const,
      pageCount: pageCount + 1,
      blankPageNumbers: [],
      overflowPageNumbers: [],
      orphanSectionIds: [],
      clippedText: false,
    };
    expect(() =>
      buildRenderingQaReport({
        artifact: sample,
        rendered: pdf,
        createdAt: generatedAt,
        viewerObservation: observation,
      }),
    ).toThrow(/pageCount/i);
  });

  it("keeps literal candidate markers inert and detects structural active content", () => {
    const literalMarkdownArtifact = artifact({
      id: "artifact-literal-markdown",
      sections: [
        {
          id: "summary",
          title: "Summary",
          kind: "summary",
          order: 0,
          blocks: [
            {
              id: "summary-1",
              type: "paragraph",
              text: "Documented javascript: syntax and the equation online = available.",
              claimIds: [],
            },
          ],
        },
      ],
    });
    const literalMarkdown = buildRenderingQaReport({
      artifact: literalMarkdownArtifact,
      rendered: renderArtifact(literalMarkdownArtifact, "markdown", { generatedAt }),
      createdAt: generatedAt,
    });
    expect(literalMarkdown.activeContent.detected).toBe(false);

    const literalPdfArtifact = artifact({
      id: "artifact-literal-pdf",
      sections: [
        {
          id: "summary",
          title: "Summary",
          kind: "summary",
          order: 0,
          blocks: [
            {
              id: "summary-1",
              type: "paragraph",
              text: "Literal /OpenAction and /JavaScript markers.",
              claimIds: [],
            },
          ],
        },
      ],
    });
    const literalPdf = buildRenderingQaReport({
      artifact: literalPdfArtifact,
      rendered: renderArtifact(literalPdfArtifact, "pdf", { generatedAt }),
      createdAt: generatedAt,
    });
    expect(literalPdf.activeContent.detected).toBe(false);
    expect(literalPdf.deterministicPassed).toBe(true);
    expect(literalPdf.contentIntegrity.visibleContentMatches).toBe(true);

    const pdf = renderArtifact(artifact(), "pdf", { generatedAt });
    const pdfText = new TextDecoder().decode(pdf.content);
    const structuralPdf = new TextEncoder().encode(
      pdfText.replace(
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>",
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction 9 0 R >>",
      ),
    );
    const activePdf = buildRenderingQaReport({
      artifact: artifact(),
      rendered: withContent(pdf, structuralPdf),
      createdAt: generatedAt,
    });
    expect(activePdf.activeContent.signatures).toContain("pdf-open-action");
    expect(activePdf.deterministicPassed).toBe(false);

    const literalDocxArtifact = artifact({
      id: "artifact-literal-docx",
      sections: [
        {
          id: "summary",
          title: "Summary",
          kind: "summary",
          order: 0,
          blocks: [
            {
              id: "summary-1",
              type: "paragraph",
              text: "Literal externalLink marker.",
              claimIds: [],
            },
          ],
        },
      ],
    });
    const literalDocx = buildRenderingQaReport({
      artifact: literalDocxArtifact,
      rendered: renderArtifact(literalDocxArtifact, "docx", { generatedAt }),
      createdAt: generatedAt,
    });
    expect(literalDocx.activeContent.detected).toBe(false);

    const activeDocxArtifact = artifact({
      id: "artifact-active-docx",
      sections: [
        {
          id: "summary",
          title: "Summary",
          kind: "summary",
          order: 0,
          blocks: [
            { id: "summary-1", type: "paragraph", text: "External relationship.", claimIds: [] },
          ],
        },
      ],
    });
    const activeDocxBase = renderArtifact(activeDocxArtifact, "docx", { generatedAt });
    const activeDocxContent = storedZip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml":
        '<w:document xmlns:w="urn:w"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Summary</w:t></w:r></w:p><w:p><w:r><w:t>External relationship.</w:t></w:r></w:p></w:body></w:document>',
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test" TargetMode="External"/></Relationships>',
    });
    const activeDocx = buildRenderingQaReport({
      artifact: activeDocxArtifact,
      rendered: withContent(activeDocxBase, activeDocxContent),
      createdAt: generatedAt,
    });
    expect(activeDocx.activeContent.signatures).toContain("docx-external-link");
    expect(activeDocx.deterministicPassed).toBe(false);
  });

  it("reports exact tampering, active content, Unicode loss, and compact overflow", () => {
    const sample = artifact();
    const markdown = renderArtifact(sample, "markdown", { generatedAt });
    const originalText = new TextDecoder().decode(markdown.content);
    const reordered = originalText
      .replace("## Summary", "## Temporary")
      .replace("## Experience", "## Summary");
    const reorderedContent = new TextEncoder().encode(
      reordered.replace("## Temporary", "## Experience"),
    );
    const tampered = {
      ...markdown,
      content: reorderedContent,
      metadata: {
        ...markdown.metadata,
        checksum: checksum(reorderedContent),
      },
    };
    expect(
      buildRenderingQaReport({ artifact: sample, rendered: tampered, createdAt: generatedAt })
        .deterministicPassed,
    ).toBe(false);

    const activeContent = new TextEncoder().encode(`${originalText}\n<script>alert(1)</script>\n`);
    const active = {
      ...markdown,
      content: activeContent,
      metadata: { ...markdown.metadata, checksum: checksum(activeContent) },
    };
    expect(
      buildRenderingQaReport({ artifact: sample, rendered: active, createdAt: generatedAt })
        .deterministicPassed,
    ).toBe(false);

    const unicode = artifact({
      id: "artifact-unicode-qa",
      sections: [
        {
          id: "unicode",
          title: "Résumé",
          kind: "summary",
          order: 0,
          blocks: [{ id: "unicode-1", type: "paragraph", text: "Élève — façade.", claimIds: [] }],
        },
      ],
    });
    const unicodeReport = buildRenderingQaReport({
      artifact: unicode,
      rendered: renderArtifact(unicode, "pdf", { generatedAt }),
      createdAt: generatedAt,
    });
    expect(unicodeReport.deterministicPassed).toBe(false);
    expect(unicodeReport.contentIntegrity.visibleContentMatches).toBe(false);

    const longArtifact = artifact({
      id: "artifact-overflow-qa",
      sections: [
        {
          id: "long",
          title: "Experience",
          kind: "experience",
          order: 0,
          blocks: Array.from({ length: 90 }, (_, index) => ({
            id: `long-${index}`,
            type: "paragraph" as const,
            text: `Line ${index} preserves every word and punctuation mark.`,
            claimIds: [],
          })),
        },
      ],
    });
    const overflow = buildRenderingQaReport({
      artifact: longArtifact,
      rendered: renderArtifact(longArtifact, "pdf", {
        generatedAt,
        layoutProfile: "compact-one-page",
      }),
      createdAt: generatedAt,
    });
    expect(overflow.deterministicPageCount).toBeGreaterThan(1);
    expect(overflow.deterministicPassed).toBe(false);
  });
});
