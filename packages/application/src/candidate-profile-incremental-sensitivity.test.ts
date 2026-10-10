import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CanonicalCandidateProfileExtractionIdentity,
  type CanonicalCandidateProfileSensitivityIdentity,
  createCandidateKnowledgeSelectionSnapshot,
} from "@draft-loop/domain";
import type { SourceSensitivityRule } from "@draft-loop/domain/source-sensitivity";
import { openSqliteStorage } from "@draft-loop/storage";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCanonicalCandidateProfile } from "./candidate-profile.js";
import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import type { CanonicalCandidateProfileExtractionMaterial } from "./candidate-profile-extraction.js";
import {
  currentSensitivityIdentity,
  planIncrementalCanonicalProfileExtraction,
} from "./candidate-profile-incremental.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";

const createdAt = "2026-08-28T08:00:00.000Z";
const route: CanonicalCandidateProfileExtractionIdentity = {
  company: "mistral",
  modelId: "synthetic-model",
  promptTemplateVersion: "synthetic-extraction-v1",
};
const bases = ["kb-1", "kb-2"] as const;

function rulesEntry(knowledgeBaseId: string, rulesVersion = 1, digit = "a") {
  return { storeId: "store-1", knowledgeBaseId, rulesVersion, rulesChecksum: digit.repeat(64) };
}

function lifecycleRevision(versionId: string) {
  return {
    knowledgeBaseState: "active" as const,
    knowledgeBaseArchivedAt: null,
    versionId,
    version: 1,
    createdAt,
    managed: true,
    originBoundAt: createdAt,
    observation: null,
    retirement: null,
    provenanceFetchedAt: null,
    directory: null,
  };
}

const snapshot = createCandidateKnowledgeSelectionSnapshot({
  capturedAt: createdAt,
  entries: bases.map((knowledgeBaseId) => ({
    storeId: "store-1",
    knowledgeBaseId,
    sources: [
      {
        sourceId: `source-${knowledgeBaseId}`,
        versionId: `version-${knowledgeBaseId}`,
        lifecycleRevision: lifecycleRevision(`version-${knowledgeBaseId}`),
      },
    ],
  })),
});

const materials: readonly CanonicalCandidateProfileExtractionMaterial[] = bases.map(
  (knowledgeBaseId) => ({
    id: `source-${knowledgeBaseId}`,
    mediaType: "text/markdown",
    checksum: "c".repeat(64),
    text: "Allowed synthetic skill line.",
    reference: {
      storeId: "store-1",
      knowledgeBaseId,
      sourceId: `source-${knowledgeBaseId}`,
      versionId: `version-${knowledgeBaseId}`,
      kind: "candidate-provided",
    },
  }),
);

function latestWith(sensitivity: CanonicalCandidateProfileSensitivityIdentity | undefined) {
  const profile = buildCanonicalCandidateProfile({
    id: "profile-1",
    version: 1,
    parentVersion: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    candidateKnowledgeSelection: snapshot,
    extraction: sensitivity === undefined ? route : { ...route, sensitivity },
    facts: materials.map((material) => ({
      id: `fact-${material.reference.knowledgeBaseId}`,
      category: "skill",
      field: "skill",
      value: "Synthetic",
      provenance: [material.reference],
    })),
    issues: [],
  });
  return { workspaceId: "workspace-1", profile, checksum: "d".repeat(64) };
}

const defaultTiers = ["sensitive", "never-share"] as const;

/** Source ids the plan sends for extraction, given the previous and the current filtering. */
function extractedFor(
  previous: CanonicalCandidateProfileSensitivityIdentity | undefined,
  current: CanonicalCandidateProfileSensitivityIdentity,
): string[] {
  return planIncrementalCanonicalProfileExtraction({
    latest: latestWith(previous),
    identity: route,
    fullExtraction: false,
    snapshot,
    materials,
    sensitivity: current,
  }).materials.map((material) => material.reference.knowledgeBaseId);
}

