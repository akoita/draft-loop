import { describe, expect, it } from "vitest";

import {
  archiveCandidateKnowledgeBase,
  assertIndependentReview,
  type ContextSnapshotInput,
  canonicalizeModelId,
  createAgentContextReference,
  createCandidateKnowledgeBase,
  createCandidateKnowledgeSource,
  createCandidateKnowledgeSourceRetirement,
  createCandidateKnowledgeSourceVersion,
  createCandidateKnowledgeStore,
  createContextSnapshot,
  createProfile,
  createWorkspace,
  curatedModelLineage,
  deriveModelLineage,
  describeIndependentReview,
  hasIndependentReview,
  type ModelConfigurationInput,
  type ModelSelection,
  maximumIndependenceOverrideRationaleLength,
  renameCandidateKnowledgeBase,
  SemanticValidationError,
  workflowStates,
} from "./index.js";

const checksum = "a".repeat(64);

function validInput(
  overrides: { [Key in keyof ContextSnapshotInput]?: ContextSnapshotInput[Key] | undefined } = {},
): ContextSnapshotInput {
  return {
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
    ...overrides,
  } as ContextSnapshotInput;
}

describe("domain workspace and context snapshots", () => {
  it("preserves the workspace lifecycle API", () => {
    expect(createWorkspace("example")).toEqual({ id: "example", state: "collecting" });
    expect(workflowStates).toContain("awaiting-approval");
  });

  it("creates a complete canonical snapshot", () => {
    const snapshot = createContextSnapshot(validInput());

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      id: "snapshot-1",
      workspaceId: "workspace-1",
      jobDescription: "Build reliable local-first software.",
      language: "en",
      modelConfiguration: {
        author: { company: "anthropic", role: "author" },
        critic: { company: "openai", role: "critic" },
      },
    });
    expect(snapshot.evidenceManifest[0]?.checksum).toBe(checksum);
  });

  it("preserves a versioned writing policy separately from evidence", () => {
    const snapshot = createContextSnapshot(
      validInput({
        writingPolicy: {
          content: "  Use ASCII punctuation.  ",
          checksum: "B".repeat(64),
          version: " sha256:bbbbbbbbbbbb ",
        },
      }),
    );

    expect(snapshot.writingPolicy).toEqual({
      content: "Use ASCII punctuation.",
      checksum: "b".repeat(64),
      version: "sha256:bbbbbbbbbbbb",
    });
    expect(snapshot.evidenceManifest).toHaveLength(1);
    expect(() =>
      createContextSnapshot(
        validInput({
          writingPolicy: { content: "Rules", checksum: "invalid", version: "v1" },
        }),
      ),
    ).toThrow(/writingPolicy\.checksum/i);
  });

  it("deeply freezes the snapshot and does not mutate from input changes", () => {
    const input = validInput();
    const snapshot = createContextSnapshot(input);

    const firstRequirement = (
      input.requirements as Array<{ id: string; text: string; priority: "critical" | "high" }>
    )[0];
    if (!firstRequirement) {
      throw new Error("The test fixture must contain a requirement.");
    }
    firstRequirement.text = "changed";
    expect(snapshot.requirements[0]?.text).toBe("TypeScript experience");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.requirements)).toBe(true);
    expect(Object.isFrozen(snapshot.requirements[0])).toBe(true);
    expect(Object.isFrozen(snapshot.modelConfiguration.author)).toBe(true);
  });

  it("creates author and critic references to one snapshot id", () => {
    const snapshot = createContextSnapshot(validInput());
    const author = createAgentContextReference(snapshot, snapshot.modelConfiguration.author);
    const critic = createAgentContextReference(snapshot, snapshot.modelConfiguration.critic);

    expect(author.contextSnapshotId).toBe(snapshot.id);
    expect(critic.contextSnapshotId).toBe(snapshot.id);
    expect(author.role).toBe("author");
    expect(critic.role).toBe("critic");
  });

  it("derives a lineage from company and model id when none is declared", () => {
    expect(deriveModelLineage({ company: "Anthropic", modelId: "Claude-Opus-5" })).toBe(
      "anthropic:claude-opus-5",
    );
    expect(deriveModelLineage({ company: " anthropic ", modelId: "claude-haiku-4-5" })).toBe(
      "anthropic:claude-haiku-4-5",
    );
    expect(
      deriveModelLineage({ company: "vendor-a", modelId: "hosted-oss", lineage: " Base  Model " }),
    ).toBe("base model");
  });

  it("rejects a shared lineage when independent review is required", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const input = validInput({
      modelConfiguration: {
        ...configuration,
        critic: {
          ...configuration.critic,
          company: "anthropic",
          modelId: "claude-opus-exact",
        },
      },
    });

    expect(() => createContextSnapshot(input)).toThrow(/different model lineages/i);
    const author = configuration.author as ModelSelection;
    const critic = { ...author, role: "critic" } as ModelSelection;
    expect(hasIndependentReview(author, critic)).toBe(false);
    expect(() => assertIndependentReview(author, critic)).toThrow(/different model lineages/i);
  });

  it("refuses two vendors that declare one shared lineage", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const input = validInput({
      modelConfiguration: {
        ...configuration,
        author: { ...configuration.author, lineage: "gpt-oss-20b" },
        critic: { ...configuration.critic, lineage: "gpt-oss-20b" },
      },
    });

    expect(() => createContextSnapshot(input)).toThrow(/different model lineages/i);
  });

  it("accepts two models from one company with different lineages", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const snapshot = createContextSnapshot(
      validInput({
        modelConfiguration: {
          ...configuration,
          author: { ...configuration.author, company: "anthropic", modelId: "claude-opus-5" },
          critic: { ...configuration.critic, company: "anthropic", modelId: "claude-haiku-4-5" },
        },
      }),
    );

    expect(snapshot.modelConfiguration.independentReview).toEqual({
      authorLineage: "anthropic:claude-opus-5",
      criticLineage: "anthropic:claude-haiku-4-5",
      lineagesDistinct: true,
      required: true,
    });
  });

  it("keeps an existing cross-company pairing independent", () => {
    const snapshot = createContextSnapshot(validInput());

    expect(snapshot.modelConfiguration.independentReview).toEqual({
      authorLineage: "anthropic:claude-opus-exact",
      criticLineage: "openai:gpt-exact",
      lineagesDistinct: true,
      required: true,
    });
  });

  it("records a shared lineage that a rationale overrode", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const snapshot = createContextSnapshot(
      validInput({
        modelConfiguration: {
          ...configuration,
          critic: { ...configuration.critic, company: "anthropic", modelId: "claude-opus-exact" },
          independenceOverrideRationale: "  Comparing two prompt templates on one model.  ",
        },
      }),
    );

    expect(snapshot.modelConfiguration.independentReview).toEqual({
      authorLineage: "anthropic:claude-opus-exact",
      criticLineage: "anthropic:claude-opus-exact",
      lineagesDistinct: false,
      required: true,
      overrideRationale: "Comparing two prompt templates on one model.",
    });
  });

  it("does not record a rationale that overrode nothing", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const snapshot = createContextSnapshot(
      validInput({
        modelConfiguration: {
          ...configuration,
          independenceOverrideRationale: "Not needed here.",
        },
      }),
    );

    expect(snapshot.modelConfiguration.independentReview?.overrideRationale).toBeUndefined();
    expect(snapshot.modelConfiguration.independentReview?.lineagesDistinct).toBe(true);
  });

  it("rejects an unusable override rationale without echoing it", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const secret = "x".repeat(maximumIndependenceOverrideRationaleLength + 1);
    const build = (rationale: unknown): ContextSnapshotInput =>
      validInput({
        modelConfiguration: {
          ...configuration,
          critic: { ...configuration.critic, company: "anthropic", modelId: "claude-opus-exact" },
          independenceOverrideRationale: rationale as string,
        },
      });

    expect(() => createContextSnapshot(build("   "))).toThrow(/non-empty rationale/i);
    expect(() => createContextSnapshot(build(42))).toThrow(/non-empty rationale/i);
    try {
      createContextSnapshot(build(secret));
      throw new Error("an over-long rationale must be refused.");
    } catch (error) {
      expect(error).toBeInstanceOf(SemanticValidationError);
      expect((error as Error).message).toMatch(/at most 500 characters/i);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("rejects a lineage that is empty or over-long", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const withLineage = (lineage: string): ContextSnapshotInput =>
      validInput({
        modelConfiguration: { ...configuration, author: { ...configuration.author, lineage } },
      });

    expect(() => createContextSnapshot(withLineage("  "))).toThrow(/non-empty model lineage/i);
    expect(() => createContextSnapshot(withLineage("l".repeat(201)))).toThrow(
      /at most 200 characters/i,
    );
  });

  it("treats lineage whitespace and casing as one claim", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const author = { ...configuration.author, lineage: " Local-A " } as ModelSelection;
    const critic = { ...configuration.critic, lineage: "local-a" } as ModelSelection;

    expect(hasIndependentReview(author, critic)).toBe(false);
    expect(describeIndependentReview(author, critic, { required: false })).toEqual({
      authorLineage: "local-a",
      criticLineage: "local-a",
      lineagesDistinct: false,
      required: false,
    });
  });

  it("rejects duplicate normalized requirement and evidence source ids", () => {
    const input = validInput({
      requirements: [
        { id: "requirement-1", text: "First", priority: "high" },
        { id: " requirement-1 ", text: "Duplicate", priority: "low" },
      ],
    });
    expect(() => createContextSnapshot(input)).toThrow(/requirement ids must be unique/i);

    const sourceInput = validInput({
      evidenceManifest: [
        {
          id: "source-1",
          path: "/local/candidate/resume.md",
          mediaType: "text/markdown",
          checksum,
        },
        {
          id: " source-1 ",
          path: "/local/candidate/notes.md",
          mediaType: "text/markdown",
          checksum,
        },
      ],
    });
    expect(() => createContextSnapshot(sourceInput)).toThrow(/evidence source ids must be unique/i);
  });

  it("rejects non-string text fields before normalization", () => {
    expect(() =>
      createContextSnapshot(validInput({ candidateInstructions: 42 as unknown as string })),
    ).toThrow(/candidateInstructions: must be a string/i);
    expect(() =>
      createContextSnapshot(validInput({ truthfulnessPolicy: 42 as unknown as string })),
    ).toThrow(/truthfulnessPolicy: must be a string/i);
    expect(() =>
      createContextSnapshot(
        validInput({
          outputConstraints: {
            ...validInput().outputConstraints,
            tone: 42 as unknown as string,
          },
        }),
      ),
    ).toThrow(/outputConstraints\.tone: must be a string/i);
  });

  it("uses the same strict ISO timestamp rule as the schemas", () => {
    expect(() => createContextSnapshot(validInput({ createdAt: "12 August 2026" }))).toThrow(
      /createdAt: a valid creation timestamp is required/i,
    );
    expect(
      createContextSnapshot(validInput({ createdAt: " 2026-08-12T10:00:00.000Z " })).createdAt,
    ).toBe("2026-08-12T10:00:00.000Z");
  });

  it.each([
    ["jobDescription", { jobDescription: "" }],
    ["language", { language: "" }],
    ["requirements", { requirements: [] }],
    ["evidenceManifest", { evidenceManifest: [] }],
    ["modelConfiguration", { modelConfiguration: undefined }],
  ] as const)("rejects missing %s before a provider call", (_field, override) => {
    expect(() => createContextSnapshot(validInput(override))).toThrow(SemanticValidationError);
  });
});

