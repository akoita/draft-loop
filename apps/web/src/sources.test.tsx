import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiSchemas } from "./api-client.js";
import { SourcesPanel, type SourcesPanelProps } from "./sources.js";

const base = (id: string, displayName: string): ApiSchemas["KnowledgeBase"] => ({
  id,
  displayName,
  description: "",
  state: "active",
  createdAt: "2026-10-23T00:00:00.000Z",
  archivedAt: null,
});

const props: SourcesPanelProps = {
  bases: [base("kb-1", "Career material"), base("kb-2", "Project notes")],
  sources: {
    "kb-1": [
      {
        id: "source-1",
        knowledgeBaseId: "kb-1",
        displayName: "career.md",
        kind: "file",
        versionId: "version-1",
        mediaType: "text/markdown",
        sizeBytes: 12_800,
        checksum: "0".repeat(64),
        createdAt: "2026-10-23T00:00:00.000Z",
      },
    ],
  },
  selected: ["kb-1"],
  savedSelection: ["kb-1"],
  combinationApproved: false,
  messages: [],
  busy: false,
  onCreateBase: () => {},
  onUpload: () => {},
  onToggle: () => {},
  onApproveCombination: () => {},
  onSaveSelection: () => {},
};

describe("sources screen", () => {
  it("lists bases with their files and which runs use", () => {
    const html = renderToStaticMarkup(<SourcesPanel {...props} />);

    expect(html).toContain("<strong>Career material</strong>");
    expect(html).toContain('career.md <span class="muted">13 KB</span>');
    expect(html).toContain("No files yet.");
    expect(html).toContain('accept=".pdf,.docx,.md,.markdown,.txt"');
    expect(html).toContain("Runs use the ticked bases");
    expect(html).not.toContain("combine the material");
  });

  it("asks before combining bases and offers to save a changed choice", () => {
    const html = renderToStaticMarkup(
      <SourcesPanel {...props} selected={["kb-1", "kb-2"]} messages={["big.pdf is too large."]} />,
    );

    expect(html).toContain("Runs may combine the material of these knowledge bases");
    expect(html).toContain("Use the ticked bases for runs");
    expect(html).toContain('role="alert">big.pdf is too large.</p>');
  });

  it("asks for the storage consent above the uploads", () => {
    const html = renderToStaticMarkup(<SourcesPanel {...props} consent={<p>Storage consent</p>} />);

    expect(html.indexOf("Storage consent")).toBeGreaterThan(-1);
    expect(html.indexOf("Storage consent")).toBeLessThan(html.indexOf("Add files"));
  });

  it("starts with a base to create", () => {
    const html = renderToStaticMarkup(<SourcesPanel {...props} bases={[]} />);

    expect(html).toContain("No knowledge base yet.");
    expect(html).toContain('<label for="new-base">New knowledge base</label>');
  });
});