describe("incremental planning with sensitivity rules", () => {
  const filtered = { excludedTiers: [...defaultTiers], rules: [rulesEntry("kb-1")] };

  it("reuses a filtered knowledge base when its rules and the excluded tiers match", () => {
    expect(extractedFor(filtered, filtered)).toEqual([]);
  });

  it.each([
    ["checksum", { ...filtered, rules: [rulesEntry("kb-1", 1, "b")] }],
    ["version", { ...filtered, rules: [rulesEntry("kb-1", 2)] }],
    ["rules removed", { ...filtered, rules: [] }],
    ["narrowed tiers", { ...filtered, excludedTiers: ["never-share" as const] }],
    [
      "widened tiers",
      { excludedTiers: ["normal" as const, ...defaultTiers], rules: filtered.rules },
    ],
  ])("extracts the filtered knowledge base again when the %s changed", (_name, current) => {
    expect(extractedFor(filtered, current)).toEqual(["kb-1"]);
  });

  it("extracts a knowledge base whose rules were added since the last version", () => {
    expect(extractedFor({ excludedTiers: [...defaultTiers], rules: [] }, filtered)).toEqual([
      "kb-1",
    ]);
  });

  it("keeps reusing knowledge bases without rules when the tiers change", () => {
    const unfiltered = { excludedTiers: [...defaultTiers], rules: [] };
    expect(extractedFor(unfiltered, { ...unfiltered, excludedTiers: ["never-share"] })).toEqual([]);
  });

  it("reuses the other knowledge bases when only one knowledge base's rules changed", () => {
    const both = {
      excludedTiers: [...defaultTiers],
      rules: [rulesEntry("kb-1"), rulesEntry("kb-2")],
    };
    expect(
      extractedFor(both, { ...both, rules: [rulesEntry("kb-1", 1, "b"), rulesEntry("kb-2")] }),
    ).toEqual(["kb-1"]);
  });

  it("extracts a filtered knowledge base fully from a version recorded without sensitivity", () => {
    expect(extractedFor(undefined, filtered)).toEqual(["kb-1"]);
    expect(extractedFor(undefined, { ...filtered, rules: [] })).toEqual([]);
  });

  it("orders the current record by tier, then store and knowledge base", () => {
    const record = currentSensitivityIdentity(new Set(["never-share", "normal"]), [
      {
        storeId: "store-2",
        knowledgeBaseId: "kb-1",
        rulesVersion: 1,
        rulesChecksum: "a".repeat(64),
      },
      {
        storeId: "store-1",
        knowledgeBaseId: "kb-2",
        rulesVersion: 1,
        rulesChecksum: "a".repeat(64),
      },
      {
        storeId: "store-1",
        knowledgeBaseId: "kb-1",
        rulesVersion: 1,
        rulesChecksum: "a".repeat(64),
      },
    ]);
    expect(record.excludedTiers).toEqual(["normal", "never-share"]);
    expect(record.rules.map((rule) => `${rule.storeId}/${rule.knowledgeBaseId}`)).toEqual([
      "store-1/kb-1",
      "store-1/kb-2",
      "store-2/kb-1",
    ]);
    expect(currentSensitivityIdentity(undefined, []).excludedTiers).toEqual([...defaultTiers]);
  });
});

