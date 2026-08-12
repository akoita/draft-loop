import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./index.js";

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
});