function selection(
  company: string,
  modelId: string,
  role: "author" | "critic" = "author",
  lineage?: string,
): ModelSelection {
  return {
    company,
    modelId,
    role,
    promptTemplateVersion: `${role}-v1`,
    ...(lineage === undefined ? {} : { lineage }),
  } as ModelSelection;
}

describe("model id canonicalization", () => {
  it("recovers one base model id from every route to one model", () => {
    expect(canonicalizeModelId("claude-sonnet-4-5")).toEqual({
      baseModelId: "claude-sonnet-4-5",
    });
    expect(canonicalizeModelId("claude-sonnet-4-5-20250929")).toEqual({
      baseModelId: "claude-sonnet-4-5",
    });
    expect(canonicalizeModelId("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toEqual({
      vendor: "anthropic",
      baseModelId: "claude-sonnet-4-5",
    });
    expect(canonicalizeModelId(" EU.Anthropic.Claude-Sonnet-4-5-Latest ")).toEqual({
      vendor: "anthropic",
      baseModelId: "claude-sonnet-4-5",
    });
    expect(canonicalizeModelId("gpt-4o-2024-08-06")).toEqual({ baseModelId: "gpt-4o" });
  });

  it("leaves an id it does not recognize exactly as it found it", () => {
    for (const modelId of [
      "claude-opus-exact",
      "gpt-exact",
      "gpt-5.6-luna",
      "llama3.2",
      "qwen3-coder-30b",
      "gpt-oss-20b",
      "mistral-small",
      "gpt-4.1",
      "llama-3.1-8b",
    ]) {
      expect(canonicalizeModelId(modelId)).toEqual({ baseModelId: modelId });
    }
  });

  it("keeps a version that names the model rather than the route", () => {
    // `-v2` is what the model is called; stripping it would fold every Claude
    // generation into one lineage.
    expect(canonicalizeModelId("anthropic.claude-v2:1:200k")).toEqual({
      vendor: "anthropic",
      baseModelId: "claude-v2",
    });
    expect(canonicalizeModelId("claude-v2")).toEqual({ baseModelId: "claude-v2" });
  });

  it("never collapses models that differ in family, size, or version", () => {
    const lineages = [
      "us.anthropic.claude-opus-5-20250929-v1:0",
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "meta.llama-3-8b-instruct-v1:0",
      "meta.llama-4-70b-instruct-v1:0",
    ].map((modelId) => JSON.stringify(canonicalizeModelId(modelId)));

    expect(new Set(lineages).size).toBe(lineages.length);
  });
});

