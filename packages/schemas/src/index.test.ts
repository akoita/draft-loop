import {
  type ContextSnapshotInput,
  createContextSnapshot,
  type ModelConfigurationInput,
} from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import {
  agentContextReferenceSchema,
  candidateKnowledgeBaseSchema,
  candidateKnowledgeBaseStateSchema,
  candidateKnowledgeSelectionSnapshotSchema,
  candidateKnowledgeSourceKindSchema,
  candidateKnowledgeSourceRetirementReasonSchema,
  candidateKnowledgeSourceRetirementSchema,
  candidateKnowledgeSourceSchema,
  candidateKnowledgeSourceVersionSchema,
  candidateKnowledgeStoreSchema,
  candidateProfileSchema,
  contextSnapshotInputSchema,
  contextSnapshotSchema,
  draftArtifactSchema,
  jobRequirementInputSchema,
  modelConfigurationSchema,
  parseContextSnapshot,
  serializeContextSnapshot,
} from "./index.js";

const checksum = "a".repeat(64);

function validInput(): ContextSnapshotInput {
  return {
    schemaVersion: 1,
    id: "snapshot-1",
    workspaceId: "workspace-1",
    createdAt: "2026-08-12T10:00:00.000Z",
    jobDescription: "Build reliable local-first software.",
    requirements: [
      { id: "requirement-1", text: "TypeScript experience", priority: "critical" },
      { id: "requirement-2", text: "Clear technical communication", priority: "high" },
    ],
    candidateInstructions: "Use concise, evidence-backed language.",
    language: "en",
    outputConstraints: {
      format: "markdown",
      maxWords: 800,
      requiredSections: ["Summary", "Experience"],
      tone: "direct",
    },
    truthfulnessPolicy: "Do not add unsupported claims.",
    readinessRubric: {
      relevance: 0.9,
      evidence: 1,
      accuracy: 1,
      differentiation: 0.8,
      clarity: 0.9,
      format: 0.8,
      credibility: 1,
    },
    evidenceManifest: [
      {
        id: "source-1",
        path: "/local/candidate/resume.md",
        mediaType: "text/markdown",
        checksum,
      },
    ],
    modelConfiguration: {
      author: {
        company: "anthropic",
        modelId: "claude-opus-exact",
        role: "author",
        promptTemplateVersion: "author-v1",
      },
      critic: {
        company: "openai",
        modelId: "gpt-exact",
        role: "critic",
        promptTemplateVersion: "critic-v1",
      },
      requireProviderDiversity: true,
    },
  };
}

function validSelection() {
  return {
    capturedAt: "2026-08-12T10:00:00.000Z",
    entries: [
      {
        storeId: "store-z",
        knowledgeBaseId: "knowledge-z",
        sources: [
          {
            sourceId: "source-z",
            versionId: "version-z",
            lifecycleRevision: {
              knowledgeBaseState: "active" as const,
              knowledgeBaseArchivedAt: null,
              versionId: "version-z",
              version: 1,
              createdAt: "2026-08-12T09:00:00.000Z",
              managed: true,
              originBoundAt: "2026-08-12T09:00:00.000Z",
              observation: null,
              retirement: null,
              provenanceFetchedAt: null,
              directory: null,
            },
          },
        ],
      },
    ],
  };
}