describe("derivation records and reuses sensitivity filtering", () => {
  const allowedLine = "Allowed synthetic skill line.";
  const text = `# Profile\n${allowedLine}\n\n## Compensation\nSYNTHETIC-NEVER-SHARE-MARKER detail.\n`;
  const rules: readonly SourceSensitivityRule[] = [
    {
      id: "r-never",
      tier: "never-share",
      match: { kind: "heading-contains", text: "compensation" },
    },
  ];
  let directory: string;
  let storage: ReturnType<typeof openSqliteStorage>;
  let rulesRecord: { version: number; checksum: string; createdAt: string; rules: typeof rules };
  let extractCalls: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-sensitivity-reuse-"));
    storage = openSqliteStorage(join(directory, "workspace.sqlite"));
    await storage.saveWorkspace({
      id: "workspace-1",
      state: "collecting",
      createdAt,
      updatedAt: createdAt,
    });
    rulesRecord = { version: 1, checksum: "b".repeat(64), createdAt, rules };
    extractCalls = 0;
  });

  afterEach(async () => {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  });

  const selected = createCandidateKnowledgeSelectionSnapshot({
    capturedAt: createdAt,
    entries: [
      {
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        sources: [
          {
            sourceId: "source-1",
            versionId: "version-1",
            lifecycleRevision: lifecycleRevision("version-1"),
          },
        ],
      },
    ],
  });
  const bytes = new TextEncoder().encode(text);
  const handle = {
    descriptor: { schemaVersion: 1, id: "store-1", createdAt },
    getCandidateKnowledgeSourceSensitivityRules: vi.fn(async () => rulesRecord),
    readManagedCandidateKnowledgeSourceVersion: vi.fn(async () => ({
      metadata: {
        knowledgeBaseId: "knowledge-1",
        kind: "file",
        id: "version-1",
        sourceId: "source-1",
        version: 1,
        parentVersionId: null,
        mediaType: "text/markdown",
        checksum: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
        createdAt,
      },
      bytes,
    })),
    close: vi.fn(async () => undefined),
  } as unknown as CandidateKnowledgeStoreHandle;
  const persistence = () => createCanonicalCandidateProfilePersistenceService(storage);

  function derive(excludedSensitivityTiers?: ReadonlySet<"sensitive" | "never-share">) {
    return createCanonicalCandidateProfileDerivationService({
      persistence: persistence(),
      extractionIdentity: route,
      extractor: {
        extract: (request) => {
          extractCalls += 1;
          const source = request.sources[0];
          return {
            schemaVersion: 1,
            facts: [
              {
                key: "skill-1",
                category: "skill",
                field: "skill",
                value: allowedLine,
                evidence: [{ sourceId: source?.id ?? "", quote: allowedLine }],
              },
            ],
            issues: [],
          };
        },
      },
      knowledgeService: { createKnowledgeSelectionSnapshot: vi.fn(async () => selected) },
      openKnowledgeStore: async () => handle,
      now: () => createdAt,
    }).deriveCanonicalCandidateProfile({
      workspaceId: "workspace-1",
      profileId: "profile-1",
      selections: [{ storeRoot: "/private/store", knowledgeBaseId: "knowledge-1" }],
      allowProviderData: true,
      ...(excludedSensitivityTiers === undefined ? {} : { excludedSensitivityTiers }),
    });
  }

  it("persists the rules and tiers, reuses on a match, and extracts again after a rules change", async () => {
    const first = await derive();
    expect(first.profile.extraction?.sensitivity).toEqual({
      excludedTiers: ["sensitive", "never-share"],
      rules: [
        {
          storeId: "store-1",
          knowledgeBaseId: "knowledge-1",
          rulesVersion: 1,
          rulesChecksum: "b".repeat(64),
        },
      ],
    });
    expect(first).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 1 });

    const second = await derive();
    expect(second).toMatchObject({ reusedSourceCount: 1, extractedSourceCount: 0 });
    expect(extractCalls).toBe(1);

    rulesRecord = { ...rulesRecord, version: 2, checksum: "e".repeat(64) };
    const third = await derive();
    expect(third).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 1 });
    expect(third.profile.extraction?.sensitivity?.rules[0]?.rulesVersion).toBe(2);

    const narrowed = await derive(new Set(["never-share"]));
    expect(narrowed).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 1 });
    expect(narrowed.profile.extraction?.sensitivity?.excludedTiers).toEqual(["never-share"]);
  });

  it("keeps the sensitivity record on edited and reviewed versions that a later derivation reuses", async () => {
    const first = await derive();
    // The derived version carries open issues; clear them so it can be reviewed.
    const edited = await persistence().editLatestCanonicalCandidateProfile({
      workspaceId: "workspace-1",
      profileId: "profile-1",
      expectedVersion: first.profile.version,
      updatedAt: createdAt,
      patch: { issues: [] },
    });
    const reviewed = await persistence().reviewLatestCanonicalCandidateProfile({
      workspaceId: "workspace-1",
      profileId: "profile-1",
      expectedVersion: edited.profile.version,
      reviewedAt: createdAt,
    });
    for (const version of [edited, reviewed]) {
      expect(version.profile.extraction?.sensitivity).toEqual(
        first.profile.extraction?.sensitivity,
      );
    }

    const next = await derive();
    expect(next).toMatchObject({ reusedSourceCount: 1, extractedSourceCount: 0 });
    expect(extractCalls).toBe(1);
  });
});
