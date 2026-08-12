import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  ArtifactExportValidationError,
  renderArtifact,
  renderHtml,
  renderMarkdown,
} from "./index.js";

const artifact: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-fixture",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-12T10:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "experience",
      title: "Experience",
      kind: "experience",
      order: 1,
      blocks: [{ id: "b2", type: "bullet", text: "Built reliable systems.", claimIds: [] }],
    },
    {
      id: "summary",
      title: "Summary",
      kind: "summary",
      order: 0,
      blocks: [{ id: "b1", type: "paragraph", text: "TypeScript engineer.", claimIds: [] }],
    },
  ],
  claims: [],
  decisions: [],
};

describe("Markdown rendering", () => {
  it("renders sections in order and preserves bullet semantics", () => {
    expect(renderMarkdown(artifact)).toBe(
      "## Summary\n\nTypeScript engineer.\n\n## Experience\n\n- Built reliable systems.\n",
    );
  });

  it("renders deterministic PDF and DOCX documents with stable metadata", () => {
    const options = {
      generatedAt: "2026-08-12T10:00:00.000Z",
      requiredSections: ["Summary", "Experience"],
    };
    const pdf = renderArtifact(artifact, "pdf", options);
    const samePdf = renderArtifact(artifact, "pdf", options);
    const docx = renderArtifact(artifact, "docx", options);

    expect(pdf.metadata).toMatchObject({
      artifactId: "artifact-fixture",
      artifactVersion: 1,
      format: "pdf",
      templateVersion: "cv-controlled-v1",
    });
    expect(pdf.metadata.checksum).toBe(samePdf.metadata.checksum);
    expect(new TextDecoder().decode(pdf.content)).toContain("TypeScript engineer.");
    expect(new TextDecoder().decode(docx.content)).toContain("PK");
    expect(docx.content.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  });

  it("escapes the controlled HTML template and blocks layout violations", () => {
    const html = renderHtml({
      ...artifact,
      sections: artifact.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({ ...block, text: "<safe> & stable" })),
      })),
    });
    expect(html).toContain("&lt;safe&gt; &amp; stable");
    expect(() => renderArtifact(artifact, "markdown", { requiredSections: ["Education"] })).toThrow(
      ArtifactExportValidationError,
    );
  });
});
