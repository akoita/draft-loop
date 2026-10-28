import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { findBulletFragment } from "./bullet-fragment.js";
import { validateDraftArtifact } from "./index.js";

describe("findBulletFragment", () => {
  it("flags a lowercase start", () => {
    expect(
      findBulletFragment("reconciliation between exchanges, ledgers and reports")?.reason,
    ).toBe("lowercase-start");
  });

  it("flags a dangling connector, comma or semicolon", () => {
    for (const text of [
      "Built the billing service with",
      "Built the billing service and",
      "Owned monitoring for the release of",
      "Migrated storage to.",
      "Built the billing service,",
      "Built the billing service;",
    ]) {
      expect(findBulletFragment(text)?.reason, text).toBe("dangling-connector");
    }
  });

  it("flags separate statements joined by a semicolon and quotes the join", () => {
    const text =
      "Led the routing team of four engineers; shipped the new depot planner in two quarters.";
    const fragment = findBulletFragment(text);
    expect(fragment?.reason).toBe("semicolon-stitch");
    expect(fragment?.quote).toContain(";");
    expect(text.slice(fragment?.start, fragment?.end)).toBe(fragment?.quote);
  });

  it("accepts a semicolon that separates short list items", () => {
    expect(
      findBulletFragment("Owned Python; Go and Rust services for the billing platform."),
    ).toBeUndefined();
  });

  it("accepts a known lowercase name, a mixed-case token and a normal bullet", () => {
    for (const text of [
      "iOS release automation cut review time across three teams.",
      "gRPC services replaced polling between the billing components.",
      "npm packages were published through a signed pipeline.",
      "dbt Fundamentals, dbt Labs, March 2025",
      "k8s clusters were upgraded without downtime.",
      "Built a billing service with retries and audit logs.",
      "Designed the platform to scale.",
      "2024 migration of the ledger to a new database.",
      "Shipped a feature that handled the sort order.",
    ]) {
      expect(findBulletFragment(text), text).toBeUndefined();
    }
  });
});

function artifactWith(type: "bullet" | "paragraph", text: string): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt: "2026-08-12T10:00:00.000Z",
    language: "en",
    sections: [
      {
        id: "section-core",
        title: "Core areas",
        kind: "alignment",
        order: 0,
        blocks: [{ id: "block-1", type, text, claimIds: ["claim-1"] }],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text,
        sectionId: "section-core",
        blockId: "block-1",
        substantive: true,
        status: "verified",
        evidence: [{ sourcePath: "/local/evidence.txt", excerpt: text }],
      },
    ],
    decisions: [],
  };
}

const context = { requirements: [], outputConstraints: { requiredSections: [] } };

describe("bullet fragment finding", () => {
  it("warns on a fragment bullet", () => {
    const result = validateDraftArtifact(
      artifactWith("bullet", "reconciliation between exchanges, ledgers"),
      context,
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "editorial-fragment",
        category: "quality",
        severity: "warning",
        sectionId: "section-core",
        blockId: "block-1",
      }),
    ]);
  });

  it("asks for one statement per bullet when a bullet stitches facts with a semicolon", () => {
    const result = validateDraftArtifact(
      artifactWith(
        "bullet",
        "Led the routing team of four engineers; shipped the new depot planner in two quarters.",
      ),
      context,
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "editorial-fragment",
        message: expect.stringMatching(/^bullet joins separate facts with a semicolon; .*"/u),
      }),
    ]);
  });

  it("does not fire on a complete bullet or on a paragraph block", () => {
    expect(
      validateDraftArtifact(
        artifactWith("bullet", "iOS release automation for two teams."),
        context,
      ).issues,
    ).toEqual([]);
    expect(
      validateDraftArtifact(
        artifactWith("paragraph", "reconciliation between exchanges, and"),
        context,
      ).issues,
    ).toEqual([]);
  });
});
