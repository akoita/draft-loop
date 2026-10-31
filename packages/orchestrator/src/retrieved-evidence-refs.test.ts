import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { retrievedEvidenceRefs } from "./retrieved-evidence-refs.js";

describe("retrievedEvidenceRefs", () => {
  it("keeps where each chunk came from and drops its text and checksum", () => {
    const chunk = {
      id: "chunk-1",
      workspaceId: "workspace-1",
      sourceId: "src-cv",
      ordinal: 3,
      lineStart: 10,
      lineEnd: 14,
      checksum: "abc",
      text: "Led the migration of the billing platform.",
      rank: 1,
    } as unknown as ScoredEvidenceChunk;
    const refs = retrievedEvidenceRefs([chunk]);
    expect(refs).toEqual({
      retrievedEvidence: [{ sourceId: "src-cv", lineStart: 10, lineEnd: 14, rank: 1 }],
    });
    expect(JSON.stringify(refs)).not.toContain("billing");
  });

  it("records no member without retrieval, and an empty list when retrieval found nothing", () => {
    expect(retrievedEvidenceRefs(undefined)).toEqual({});
    expect(retrievedEvidenceRefs([])).toEqual({ retrievedEvidence: [] });
  });
});
