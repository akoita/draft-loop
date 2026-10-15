import { describe, expect, it } from "vitest";

import { adjudicatedRevisionTraceSchema, revisionFindingClassificationSchema } from "./index.js";

function decision(findingId: string, disposition: "accept" | "reject") {
  return {
    findingId,
    origin: "deterministic",
    code: "claim-change",
    severity: "error",
    target: { kind: "claim", id: "claim-1" },
    recommendedAction: "Update the claim from the supplied evidence.",
    rationale: "The author reviewed the finding.",
    disposition,
    effectRequirement: disposition === "accept" ? "revision-required" : "disagreement-preserved",
  };
}

const diff = {
  addedClaimIds: [],
  removedClaimIds: [],
  changedClaimIds: ["claim-1"],
  changedEvidenceClaimIds: [],
  addedSectionIds: [],
  removedSectionIds: [],
  changedSectionIds: [],
};

function trace(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    adjudication: {
      schemaVersion: 1,
      contextSnapshotId: "context-1",
      sourceReport: {
        schemaVersion: 1,
        createdAt: "2026-08-25T10:00:00.000Z",
        artifact: { id: "artifact-1", version: 1 },
      },
      sourceArtifact: { id: "artifact-1", version: 1 },
      createdAt: "2026-08-25T10:05:00.000Z",
      decisions: [decision("finding-1", "accept"), decision("finding-2", "reject")],
    },
    revisedArtifact: { id: "artifact-2", version: 2, parentVersionId: "artifact-1" },
    createdAt: "2026-08-25T10:06:00.000Z",
    diff,
    effects: [
      { findingId: "finding-1", status: "verified" },
      { findingId: "finding-2", status: "disagreement-preserved" },
    ],
    valid: true,
    ...overrides,
  };
}

function attribution(overrides: Record<string, unknown> = {}) {
  return {
    findings: [
      { findingId: "finding-1", findingIdentity: "claim-change|claim|summary#0/b0" },
      { findingId: "finding-2", findingIdentity: "claim-change|claim|summary#0/b0" },
    ],
    blocks: [
      {
        blockKey: "summary#0/b0",
        blockId: "block-1",
        change: "changed",
        findingIds: ["finding-1"],
      },
    ],
    unattributedFindingIds: [],
    ...overrides,
  };
}

const attributed = (overrides: Record<string, unknown> = {}) =>
  trace({ schemaVersion: 2, attribution: attribution(), ...overrides });

const parses = (value: unknown): boolean => adjudicatedRevisionTraceSchema.safeParse(value).success;

describe("adjudicated revision trace versions", () => {
  it("still parses a version 1 trace without attribution", () => {
    const parsed = adjudicatedRevisionTraceSchema.parse(trace());
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.attribution).toBeUndefined();
  });

  it("parses a version 2 trace and keeps its attribution", () => {
    const parsed = adjudicatedRevisionTraceSchema.parse(attributed());
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.attribution?.blocks[0]?.findingIds).toEqual(["finding-1"]);
  });

  it("rejects attribution on version 1 and a version 2 trace without it", () => {
    expect(parses(trace({ attribution: attribution() }))).toBe(false);
    expect(parses(trace({ schemaVersion: 2 }))).toBe(false);
    expect(parses(trace({ schemaVersion: 3 }))).toBe(false);
  });

  it("requires accepted findings to be attributed to a block or listed as unattributed", () => {
    expect(parses(attributed({ attribution: attribution({ blocks: [] }) }))).toBe(false);
    expect(
      parses(attributed({ attribution: attribution({ unattributedFindingIds: ["finding-1"] }) })),
    ).toBe(false);
    expect(
      parses(
        attributed({
          attribution: attribution({ blocks: [], unattributedFindingIds: ["finding-1"] }),
        }),
      ),
    ).toBe(true);
  });

  it("accepts a changed block that no accepted finding targeted", () => {
    const unclaimed = { blockKey: "skills#0/b0", blockId: "b", change: "added", findingIds: [] };
    const blocks = [...attribution().blocks, unclaimed];
    expect(parses(attributed({ attribution: attribution({ blocks }) }))).toBe(true);
  });

  it("rejects attribution of rejected or unknown findings and an incomplete identity list", () => {
    const block = { blockKey: "a", blockId: "b", change: "changed" };
    for (const bad of [
      attribution({ blocks: [{ ...block, findingIds: ["finding-1", "finding-2"] }] }),
      attribution({ blocks: [{ ...block, findingIds: ["finding-9"] }] }),
      attribution({ findings: [{ findingId: "finding-1", findingIdentity: "x|claim|y" }] }),
    ]) {
      expect(parses(attributed({ attribution: bad }))).toBe(false);
    }
  });

  it("rejects unknown fields and duplicate block keys", () => {
    const block = { blockKey: "a", blockId: "b", change: "changed", findingIds: ["finding-1"] };
    expect(parses(attributed({ attribution: attribution({ blocks: [block, block] }) }))).toBe(
      false,
    );
    expect(
      parses(attributed({ attribution: attribution({ blocks: [{ ...block, text: "leak" }] }) })),
    ).toBe(false);
  });
});

describe("revision finding classification schema", () => {
  const classification = {
    schemaVersion: 1,
    reviewedArtifact: { id: "artifact-2", version: 2 },
    findings: [
      { status: "resolved", findingId: "f-1", findingIdentity: "a|claim|b", severity: "error" },
      {
        status: "persisting",
        findingId: "f-2",
        findingIdentity: "c|claim|d",
        severity: "warning",
        currentFindingId: "critic:0:c-1",
      },
      { status: "new", findingId: "critic:1:c-2", findingIdentity: "e|claim|f", severity: "error" },
    ],
    summary: { resolved: 1, persisting: 1, new: 1 },
  };

  it("parses a consistent classification", () => {
    expect(revisionFindingClassificationSchema.parse(classification)).toEqual(classification);
  });

  it("rejects a summary that disagrees with the entries", () => {
    expect(
      revisionFindingClassificationSchema.safeParse({
        ...classification,
        summary: { resolved: 2, persisting: 1, new: 0 },
      }).success,
    ).toBe(false);
  });

  it("names a current finding only for persisting entries", () => {
    const [resolved, persisting, added] = classification.findings;
    const parsesWith = (findings: unknown[]): boolean =>
      revisionFindingClassificationSchema.safeParse({ ...classification, findings }).success;
    expect(parsesWith([{ ...resolved, currentFindingId: "x" }, persisting, added])).toBe(false);
    expect(parsesWith([resolved, { ...persisting, currentFindingId: undefined }, added])).toBe(
      false,
    );
  });
});