describe("curated model lineage", () => {
  it("has no exact-match entry to offer, which is not a claim of independence", () => {
    expect(curatedModelLineage("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBeUndefined();
    expect(curatedModelLineage("gpt-oss-20b")).toBeUndefined();
  });

  it("resolves a resold route and a direct one to a single lineage", () => {
    const author = selection("anthropic", "claude-sonnet-4-5", "author");
    const critic = selection("bedrock", "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "critic");

    expect(deriveModelLineage(author)).toBe("anthropic:claude-sonnet-4-5");
    expect(deriveModelLineage(critic)).toBe("anthropic:claude-sonnet-4-5");
    expect(hasIndependentReview(author, critic)).toBe(false);
    expect(() => assertIndependentReview(author, critic)).toThrow(/different model lineages/i);
  });

  it("refuses the resold pairing in a snapshot and records why", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const resold: ModelConfigurationInput = {
      ...configuration,
      author: { ...configuration.author, company: "anthropic", modelId: "claude-sonnet-4-5" },
      critic: {
        ...configuration.critic,
        company: "bedrock",
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      },
    };

    expect(() => createContextSnapshot(validInput({ modelConfiguration: resold }))).toThrow(
      /different model lineages/i,
    );

    const snapshot = createContextSnapshot(
      validInput({
        modelConfiguration: {
          ...resold,
          independenceOverrideRationale: "Comparing one model's own critique of itself.",
        },
      }),
    );
    expect(snapshot.modelConfiguration.independentReview).toEqual({
      authorLineage: "anthropic:claude-sonnet-4-5",
      criticLineage: "anthropic:claude-sonnet-4-5",
      lineagesDistinct: false,
      required: true,
      overrideRationale: "Comparing one model's own critique of itself.",
    });
  });

  it("lets a declared lineage overrule the curated answer", () => {
    const author = selection("anthropic", "claude-sonnet-4-5", "author");
    const critic = selection(
      "bedrock",
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "critic",
      " Fine-Tuned  Sonnet ",
    );

    expect(deriveModelLineage(critic)).toBe("fine-tuned sonnet");
    expect(hasIndependentReview(author, critic)).toBe(true);
  });

  it("keeps genuinely different models independent through every route", () => {
    const opus = selection("bedrock", "us.anthropic.claude-opus-5-20250929-v1:0", "author");
    const sonnet = selection("anthropic", "claude-sonnet-4-5", "critic");
    expect(hasIndependentReview(opus, sonnet)).toBe(true);

    const small = selection("bedrock", "meta.llama-3-8b-instruct-v1:0", "author");
    const large = selection("bedrock", "meta.llama-4-70b-instruct-v1:0", "critic");
    expect(hasIndependentReview(small, large)).toBe(true);
  });

  it("derives company:modelId unchanged for an id it does not recognize", () => {
    expect(deriveModelLineage({ company: "openai", modelId: "gpt-5.6-luna" })).toBe(
      "openai:gpt-5.6-luna",
    );
    expect(deriveModelLineage({ company: "local", modelId: "qwen3-coder-30b" })).toBe(
      "local:qwen3-coder-30b",
    );
    expect(deriveModelLineage({ company: "Anthropic", modelId: "Claude-Opus-Exact" })).toBe(
      "anthropic:claude-opus-exact",
    );
    expect(deriveModelLineage({})).toBe(":");
  });

  it("keeps the default anthropic and openai pairing independent", () => {
    const author = selection("anthropic", "claude-sonnet-4-5", "author");
    const critic = selection("openai", "gpt-5", "critic");

    expect(describeIndependentReview(author, critic)).toEqual({
      authorLineage: "anthropic:claude-sonnet-4-5",
      criticLineage: "openai:gpt-5",
      lineagesDistinct: true,
      required: true,
    });
  });
});

describe("CandidateProfile", () => {
  it("creates a profile with required fields", () => {
    const profile = createProfile("profile-1", { name: "My Full Profile" });
    expect(profile.id).toBe("profile-1");
    expect(profile.name).toBe("My Full Profile");
    expect(profile.description).toBe("");
    expect(profile.createdAt).toBeTruthy();
    expect(profile.updatedAt).toBeTruthy();
    expect(profile.createdAt).toBe(profile.updatedAt);
  });

  it("creates a profile with description", () => {
    const profile = createProfile("profile-2", {
      name: "Tech Experience",
      description: "Open source and professional work",
    });
    expect(profile.name).toBe("Tech Experience");
    expect(profile.description).toBe("Open source and professional work");
  });

  it("trims whitespace from name and description", () => {
    const profile = createProfile("p-1", {
      name: "  Padded Name  ",
      description: "  Padded Description  ",
    });
    expect(profile.name).toBe("Padded Name");
    expect(profile.description).toBe("Padded Description");
  });

  it("rejects empty profile id", () => {
    expect(() => createProfile("", { name: "Test" })).toThrow(/profile id is required/i);
    expect(() => createProfile("   ", { name: "Test" })).toThrow(/profile id is required/i);
  });

  it("rejects empty profile name", () => {
    expect(() => createProfile("p-1", { name: "" })).toThrow(/profile name is required/i);
    expect(() => createProfile("p-1", { name: "   " })).toThrow(/profile name is required/i);
  });
});

describe("CandidateKnowledgeBase", () => {
  const createdAt = "2026-08-20T09:00:00.000Z";
  const renamedAt = "2026-08-20T10:00:00.000Z";
  const archivedAt = "2026-08-20T11:00:00.000Z";
  const renamedArchivedAt = "2026-08-20T12:00:00.000Z";

  it("creates a canonical active knowledge base", () => {
    expect(
      createCandidateKnowledgeBase(
        "  ckb-primary  ",
        {
          displayName: "  Career Evidence  ",
          description: "  Sanitized professional material  ",
          isDefault: true,
        },
        createdAt,
      ),
    ).toEqual({
      id: "ckb-primary",
      displayName: "Career Evidence",
      description: "Sanitized professional material",
      isDefault: true,
      state: "active",
      createdAt,
      updatedAt: createdAt,
    });
  });

  it("rejects blank identifiers and display names", () => {
    expect(() =>
      createCandidateKnowledgeBase("  ", { displayName: "Career Evidence" }, createdAt),
    ).toThrow(/id is required/i);
    expect(() => createCandidateKnowledgeBase("ckb-1", { displayName: "  " }, createdAt)).toThrow(
      /display name is required/i,
    );
  });

  it("renames active and archived knowledge bases while preserving lifecycle fields", () => {
    const active = createCandidateKnowledgeBase(
      "ckb-1",
      { displayName: "Career Evidence" },
      createdAt,
    );
    const activeRenamed = renameCandidateKnowledgeBase(active, "Current Evidence", renamedAt);
    expect(activeRenamed).toEqual({
      ...active,
      displayName: "Current Evidence",
      updatedAt: renamedAt,
    });

    const archived = archiveCandidateKnowledgeBase(activeRenamed, archivedAt);
    const renamed = renameCandidateKnowledgeBase(
      archived,
      "  Historical Evidence  ",
      renamedArchivedAt,
    );

    expect(renamed).toEqual({
      ...archived,
      displayName: "Historical Evidence",
      updatedAt: renamedArchivedAt,
    });
    expect(renamed.archivedAt).toBe(archivedAt);
  });

  it("archives a non-default active knowledge base at the transition timestamp", () => {
    const knowledgeBase = createCandidateKnowledgeBase(
      "ckb-1",
      { displayName: "Career Evidence" },
      createdAt,
    );

    expect(archiveCandidateKnowledgeBase(knowledgeBase, archivedAt)).toEqual({
      ...knowledgeBase,
      state: "archived",
      updatedAt: archivedAt,
      archivedAt,
    });
  });

  it("does not archive the default knowledge base or repeat an archive transition", () => {
    const defaultKnowledgeBase = createCandidateKnowledgeBase(
      "ckb-default",
      { displayName: "Default Evidence", isDefault: true },
      createdAt,
    );
    expect(() => archiveCandidateKnowledgeBase(defaultKnowledgeBase, archivedAt)).toThrow(
      /default candidate knowledge base cannot be archived/i,
    );

    const archived = archiveCandidateKnowledgeBase(
      createCandidateKnowledgeBase("ckb-other", { displayName: "Other Evidence" }, createdAt),
      archivedAt,
    );
    expect(() => archiveCandidateKnowledgeBase(archived, renamedAt)).toThrow(/already archived/i);
  });

  it("rejects invalid and out-of-order lifecycle timestamps", () => {
    expect(() =>
      createCandidateKnowledgeBase("ckb-1", { displayName: "Career Evidence" }, "not-a-date"),
    ).toThrow(/valid ISO timestamp/i);

    const knowledgeBase = createCandidateKnowledgeBase(
      "ckb-1",
      { displayName: "Career Evidence" },
      createdAt,
    );
    expect(() =>
      renameCandidateKnowledgeBase(knowledgeBase, "Renamed", "2026-08-20T08:00:00Z"),
    ).toThrow(/must not precede/i);
    expect(() => archiveCandidateKnowledgeBase(knowledgeBase, "2026-08-20T08:00:00Z")).toThrow(
      /must not precede/i,
    );
  });
});

describe("CandidateKnowledgeSource", () => {
  const createdAt = "2026-08-21T09:00:00.000Z";

  it("creates a canonical logical source without a physical locator", () => {
    expect(
      createCandidateKnowledgeSource(
        "  source-1  ",
        {
          knowledgeBaseId: "  ckb-primary  ",
          kind: "file",
          displayName: "  Current CV  ",
        },
        createdAt,
      ),
    ).toEqual({
      id: "source-1",
      knowledgeBaseId: "ckb-primary",
      kind: "file",
      displayName: "Current CV",
      createdAt,
    });
  });

  it("rejects blank fields, unsupported kinds, and malformed timestamps", () => {
    expect(() =>
      createCandidateKnowledgeSource(
        " ",
        { knowledgeBaseId: "ckb-1", kind: "url", displayName: "Portfolio" },
        createdAt,
      ),
    ).toThrow(/source id is required/i);
    expect(() =>
      createCandidateKnowledgeSource(
        "source-1",
        { knowledgeBaseId: " ", kind: "url", displayName: "Portfolio" },
        createdAt,
      ),
    ).toThrow(/knowledge base id is required/i);
    expect(() =>
      createCandidateKnowledgeSource(
        "source-1",
        { knowledgeBaseId: "ckb-1", kind: "url", displayName: " " },
        createdAt,
      ),
    ).toThrow(/display name is required/i);
    expect(() =>
      createCandidateKnowledgeSource(
        "source-1",
        { knowledgeBaseId: "ckb-1", kind: "directory" as never, displayName: "Career" },
        createdAt,
      ),
    ).toThrow(/kind must be one of/i);
    expect(() =>
      createCandidateKnowledgeSource(
        "source-1",
        { knowledgeBaseId: "ckb-1", kind: "file", displayName: "Career" },
        "2026-08-21",
      ),
    ).toThrow(/valid ISO timestamp/i);
  });
});

describe("CandidateKnowledgeSourceRetirement", () => {
  const createdAt = "2026-08-21T09:00:00.000Z";

  it("creates the canonical user-requested marker", () => {
    expect(
      createCandidateKnowledgeSourceRetirement({
        sourceId: "  source-1  ",
        retiredAt: createdAt,
        reason: "user-requested",
      }),
    ).toEqual({
      sourceId: "source-1",
      retiredAt: createdAt,
      reason: "user-requested",
    });
  });

  it("rejects unsupported reasons and malformed metadata", () => {
    expect(() =>
      createCandidateKnowledgeSourceRetirement({
        sourceId: "source-1",
        retiredAt: createdAt,
        reason: "imported" as "user-requested",
      }),
    ).toThrow(/reason must be user-requested/i);
    expect(() =>
      createCandidateKnowledgeSourceRetirement({
        sourceId: " ",
        retiredAt: createdAt,
        reason: "user-requested",
      }),
    ).toThrow(/source id is required/i);
    expect(() =>
      createCandidateKnowledgeSourceRetirement({
        sourceId: "source-1",
        retiredAt: "not-a-date",
        reason: "user-requested",
      }),
    ).toThrow(/valid ISO timestamp/i);
  });
});

describe("CandidateKnowledgeSourceVersion", () => {
  const createdAt = "2026-08-21T09:30:00.000Z";

  it("creates canonical first and child version metadata", () => {
    expect(
      createCandidateKnowledgeSourceVersion(
        "  version-1  ",
        {
          sourceId: "  source-1  ",
          version: 1,
          mediaType: "  text/markdown  ",
          checksum: "A".repeat(64),
          sizeBytes: 0,
        },
        createdAt,
      ),
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
      createCandidateKnowledgeSourceVersion(
        "version-2",
        {
          sourceId: "source-1",
          version: 2,
          parentVersionId: "  version-1  ",
          mediaType: "text/markdown",
          checksum: "b".repeat(64),
          sizeBytes: 2048,
        },
        createdAt,
      ).parentVersionId,
    ).toBe("version-1");
  });

  it("rejects invalid lineage, checksums, sizes, fields, and timestamps", () => {
    const valid = {
      sourceId: "source-1",
      version: 1,
      mediaType: "text/plain",
      checksum: "a".repeat(64),
      sizeBytes: 12,
    };

    expect(() =>
      createCandidateKnowledgeSourceVersion("version-1", { ...valid, version: 0 }, createdAt),
    ).toThrow(/positive integer/i);
    expect(() =>
      createCandidateKnowledgeSourceVersion(
        "version-1",
        { ...valid, version: 1, parentVersionId: "version-0" },
        createdAt,
      ),
    ).toThrow(/must not have a parent/i);
    expect(() =>
      createCandidateKnowledgeSourceVersion("version-2", { ...valid, version: 2 }, createdAt),
    ).toThrow(/require a parent/i);
    expect(() =>
      createCandidateKnowledgeSourceVersion(
        "version-2",
        { ...valid, version: 2, parentVersionId: " " },
        createdAt,
      ),
    ).toThrow(/require a parent/i);
    expect(() =>
      createCandidateKnowledgeSourceVersion(
        "version-1",
        { ...valid, checksum: "a".repeat(40) },
        createdAt,
      ),
    ).toThrow(/SHA-256/i);
    expect(() =>
      createCandidateKnowledgeSourceVersion("version-1", { ...valid, sizeBytes: -1 }, createdAt),
    ).toThrow(/nonnegative integer/i);
    expect(() =>
      createCandidateKnowledgeSourceVersion("version-1", { ...valid, sizeBytes: 1.5 }, createdAt),
    ).toThrow(/nonnegative integer/i);
    expect(() => createCandidateKnowledgeSourceVersion(" ", valid, createdAt)).toThrow(
      /version id is required/i,
    );
    expect(() =>
      createCandidateKnowledgeSourceVersion("version-1", { ...valid, sourceId: " " }, createdAt),
    ).toThrow(/source id is required/i);
    expect(() =>
      createCandidateKnowledgeSourceVersion("version-1", { ...valid, mediaType: " " }, createdAt),
    ).toThrow(/media type is required/i);
    expect(() => createCandidateKnowledgeSourceVersion("version-1", valid, "not-a-date")).toThrow(
      /valid ISO timestamp/i,
    );
  });
});

describe("CandidateKnowledgeStore", () => {
  const createdAt = "2026-08-21T12:30:00.000Z";

  it("creates a canonical versioned portable store identity", () => {
    expect(createCandidateKnowledgeStore("  portable-store-1  ", createdAt)).toEqual({
      schemaVersion: 1,
      id: "portable-store-1",
      createdAt,
    });
  });

  it("rejects blank identifiers and non-ISO timestamps", () => {
    expect(() => createCandidateKnowledgeStore("  ", createdAt)).toThrow(/store id is required/i);
    expect(() => createCandidateKnowledgeStore("portable-store-1", "2026-08-21")).toThrow(
      /valid ISO timestamp/i,
    );
    expect(() => createCandidateKnowledgeStore("portable-store-1", ` ${createdAt} `)).toThrow(
      /valid ISO timestamp/i,
    );
  });
});

describe("profileId propagation", () => {
  it("carries profileId through evidence sources in a context snapshot", () => {
    const snapshot = createContextSnapshot(
      validInput({
        evidenceManifest: [
          {
            id: "source-1",
            path: "/local/candidate/resume.md",
            mediaType: "text/markdown",
            checksum,
            profileId: "profile-1",
          },
        ],
        profileId: "profile-1",
      }),
    );
    expect(snapshot.profileId).toBe("profile-1");
    expect(snapshot.evidenceManifest[0]?.profileId).toBe("profile-1");
  });

  it("omits profileId when not provided", () => {
    const snapshot = createContextSnapshot(validInput());
    expect(snapshot.profileId).toBeUndefined();
    expect(snapshot.evidenceManifest[0]?.profileId).toBeUndefined();
  });

  it("trims profileId whitespace", () => {
    const snapshot = createContextSnapshot(validInput({ profileId: "  profile-1  " }));
    expect(snapshot.profileId).toBe("profile-1");
  });
});
