import {
  type ContextSnapshotInput,
  createContextSnapshot,
  type ModelConfigurationInput,
} from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import {
  agentContextReferenceSchema,
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

describe("canonical context snapshot schemas", () => {
  it("accepts a domain-created snapshot without losing canonical data", () => {
    const snapshot = createContextSnapshot(validInput());
    const parsed = contextSnapshotSchema.parse(snapshot);

    expect(parsed).toEqual(snapshot);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.evidenceManifest[0]?.checksum).toBe(checksum);
    expect(parsed.modelConfiguration.author.modelId).toBe("claude-opus-exact");
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