describe("canonical context snapshot schemas", () => {
  it("accepts a domain-created snapshot without losing canonical data", () => {
    const snapshot = createContextSnapshot(validInput());
    const parsed = contextSnapshotSchema.parse(snapshot);

    expect(parsed).toEqual(snapshot);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.evidenceManifest[0]?.checksum).toBe(checksum);
    expect(parsed.modelConfiguration.author.modelId).toBe("claude-opus-exact");
  });

  it("canonicalizes and round-trips optional candidate knowledge selection evidence", () => {
    const snapshot = createContextSnapshot({
      ...validInput(),
      candidateKnowledgeSelection: validSelection(),
    });
    const parsed = contextSnapshotSchema.parse(snapshot);
    const serialized = serializeContextSnapshot(snapshot);
    const roundTripped = parseContextSnapshot(serialized);

    expect(parsed.candidateKnowledgeSelection).toEqual(snapshot.candidateKnowledgeSelection);
    expect(roundTripped.candidateKnowledgeSelection).toEqual(snapshot.candidateKnowledgeSelection);
    expect(Object.isFrozen(parsed.candidateKnowledgeSelection)).toBe(true);
    expect(Object.isFrozen(roundTripped.candidateKnowledgeSelection?.entries[0])).toBe(true);
    expect(
      candidateKnowledgeSelectionSnapshotSchema.parse({
        ...validSelection(),
        entries: [...validSelection().entries].reverse(),
      }).entries[0]?.storeId,
    ).toBe("store-z");
  });

  it("rejects ineligible serialized or contextual selection evidence", () => {
    const base = validSelection();
    const baseEntry = base.entries[0];
    const source = base.entries[0]?.sources[0];
    if (baseEntry === undefined || source === undefined) {
      throw new Error("The selection fixture must contain a source.");
    }
    const rejectedRevisions = [
      {
        ...source.lifecycleRevision,
        knowledgeBaseState: "archived" as const,
        knowledgeBaseArchivedAt: "2026-08-12T11:00:00.000Z",
      },
      { ...source.lifecycleRevision, managed: false },
      {
        ...source.lifecycleRevision,
        retirement: {
          retiredAt: "2026-08-12T11:00:00.000Z" as const,
          reason: "user-requested" as const,
        },
      },
      {
        ...source.lifecycleRevision,
        observation: {
          observedVersionId: source.versionId,
          status: "changed" as const,
          checkedAt: "2026-08-12T11:00:00.000Z",
          lastRefreshedVersionId: null,
          lastRefreshedAt: null,
          stale: true,
        },
      },
    ];

    for (const lifecycleRevision of rejectedRevisions) {
      const rejected = {
        ...base,
        entries: [
          {
            ...baseEntry,
            sources: [{ ...source, lifecycleRevision }],
          },
        ],
      };
      expect(() => candidateKnowledgeSelectionSnapshotSchema.parse(rejected)).toThrow();
      const contextual = {
        ...createContextSnapshot(validInput()),
        candidateKnowledgeSelection: rejected,
      };
      expect(() => contextSnapshotSchema.parse(contextual)).toThrow();
    }
  });

  it("round-trips an optional versioned writing policy", () => {
    const snapshot = createContextSnapshot({
      ...validInput(),
      writingPolicy: {
        content: "Use ASCII punctuation.",
        checksum: "b".repeat(64),
        version: "sha256:bbbbbbbbbbbb",
      },
    });

    expect(parseContextSnapshot(serializeContextSnapshot(snapshot)).writingPolicy).toEqual(
      snapshot.writingPolicy,
    );
    expect(() =>
      contextSnapshotSchema.parse({
        ...snapshot,
        writingPolicy: { ...snapshot.writingPolicy, checksum: "invalid" },
      }),
    ).toThrow(/SHA-256 checksum/i);
  });

  it("normalizes the description alias in requirement input", () => {
    expect(
      jobRequirementInputSchema.parse({
        id: "requirement-1",
        description: "A normalized requirement",
        priority: "high",
      }),
    ).toEqual({ id: "requirement-1", text: "A normalized requirement", priority: "high" });
  });

  it("rejects malformed versions, timestamps, checksums, and nested values", () => {
    const base = createContextSnapshot(validInput());

    expect(() => contextSnapshotSchema.parse({ ...base, schemaVersion: 2 })).toThrow();
    expect(() => contextSnapshotSchema.parse({ ...base, createdAt: "12 August 2026" })).toThrow();
    expect(() =>
      contextSnapshotSchema.parse({
        ...base,
        evidenceManifest: [{ ...base.evidenceManifest[0], checksum: "not-a-checksum" }],
      }),
    ).toThrow();
    expect(() =>
      contextSnapshotSchema.parse({
        ...base,
        requirements: [{ ...base.requirements[0], priority: "unknown" }],
      }),
    ).toThrow();
    expect(() =>
      contextSnapshotSchema.parse({
        ...base,
        requirements: [base.requirements[0], { ...base.requirements[0], id: "requirement-1" }],
      }),
    ).toThrow(/requirement ids must be unique/i);
    expect(() =>
      contextSnapshotSchema.parse({
        ...base,
        evidenceManifest: [
          base.evidenceManifest[0],
          { ...base.evidenceManifest[0], id: "source-1" },
        ],
      }),
    ).toThrow(/evidence source ids must be unique/i);
    expect(() => contextSnapshotInputSchema.parse({ ...validInput(), language: " " })).toThrow();
  });

  it("rejects a shared lineage only when independent review is required", () => {
    const base = validInput().modelConfiguration as ModelConfigurationInput;
    const sharedLineage = {
      ...base,
      critic: { ...base.critic, company: "anthropic", modelId: "claude-opus-exact" },
    };

    expect(() => modelConfigurationSchema.parse(sharedLineage)).toThrow(
      /different model lineages/i,
    );
    expect(
      modelConfigurationSchema.parse({ ...sharedLineage, requireProviderDiversity: false }),
    ).toMatchObject({ requireProviderDiversity: false });
  });

  it("accepts two models from one company and refuses two vendors of one lineage", () => {
    const base = validInput().modelConfiguration as ModelConfigurationInput;

    expect(
      modelConfigurationSchema.parse({
        ...base,
        author: { ...base.author, company: "anthropic", modelId: "claude-opus-5" },
        critic: { ...base.critic, company: "anthropic", modelId: "claude-haiku-4-5" },
      }),
    ).toMatchObject({ critic: { modelId: "claude-haiku-4-5" } });

    expect(() =>
      modelConfigurationSchema.parse({
        ...base,
        author: { ...base.author, lineage: "gpt-oss-20b" },
        critic: { ...base.critic, lineage: "gpt-oss-20b" },
      }),
    ).toThrow(/different model lineages/i);
  });

  it("lets a recorded rationale override a shared lineage and bounds the rationale", () => {
    const base = validInput().modelConfiguration as ModelConfigurationInput;
    const sharedLineage = {
      ...base,
      critic: { ...base.critic, company: "anthropic", modelId: "claude-opus-exact" },
    };

    expect(
      modelConfigurationSchema.parse({
        ...sharedLineage,
        independenceOverrideRationale: "One model, two prompt templates, deliberately compared.",
      }),
    ).toMatchObject({
      independenceOverrideRationale: "One model, two prompt templates, deliberately compared.",
    });
    expect(() =>
      modelConfigurationSchema.parse({ ...sharedLineage, independenceOverrideRationale: "  " }),
    ).toThrow();
    expect(() =>
      modelConfigurationSchema.parse({
        ...sharedLineage,
        independenceOverrideRationale: "r".repeat(501),
      }),
    ).toThrow();
  });

  it("carries the recorded independence through a canonical snapshot round trip", () => {
    const snapshot = createContextSnapshot(validInput());
    const parsed = contextSnapshotSchema.parse(snapshot);

    expect(parsed.modelConfiguration.independentReview).toEqual({
      authorLineage: "anthropic:claude-opus-exact",
      criticLineage: "openai:gpt-exact",
      lineagesDistinct: true,
      required: true,
    });
    expect(
      contextSnapshotSchema.parse(
        JSON.parse(
          JSON.stringify({
            ...snapshot,
            modelConfiguration: {
              author: snapshot.modelConfiguration.author,
              critic: snapshot.modelConfiguration.critic,
              requireProviderDiversity: true,
            },
          }),
        ),
      ).modelConfiguration.independentReview,
    ).toBeUndefined();
  });

  it("requires the author and critic roles on their corresponding selections", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    expect(() =>
      modelConfigurationSchema.parse({
        ...configuration,
        author: { ...configuration.author, role: "critic" },
      }),
    ).toThrow(/author role/i);
    expect(() =>
      modelConfigurationSchema.parse({
        ...configuration,
        critic: { ...configuration.critic, role: "author" },
      }),
    ).toThrow(/critic role/i);
  });

  it("round-trips all provenance, constraints, rubric, and model metadata through JSON", () => {
    const snapshot = createContextSnapshot(validInput());
    const parsed = parseContextSnapshot(serializeContextSnapshot(snapshot));

    expect(parsed).toEqual(snapshot);
    expect(parsed.requirements).toEqual(snapshot.requirements);
    expect(parsed.evidenceManifest).toEqual(snapshot.evidenceManifest);
    expect(parsed.outputConstraints).toEqual(snapshot.outputConstraints);
    expect(parsed.truthfulnessPolicy).toBe(snapshot.truthfulnessPolicy);
    expect(parsed.readinessRubric).toEqual(snapshot.readinessRubric);
    expect(parsed.modelConfiguration).toEqual(snapshot.modelConfiguration);
  });

  it("rejects malformed serialized snapshots at the persistence boundary", () => {
    expect(() => parseContextSnapshot("not-json")).toThrow();
    const snapshot = createContextSnapshot(validInput());
    expect(() =>
      parseContextSnapshot(serializeContextSnapshot({ ...snapshot, schemaVersion: 2 as never })),
    ).toThrow();
  });

  it("validates agent references with a non-empty shared snapshot id", () => {
    const snapshot = createContextSnapshot(validInput());
    const reference = {
      contextSnapshotId: snapshot.id,
      role: "author" as const,
      model: snapshot.modelConfiguration.author,
    };

    expect(agentContextReferenceSchema.parse(reference)).toEqual(reference);
    expect(() =>
      agentContextReferenceSchema.parse({ ...reference, contextSnapshotId: " " }),
    ).toThrow();
    expect(() =>
      agentContextReferenceSchema.parse({
        ...reference,
        model: { ...reference.model, role: "critic" },
      }),
    ).toThrow(/match the agent role/i);
  });

  it("defaults optional input constraints to the canonical markdown contract", () => {
    const input = validInput();
    const { outputConstraints: _outputConstraints, ...withoutConstraints } = input;

    expect(contextSnapshotInputSchema.parse(withoutConstraints).outputConstraints).toEqual({
      format: "markdown",
      requiredSections: [],
    });
  });
});

