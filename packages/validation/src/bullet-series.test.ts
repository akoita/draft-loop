import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { findBulletSeries } from "./bullet-series.js";
import { validateDraftArtifact } from "./index.js";

const full = (label: string) =>
  `${label} the billing service with retries, audit logs and a documented rollback path, ` +
  "coordinating three engineers and cutting incident volume across the quarterly release cycle " +
  "for the finance and operations teams.";
const short = (label: string) => `Built ${label} tooling.`;

type Spec = readonly ["bullet" | "paragraph", string];

function blocks(specs: readonly Spec[]) {
  return specs.map(([type, text], index) => ({ id: `block-${index + 1}`, type, text }));
}

function artifactWith(specs: readonly Spec[]): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt: "2026-08-12T10:00:00.000Z",
    language: "en",
    sections: [
      {
        id: "section-experience",
        title: "Experience",
        kind: "experience",
        order: 0,
        blocks: blocks(specs).map((block) => ({ ...block, claimIds: [] })),
      },
    ],
    claims: [],
    decisions: [],
  };
}

const bullets = (count: number, text: (index: number) => string): Spec[] =>
  Array.from({ length: count }, (_, index) => ["bullet", text(index)] as const);

describe("findBulletSeries", () => {
  it("flags more than four consecutive full bullets once, at the first block", () => {
    const findings = findBulletSeries(blocks(bullets(6, (index) => full(`Built ${index}`))));
    expect(findings).toEqual([expect.objectContaining({ reason: "long-run", blockId: "block-1" })]);
  });

  it("flags a section of four or more all one-line bullets", () => {
    const findings = findBulletSeries(blocks(bullets(4, (index) => short(String(index)))));
    expect(findings).toEqual([
      expect.objectContaining({ reason: "short-section", blockId: "block-1" }),
    ]);
  });

  it("flags two adjacent bullets when either is under about thirty words, once per run", () => {
    const specs: Spec[] = [
      ["paragraph", "Context paragraph."],
      ["bullet", full("Built one")],
      ["bullet", short("two")],
      ["bullet", full("Built three")],
      ["paragraph", "Another paragraph."],
      ["bullet", full("Built four")],
    ];
    expect(findBulletSeries(blocks(specs))).toEqual([
      expect.objectContaining({ reason: "short-adjacent", blockId: "block-2" }),
    ]);
  });

  it("does not flag four full bullets, a lone short bullet or bullets split by paragraphs", () => {
    expect(findBulletSeries(blocks(bullets(4, (index) => full(`Built ${index}`))))).toEqual([]);
    expect(findBulletSeries(blocks([["bullet", short("one")]]))).toEqual([]);
    const interleaved: Spec[] = [
      ["bullet", short("one")],
      ["paragraph", "A labelled paragraph: items."],
      ["bullet", short("two")],
      ["paragraph", "Another paragraph."],
      ["bullet", short("three")],
      ["paragraph", "Closing paragraph."],
      ["bullet", short("four")],
    ];
    expect(findBulletSeries(blocks(interleaved))).toEqual([]);
  });
});

describe("dense bullet series finding", () => {
  it("is a quality warning anchored to the first block of the run", () => {
    const result = validateDraftArtifact(
      artifactWith(bullets(5, (index) => full(`Built ${index}`))),
      { requirements: [], outputConstraints: { requiredSections: [] } },
    );
    const dense = result.issues.filter((issue) => issue.code === "dense-bullet-series");
    expect(dense).toEqual([
      expect.objectContaining({
        category: "quality",
        severity: "warning",
        sectionId: "section-experience",
        blockId: "block-1",
      }),
    ]);
    expect(result.valid).toBe(true);
  });
});