describe("candidate knowledge store schema", () => {
  const createdAt = "2026-08-21T12:30:00.000Z";

  it("parses the exact store schema version and trims its identifier", () => {
    expect(
      candidateKnowledgeStoreSchema.parse({
        schemaVersion: 1,
        id: "  portable-store-1  ",
        createdAt,
      }),
    ).toEqual({ schemaVersion: 1, id: "portable-store-1", createdAt });
  });

  it("rejects unsupported versions, blank identifiers, and invalid timestamps", () => {
    expect(() =>
      candidateKnowledgeStoreSchema.parse({
        schemaVersion: 2,
        id: "portable-store-1",
        createdAt,
      }),
    ).toThrow();
    expect(() =>
      candidateKnowledgeStoreSchema.parse({ schemaVersion: 1, id: "  ", createdAt }),
    ).toThrow(/must not be empty/i);
    expect(() =>
      candidateKnowledgeStoreSchema.parse({
        schemaVersion: 1,
        id: "portable-store-1",
        createdAt: ` ${createdAt} `,
      }),
    ).toThrow(/valid ISO timestamp/i);
  });
});

describe("structured artifact schemas", () => {
  const validArtifact = {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt: "2026-08-12T10:00:00.000Z",
    language: "en",
    sections: [
      {
        id: "section-summary",
        title: "Summary",
        kind: "summary" as const,
        order: 0,
        blocks: [
          {
            id: "block-summary-1",
            type: "paragraph" as const,
            text: "Engineer building reliable systems.",
            claimIds: ["claim-summary-1"],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-summary-1",
        text: "Engineer building reliable systems.",
        sectionId: "section-summary",
        blockId: "block-summary-1",
        substantive: true,
        status: "verified" as const,
        evidence: [
          {
            sourcePath: "/local/candidate/resume.md",
            sourceChecksum: checksum,
            locator: "line:4-5",
            excerpt: "Built reliable systems.",
          },
        ],
      },
    ],
    decisions: [],
  };

  it("validates structured artifacts with claims, evidence, and version metadata", () => {
    expect(draftArtifactSchema.parse(validArtifact)).toEqual(validArtifact);
  });

  it("allows an unbacked claim for deterministic highlighting, but rejects broken references", () => {
    expect(
      draftArtifactSchema.parse({
        ...validArtifact,
        claims: [
          {
            ...validArtifact.claims[0],
            evidence: [],
          },
        ],
      }).claims[0]?.evidence,
    ).toEqual([]);

    expect(() =>
      draftArtifactSchema.parse({
        ...validArtifact,
        claims: [{ ...validArtifact.claims[0], sectionId: "missing-section" }],
      }),
    ).toThrow(/existing section/i);
    expect(() =>
      draftArtifactSchema.parse({ ...validArtifact, version: 2, parentVersionId: null }),
    ).toThrow(/parent version/i);
  });

  it("rejects duplicate IDs and decisions that reference missing claims", () => {
    expect(() =>
      draftArtifactSchema.parse({
        ...validArtifact,
        sections: [validArtifact.sections[0], { ...validArtifact.sections[0] }],
      }),
    ).toThrow(/sections ids must be unique/i);
    expect(() =>
      draftArtifactSchema.parse({
        ...validArtifact,
        decisions: [
          {
            id: "decision-1",
            type: "edit",
            rationale: "User edited the summary.",
            createdAt: "2026-08-12T10:00:00.000Z",
            claimId: "missing-claim",
          },
        ],
      }),
    ).toThrow(/decision claim/i);
  });
});

describe("candidateProfileSchema", () => {
  it("validates a complete profile", () => {
    const result = candidateProfileSchema.parse({
      id: "profile-1",
      name: "My Professional Profile",
      description: "All my work experience",
      createdAt: "2026-08-14T20:00:00.000Z",
      updatedAt: "2026-08-14T20:00:00.000Z",
    });
    expect(result.id).toBe("profile-1");
    expect(result.name).toBe("My Professional Profile");
    expect(result.description).toBe("All my work experience");
  });

  it("defaults description to empty string", () => {
    const result = candidateProfileSchema.parse({
      id: "profile-2",
      name: "Minimal Profile",
      createdAt: "2026-08-14T20:00:00.000Z",
      updatedAt: "2026-08-14T20:00:00.000Z",
    });
    expect(result.description).toBe("");
  });

  it("rejects empty name", () => {
    expect(() =>
      candidateProfileSchema.parse({
        id: "profile-3",
        name: "",
        createdAt: "2026-08-14T20:00:00.000Z",
        updatedAt: "2026-08-14T20:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects missing timestamps", () => {
    expect(() =>
      candidateProfileSchema.parse({
        id: "profile-4",
        name: "Test",
      }),
    ).toThrow();
  });
});

describe("candidateKnowledgeBaseSchema", () => {
  const createdAt = "2026-08-20T09:00:00.000Z";

  it("defaults a trimmed record to the active lifecycle", () => {
    expect(
      candidateKnowledgeBaseSchema.parse({
        id: "  ckb-primary  ",
        displayName: "  Career Evidence  ",
        createdAt,
        updatedAt: createdAt,
      }),
    ).toEqual({
      id: "ckb-primary",
      displayName: "Career Evidence",
      description: "",
      isDefault: false,
      state: "active",
      createdAt,
      updatedAt: createdAt,
    });
    expect(candidateKnowledgeBaseStateSchema.parse("archived")).toBe("archived");
  });

  it("accepts an archived record whose lifecycle timestamps are ordered", () => {
    expect(
      candidateKnowledgeBaseSchema.parse({
        id: "ckb-history",
        displayName: "Historical Evidence",
        description: "Sanitized archive",
        isDefault: false,
        state: "archived",
        createdAt,
        archivedAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T11:00:00.000Z",
      }),
    ).toMatchObject({ state: "archived", archivedAt: "2026-08-20T10:00:00.000Z" });
  });

  it("enforces archivedAt consistency for active and archived states", () => {
    expect(() =>
      candidateKnowledgeBaseSchema.parse({
        id: "ckb-active",
        displayName: "Active Evidence",
        state: "active",
        createdAt,
        updatedAt: createdAt,
        archivedAt: createdAt,
      }),
    ).toThrow(/must not have archivedAt/i);
    expect(() =>
      candidateKnowledgeBaseSchema.parse({
        id: "ckb-archived",
        displayName: "Archived Evidence",
        state: "archived",
        createdAt,
        updatedAt: createdAt,
      }),
    ).toThrow(/require archivedAt/i);
  });

  it("requires the default knowledge base to remain active", () => {
    expect(() =>
      candidateKnowledgeBaseSchema.parse({
        id: "ckb-default",
        displayName: "Default Evidence",
        isDefault: true,
        state: "archived",
        createdAt,
        updatedAt: "2026-08-20T10:00:00.000Z",
        archivedAt: "2026-08-20T10:00:00.000Z",
      }),
    ).toThrow(/default candidate knowledge base must remain active/i);
  });

  it("rejects timestamps outside lifecycle order", () => {
    expect(() =>
      candidateKnowledgeBaseSchema.parse({
        id: "ckb-1",
        displayName: "Career Evidence",
        createdAt,
        updatedAt: "2026-08-20T08:00:00.000Z",
      }),
    ).toThrow(/updatedAt must not precede createdAt/i);
    expect(() =>
      candidateKnowledgeBaseSchema.parse({
        id: "ckb-2",
        displayName: "Historical Evidence",
        state: "archived",
        createdAt,
        updatedAt: "2026-08-20T10:00:00.000Z",
        archivedAt: "2026-08-20T11:00:00.000Z",
      }),
    ).toThrow(/archivedAt must not precede createdAt or follow updatedAt/i);
  });
});

describe("candidate knowledge source schemas", () => {
  const createdAt = "2026-08-21T09:00:00.000Z";

  it("parses canonical logical source identity metadata", () => {
    expect(candidateKnowledgeSourceKindSchema.parse("url")).toBe("url");
    expect(
      candidateKnowledgeSourceSchema.parse({
        id: "  source-1  ",
        knowledgeBaseId: "  ckb-primary  ",
        kind: "file",
        displayName: "  Current CV  ",
        createdAt,
      }),
    ).toEqual({
      id: "source-1",
      knowledgeBaseId: "ckb-primary",
      kind: "file",
      displayName: "Current CV",
      createdAt,
    });
  });

  it("rejects invalid source identity fields", () => {
    const valid = {
      id: "source-1",
      knowledgeBaseId: "ckb-primary",
      kind: "file",
      displayName: "Current CV",
      createdAt,
    };
    expect(() => candidateKnowledgeSourceSchema.parse({ ...valid, id: " " })).toThrow();
    expect(() =>
      candidateKnowledgeSourceSchema.parse({ ...valid, knowledgeBaseId: " " }),
    ).toThrow();
    expect(() => candidateKnowledgeSourceSchema.parse({ ...valid, kind: "directory" })).toThrow();
    expect(() => candidateKnowledgeSourceSchema.parse({ ...valid, displayName: " " })).toThrow();
    expect(() =>
      candidateKnowledgeSourceSchema.parse({ ...valid, createdAt: "2026-08-21" }),
    ).toThrow(/valid ISO timestamp/i);
    expect(() =>
      candidateKnowledgeSourceSchema.parse({ ...valid, createdAt: ` ${createdAt} ` }),
    ).toThrow(/valid ISO timestamp/i);
  });

  it("parses and validates source retirement markers", () => {
    expect(candidateKnowledgeSourceRetirementReasonSchema.parse("user-requested")).toBe(
      "user-requested",
    );
    expect(
      candidateKnowledgeSourceRetirementSchema.parse({
        sourceId: "  source-1  ",
        retiredAt: createdAt,
        reason: "user-requested",
      }),
    ).toEqual({ sourceId: "source-1", retiredAt: createdAt, reason: "user-requested" });
    expect(() =>
      candidateKnowledgeSourceRetirementSchema.parse({
        sourceId: "source-1",
        retiredAt: "not-a-date",
        reason: "user-requested",
      }),
    ).toThrow();
    expect(() =>
      candidateKnowledgeSourceRetirementSchema.parse({
        sourceId: "source-1",
        retiredAt: createdAt,
        reason: "imported",
      }),
    ).toThrow();
  });

  it("normalizes immutable first and child version metadata", () => {
    expect(
      candidateKnowledgeSourceVersionSchema.parse({
        id: "  version-1  ",
        sourceId: "  source-1  ",
        version: 1,
        mediaType: "  text/markdown  ",
        checksum: "A".repeat(64),
        sizeBytes: 0,
        createdAt,
      }),
    ).toEqual({
      id: "version-1",
      sourceId: "source-1",
      version: 1,
      mediaType: "text/markdown",
      checksum: "a".repeat(64),
      sizeBytes: 0,
      createdAt,
    });
    expect(
      candidateKnowledgeSourceVersionSchema.parse({
        id: "version-2",
        sourceId: "source-1",
        version: 2,
        parentVersionId: "  version-1  ",
        mediaType: "text/markdown",
        checksum: "b".repeat(64),
        sizeBytes: 2048,
        createdAt,
      }).parentVersionId,
    ).toBe("version-1");
  });

  it("rejects invalid version lineage, integrity metadata, fields, and timestamps", () => {
    const valid = {
      id: "version-1",
      sourceId: "source-1",
      version: 1,
      mediaType: "text/plain",
      checksum: "a".repeat(64),
      sizeBytes: 12,
      createdAt,
    };
    expect(() => candidateKnowledgeSourceVersionSchema.parse({ ...valid, version: 0 })).toThrow();
    expect(() =>
      candidateKnowledgeSourceVersionSchema.parse({
        ...valid,
        parentVersionId: "version-0",
      }),
    ).toThrow(/must not have a parent/i);
    expect(() => candidateKnowledgeSourceVersionSchema.parse({ ...valid, version: 2 })).toThrow(
      /require a parent/i,
    );
    expect(() =>
      candidateKnowledgeSourceVersionSchema.parse({ ...valid, checksum: "a".repeat(40) }),
    ).toThrow(/SHA-256/i);
    expect(() =>
      candidateKnowledgeSourceVersionSchema.parse({ ...valid, checksum: `sha256:${checksum}` }),
    ).toThrow(/SHA-256/i);
    expect(() =>
      candidateKnowledgeSourceVersionSchema.parse({ ...valid, sizeBytes: -1 }),
    ).toThrow();
    expect(() =>
      candidateKnowledgeSourceVersionSchema.parse({ ...valid, sizeBytes: 1.5 }),
    ).toThrow();
    expect(() =>
      candidateKnowledgeSourceVersionSchema.parse({ ...valid, sourceId: " " }),
    ).toThrow();
    expect(() =>
      candidateKnowledgeSourceVersionSchema.parse({ ...valid, mediaType: " " }),
    ).toThrow();
    expect(() =>
      candidateKnowledgeSourceVersionSchema.parse({ ...valid, createdAt: "not-a-date" }),
    ).toThrow(/valid ISO timestamp/i);
    expect(() =>
      candidateKnowledgeSourceVersionSchema.parse({ ...valid, createdAt: ` ${createdAt} ` }),
    ).toThrow(/valid ISO timestamp/i);
  });
});

describe("profileId in schemas", () => {
  it("accepts profileId in context snapshot", () => {
    const snapshot = createContextSnapshot({
      ...validInput(),
      profileId: "profile-1",
    });
    const serialized = serializeContextSnapshot(snapshot);
    const parsed = parseContextSnapshot(serialized);
    expect(parsed.profileId).toBe("profile-1");
  });

  it("accepts profileId in evidence source", () => {
    const snapshot = createContextSnapshot({
      ...validInput(),
      evidenceManifest: [
        {
          id: "source-1",
          path: "/local/candidate/resume.md",
          mediaType: "text/markdown",
          checksum,
          profileId: "profile-1",
        },
      ],
    });
    const serialized = serializeContextSnapshot(snapshot);
    const parsed = parseContextSnapshot(serialized);
    expect(parsed.evidenceManifest[0]?.profileId).toBe("profile-1");
  });

  it("roundtrips without profileId", () => {
    const snapshot = createContextSnapshot(validInput());
    const serialized = serializeContextSnapshot(snapshot);
    const parsed = parseContextSnapshot(serialized);
    expect(parsed.profileId).toBeUndefined();
  });
});
