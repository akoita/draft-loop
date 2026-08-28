import { describe, expect, it } from "vitest";

import {
  archiveCandidateKnowledgeBase,
  assertIndependentReview,
  type CanonicalCandidateProfileInput,
  type ContextSnapshotInput,
  canonicalCandidateProfileFactCategories,
  canonicalizeModelId,
  createAgentContextReference,
  createCandidateKnowledgeBase,
  createCandidateKnowledgeSelectionSnapshot,
  createCandidateKnowledgeSource,
  createCandidateKnowledgeSourceRetirement,
  createCandidateKnowledgeSourceVersion,
  createCandidateKnowledgeStore,
  createCanonicalCandidateProfile,
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
  validateCandidateKnowledgeSelectionSnapshot,
  validateCanonicalCandidateProfile,
  workflowStates,
} from "./index.js";

const checksum = "a".repeat(64);
const writingPolicyTermRuleId = `writing-policy-${"a".repeat(24)}`;
const writingPolicyPunctuationRuleId = `writing-policy-${"b".repeat(24)}`;

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

function validSelectionRevision(versionId = "version-1") {
  return {
    knowledgeBaseState: "active" as const,
    knowledgeBaseArchivedAt: null,
    versionId,
    version: 1,
    createdAt: "2026-08-12T09:00:00.000Z",
    managed: true,
    originBoundAt: "2026-08-12T09:00:00.000Z",
    observation: null,
    retirement: null,
    provenanceFetchedAt: null,
    directory: null,
  };
}

function validSelectionInput() {
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
            lifecycleRevision: validSelectionRevision("version-z"),
          },
        ],
      },
      {
        storeId: "store-a",
        knowledgeBaseId: "knowledge-a",
        sources: [
          {
            sourceId: "source-b",
            versionId: "version-b",
            lifecycleRevision: validSelectionRevision("version-b"),
          },
          {
            sourceId: "source-a",
            versionId: "version-a",
            lifecycleRevision: validSelectionRevision("version-a"),
          },
        ],
      },
    ],
  };
}

function validCanonicalCandidateProfileInput(): CanonicalCandidateProfileInput {
  const provenance = {
    storeId: "store-z",
    knowledgeBaseId: "knowledge-z",
    sourceId: "source-z",
    versionId: "version-z",
    kind: "candidate-provided" as const,
  };
  const categories = [
    "identity",
    "contact",
    "role",
    "employer",
    "date",
    "achievement",
    "project",
    "skill",
    "certification",
    "education",
    "language",
    "approved-link",
  ] as const;
  return {
    id: "profile-canonical-1",
    version: 1,
    parentVersion: null,
    status: "draft" as const,
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    candidateKnowledgeSelection: validSelectionInput(),
    facts: categories.map((category, index) => ({
      id: `fact-${String(index + 1).padStart(2, "0")}`,
      category,
      ...(category === "role" ? { subjectId: "career-1" } : {}),
      field: category === "approved-link" ? "url" : "value",
      value: `${category}-value`,
      provenance: [provenance],
    })),
    issues: [],
  };
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

  it("canonicalizes and freezes a portable candidate knowledge selection", () => {
    const input = validSelectionInput();
    const snapshot = createCandidateKnowledgeSelectionSnapshot(input);

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      capturedAt: "2026-08-12T10:00:00.000Z",
      entries: [
        {
          storeId: "store-a",
          knowledgeBaseId: "knowledge-a",
          sources: [{ sourceId: "source-a" }, { sourceId: "source-b" }],
        },
        { storeId: "store-z", knowledgeBaseId: "knowledge-z" },
      ],
    });
    expect(validateCandidateKnowledgeSelectionSnapshot(snapshot).valid).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0])).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0]?.sources)).toBe(true);
    const firstEntry = input.entries[0];
    const firstSource = firstEntry?.sources[0];
    if (firstEntry === undefined || firstSource === undefined) {
      throw new Error("The selection fixture must contain a source.");
    }
    firstSource.sourceId = "mutated";
    expect(snapshot.entries[1]?.sources[0]?.sourceId).toBe("source-z");
    expect(JSON.stringify(snapshot)).not.toContain("storeRoot");
    expect(JSON.stringify(snapshot)).not.toContain("checksum");
  });

  it("rejects duplicate selections and lifecycle evidence contradictions", () => {
    const input = validSelectionInput();
    const firstEntry = input.entries[0];
    const firstSource = firstEntry?.sources[0];
    if (firstEntry === undefined || firstSource === undefined) {
      throw new Error("The selection fixture must contain a source.");
    }
    expect(() =>
      createCandidateKnowledgeSelectionSnapshot({
        ...input,
        entries: [firstEntry, firstEntry],
      }),
    ).toThrow(/unique/i);
    expect(() =>
      createCandidateKnowledgeSelectionSnapshot({
        ...input,
        entries: [
          {
            ...firstEntry,
            sources: [
              {
                ...firstSource,
                lifecycleRevision: {
                  ...firstSource.lifecycleRevision,
                  originBoundAt: "2026-08-12T09:00:00.000Z",
                  provenanceFetchedAt: "2026-08-12T09:01:00.000Z",
                },
              },
            ],
          },
        ],
      }),
    ).toThrow(/both file-origin and URL-provenance/i);
  });

  it("rejects lifecycle-ineligible selection evidence", () => {
    const input = validSelectionInput();
    const firstEntry = input.entries[0];
    const firstSource = firstEntry?.sources[0];
    if (firstEntry === undefined || firstSource === undefined) {
      throw new Error("The selection fixture must contain a source.");
    }
    const rejectedRevisions = [
      {
        ...firstSource.lifecycleRevision,
        knowledgeBaseState: "archived" as const,
        knowledgeBaseArchivedAt: "2026-08-12T11:00:00.000Z",
      },
      { ...firstSource.lifecycleRevision, managed: false },
      {
        ...firstSource.lifecycleRevision,
        retirement: {
          retiredAt: "2026-08-12T11:00:00.000Z" as const,
          reason: "user-requested" as const,
        },
      },
      {
        ...firstSource.lifecycleRevision,
        observation: {
          observedVersionId: firstSource.versionId,
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
        ...input,
        entries: [
          {
            ...firstEntry,
            sources: [{ ...firstSource, lifecycleRevision }],
          },
        ],
      };
      expect(() => createCandidateKnowledgeSelectionSnapshot(rejected)).toThrow();
      expect(() =>
        createContextSnapshot(validInput({ candidateKnowledgeSelection: rejected })),
      ).toThrow(SemanticValidationError);
    }
  });

  it("preserves a versioned writing policy separately from evidence", () => {
    const snapshot = createContextSnapshot(
      validInput({
        writingPolicy: {
          content: "  Use ASCII punctuation.  ",
          checksum: "B".repeat(64),
          version: " sha256:bbbbbbbbbbbb ",
          rules: [
            {
              id: `  ${writingPolicyTermRuleId}  `,
              kind: "forbidden-term" as const,
              term: "  secret sauce  ",
              caseSensitive: false,
              wholeWord: true,
            },
            {
              id: writingPolicyPunctuationRuleId,
              kind: "forbidden-characters" as const,
              characters: "—–",
            },
          ],
        },
      }),
    );

    expect(snapshot.writingPolicy).toEqual({
      schemaVersion: 1,
      content: "Use ASCII punctuation.",
      checksum: "b".repeat(64),
      version: "sha256:bbbbbbbbbbbb",
      rules: [
        {
          id: writingPolicyTermRuleId,
          kind: "forbidden-term",
          term: "secret sauce",
          caseSensitive: false,
          wholeWord: true,
        },
        {
          id: writingPolicyPunctuationRuleId,
          kind: "forbidden-characters",
          characters: "—–",
        },
      ],
      lineage: { kind: "workspace" },
    });
    expect(snapshot.evidenceManifest).toHaveLength(1);
    expect(Object.isFrozen(snapshot.writingPolicy?.rules)).toBe(true);
    expect(Object.isFrozen(snapshot.writingPolicy?.rules?.[0])).toBe(true);
    expect(() =>
      createContextSnapshot(
        validInput({
          writingPolicy: { content: "Rules", checksum: "invalid", version: "v1" },
        }),
      ),
    ).toThrow(/writingPolicy\.checksum/i);
  });

  it("normalizes, validates, and freezes optional writing policy preferences", () => {
    const baseWritingPolicy = {
      content: "Preferences",
      checksum,
      version: "sha256:aaaaaaaaaaaa",
    };
    const preferences = {
      tone: " WARM ",
      spellingLocale: "EN-latn-us",
      verbosity: " DETAILED ",
    };
    const snapshot = createContextSnapshot(
      validInput({
        writingPolicy: { ...baseWritingPolicy, preferences } as never,
      }),
    );

    expect(snapshot.writingPolicy?.preferences).toEqual({
      tone: "warm",
      spellingLocale: "en-Latn-US",
      verbosity: "detailed",
    });
    expect(Object.isFrozen(snapshot.writingPolicy?.preferences)).toBe(true);
    preferences.tone = "direct";
    expect(snapshot.writingPolicy?.preferences?.tone).toBe("warm");

    const legacy = createContextSnapshot(validInput({ writingPolicy: baseWritingPolicy }));
    expect(legacy.writingPolicy).toEqual({
      ...baseWritingPolicy,
      schemaVersion: 1,
      lineage: { kind: "workspace" },
    });
    expect(legacy.writingPolicy).not.toHaveProperty("preferences");

    for (const invalidPreferences of [
      { tone: "formal" },
      { spellingLocale: "en_US" },
      { spellingLocale: "a".repeat(17) },
      { verbosity: "verbose" },
      { tone: "warm", unknown: "value" },
    ]) {
      expect(() =>
        createContextSnapshot(
          validInput({
            writingPolicy: { ...baseWritingPolicy, preferences: invalidPreferences } as never,
          }),
        ),
      ).toThrow(/writingPolicy\.preferences/i);
    }
  });

  it("normalizes bounded page, section-order, and emphasis preferences", () => {
    const policy = {
      content: "Preferences",
      checksum,
      version: "sha256:aaaaaaaaaaaa",
      preferences: {
        pageTarget: " TWO-PAGE ",
        sectionOrder: ["  Summary  ", "Work   Experience"],
        emphasisAreas: ["  Distributed   systems  ", "Mentoring"],
      },
    };
    const snapshot = createContextSnapshot(validInput({ writingPolicy: policy as never }));
    expect(snapshot.writingPolicy?.preferences).toEqual({
      pageTarget: "two-page",
      sectionOrder: ["Summary", "Work Experience"],
      emphasisAreas: ["Distributed systems", "Mentoring"],
    });

    for (const preferences of [
      { pageTarget: "three-page" },
      { sectionOrder: [] },
      { sectionOrder: ["Summary", " summary "] },
      { emphasisAreas: [] },
      { emphasisAreas: ["Area", " area "] },
      { sectionOrder: Array.from({ length: 17 }, (_, index) => `Section ${index}`) },
    ]) {
      expect(() =>
        createContextSnapshot(validInput({ writingPolicy: { ...policy, preferences } as never })),
      ).toThrow(/writingPolicy\.preferences/i);
    }
  });

  it("records workspace and opportunity-override policy lineage without mutating the base", () => {
    const base = {
      content: "Base policy",
      checksum,
      version: "sha256:aaaaaaaaaaaa",
    };
    const baseSnapshot = createContextSnapshot(validInput({ writingPolicy: base }));
    expect(baseSnapshot.writingPolicy?.lineage).toEqual({ kind: "workspace" });

    const overrideChecksum = "b".repeat(64);
    const override = createContextSnapshot(
      validInput({
        writingPolicy: {
          content: "Override policy",
          checksum: overrideChecksum,
          version: "sha256:bbbbbbbbbbbb",
          lineage: {
            kind: "opportunity-override",
            base: { version: " sha256:AAAAAAAAAAAA ", checksum: checksum.toUpperCase() },
            override: {
              version: " sha256:bbbbbbbbbbbb ",
              checksum: overrideChecksum.toUpperCase(),
            },
          },
        },
      }),
    );
    expect(override.writingPolicy?.lineage).toEqual({
      kind: "opportunity-override",
      base: { version: "sha256:AAAAAAAAAAAA", checksum },
      override: { version: "sha256:bbbbbbbbbbbb", checksum: overrideChecksum },
    });
    expect(baseSnapshot.writingPolicy?.checksum).toBe(checksum);
    expect(() =>
      createContextSnapshot(
        validInput({
          writingPolicy: {
            content: "Override policy",
            checksum: overrideChecksum,
            version: "sha256:bbbbbbbbbbbb",
            lineage: {
              kind: "opportunity-override",
              base: { version: "base", checksum },
              override: { version: "other", checksum: overrideChecksum },
            },
          },
        }),
      ),
    ).toThrow(/lineage/i);
    expect(() =>
      createContextSnapshot(
        validInput({
          writingPolicy: {
            content: "Override policy",
            checksum: overrideChecksum,
            version: "sha256:bbbbbbbbbbbb",
            lineage: {
              kind: "opportunity-override",
              base: { version: "base", checksum },
              override: { version: "sha256:bbbbbbbbbbbb" },
            },
          } as never,
        }),
      ),
    ).toThrow(/lineage/i);
  });

  it("exports only finite, human-visible anti-formulaic terms", async () => {
    const { defaultAntiFormulaicTerms } = await import("./index.js");
    expect(defaultAntiFormulaicTerms.length).toBeGreaterThan(0);
    expect(defaultAntiFormulaicTerms.length).toBeLessThanOrEqual(16);
    expect(defaultAntiFormulaicTerms.every((term) => term.trim() !== "")).toBe(true);
    expect(Object.isFrozen(defaultAntiFormulaicTerms)).toBe(true);
  });

  it("validates structured writing policy rule ids, kinds, and bounds", () => {
    const basePolicy = {
      content: "Rules",
      checksum,
      version: "sha256:aaaaaaaaaaaa",
      rules: [
        {
          id: `writing-policy-${"c".repeat(24)}`,
          kind: "forbidden-term" as const,
          term: "secret",
          caseSensitive: false,
          wholeWord: true,
        },
      ],
    };
    const baseRule = basePolicy.rules[0];
    if (baseRule === undefined) throw new Error("the policy fixture is incomplete");
    expect(() => createContextSnapshot(validInput({ writingPolicy: basePolicy }))).not.toThrow();
    expect(() =>
      createContextSnapshot(
        validInput({
          writingPolicy: {
            ...basePolicy,
            rules: [{ ...baseRule, id: "rule-readable" }],
          },
        }),
      ),
    ).toThrow(/opaque compiler rule id/i);
    expect(() =>
      createContextSnapshot(
        validInput({
          writingPolicy: {
            ...basePolicy,
            rules: [baseRule, { ...baseRule }],
          },
        }),
      ),
    ).toThrow(/writingPolicy\.rules\[1\]\.id/i);
    expect(() =>
      createContextSnapshot(
        validInput({
          writingPolicy: {
            ...basePolicy,
            rules: [
              {
                id: `writing-policy-${"d".repeat(24)}`,
                kind: "forbidden-characters",
                characters: "a",
              },
            ],
          },
        }),
      ),
    ).toThrow(/writingPolicy\.rules\[0\]\.characters/i);
    expect(() =>
      createContextSnapshot(
        validInput({
          writingPolicy: {
            ...basePolicy,
            rules: Array.from({ length: 65 }, (_, index) => ({
              id: `writing-policy-${index.toString(16).padStart(24, "0")}`,
              kind: "forbidden-term" as const,
              term: "secret",
              caseSensitive: false,
              wholeWord: true,
            })),
          },
        }),
      ),
    ).toThrow(/writingPolicy\.rules/i);
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

  it("preserves an optional candidate knowledge selection in the context snapshot", () => {
    const selection = createCandidateKnowledgeSelectionSnapshot(validSelectionInput());
    const snapshot = createContextSnapshot(validInput({ candidateKnowledgeSelection: selection }));

    expect(snapshot.candidateKnowledgeSelection).toEqual(selection);
    expect(Object.isFrozen(snapshot.candidateKnowledgeSelection)).toBe(true);
    expect(Object.isFrozen(snapshot.candidateKnowledgeSelection?.entries[0])).toBe(true);
  });

  it("normalizes, validates, and freezes an optional opportunity brief reference", () => {
    const reference = {
      briefId: "  brief-reviewed  ",
      version: 2,
      checksum: "a".repeat(64),
    };
    const snapshot = createContextSnapshot(validInput({ opportunityBriefReference: reference }));

    expect(snapshot.opportunityBriefReference).toEqual({
      briefId: "brief-reviewed",
      version: 2,
      checksum: "a".repeat(64),
    });
    expect(Object.isFrozen(snapshot.opportunityBriefReference)).toBe(true);
    reference.briefId = "changed";
    reference.checksum = "b".repeat(64);
    expect(snapshot.opportunityBriefReference).toEqual({
      briefId: "brief-reviewed",
      version: 2,
      checksum: "a".repeat(64),
    });

    for (const opportunityBriefReference of [
      null,
      {},
      { briefId: " ", version: 1, checksum },
      { briefId: "brief-1", version: 0, checksum },
      { briefId: "brief-1", version: 1.5, checksum },
      { briefId: "brief-1", version: Number.MAX_SAFE_INTEGER + 1, checksum },
      { briefId: "brief-1", version: 1, checksum: "a".repeat(63) },
      { briefId: "brief-1", version: 1, checksum: "g".repeat(64) },
      { briefId: "brief-1", version: 1, checksum: "A".repeat(64) },
      { briefId: "brief-1", version: 1, checksum, path: "/private/brief" },
    ]) {
      expect(() =>
        createContextSnapshot(
          validInput({ opportunityBriefReference: opportunityBriefReference as never }),
        ),
      ).toThrow(/opportunityBriefReference/i);
    }
  });

  it("keeps schema-v1 context snapshots compatible without an opportunity reference", () => {
    const snapshot = createContextSnapshot(validInput());

    expect(snapshot).not.toHaveProperty("opportunityBriefReference");
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

describe("CanonicalCandidateProfile", () => {
  it("creates a complete, path-free profile without losing fact categories", () => {
    const input = validCanonicalCandidateProfileInput();
    const profile = createCanonicalCandidateProfile(input);

    expect(profile).toMatchObject({
      schemaVersion: 1,
      id: "profile-canonical-1",
      version: 1,
      parentVersion: null,
      status: "draft",
    });
    expect(profile.facts.map((fact) => fact.category).sort()).toEqual(
      [...canonicalCandidateProfileFactCategories].sort(),
    );
    expect(profile.facts).toHaveLength(12);
    expect(profile.facts.find((fact) => fact.category === "role")?.subjectId).toBe("career-1");
    expect(profile.facts[0]?.provenance[0]).toEqual({
      storeId: "store-z",
      knowledgeBaseId: "knowledge-z",
      sourceId: "source-z",
      versionId: "version-z",
      kind: "candidate-provided",
    });
    expect(JSON.stringify(profile)).not.toContain("/local/");
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.facts)).toBe(true);
    expect(Object.isFrozen(profile.facts[0])).toBe(true);
    expect(Object.isFrozen(profile.facts[0]?.provenance)).toBe(true);
  });

  it("canonicalizes deterministic fact, provenance, issue, and selection order", () => {
    const input = validCanonicalCandidateProfileInput();
    const reversedFacts = [...input.facts].reverse().map((fact, index) => ({
      ...fact,
      provenance: index === 0 ? [...fact.provenance].reverse() : fact.provenance,
    }));
    const unorderedInput = {
      ...input,
      facts: reversedFacts,
      issues: [
        {
          id: "issue-z",
          code: "omission",
          severity: "warning",
          status: "open",
          message: "A field needs candidate confirmation.",
          factIds: ["fact-02", "fact-01"],
        },
        {
          id: "issue-a",
          code: "duplicate",
          severity: "error",
          status: "resolved",
          message: "Duplicate values were reviewed.",
          factIds: ["fact-03", "fact-02"],
        },
      ],
    } satisfies CanonicalCandidateProfileInput;

    const profile = createCanonicalCandidateProfile(unorderedInput);
    expect(profile.facts[0]?.id).toBe("fact-01");
    expect(profile.issues.map((issue) => issue.id)).toEqual(["issue-a", "issue-z"]);
    expect(profile.issues[1]?.factIds).toEqual(["fact-01", "fact-02"]);
    expect(profile.candidateKnowledgeSelection?.entries[0]?.storeId).toBe("store-a");
  });

  it("requires candidate-provided provenance and exact selection membership", () => {
    const input = validCanonicalCandidateProfileInput();
    const fact = input.facts[0];
    const reference = fact?.provenance[0];
    if (fact === undefined || reference === undefined) {
      throw new Error("the profile fixture is incomplete");
    }

    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        facts: [
          {
            ...fact,
            provenance: [{ ...reference, kind: "public-corroboration" }],
          },
        ],
      }),
    ).toThrow(/candidate-provided/i);
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        facts: [
          {
            ...fact,
            provenance: [
              {
                ...reference,
                sourceId: "not-selected",
              },
            ],
          },
        ],
      }),
    ).toThrow(/exact source version/i);
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        facts: [
          {
            ...fact,
            provenance: [
              {
                ...reference,
                kind: "candidate-provided",
              },
              {
                ...reference,
                kind: "public-corroboration",
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("does not conflate provenance identities containing key separators", () => {
    const input = validCanonicalCandidateProfileInput();
    const fact = input.facts[0];
    const selection = input.candidateKnowledgeSelection;
    const entry = selection?.entries[0];
    const source = entry?.sources[0];
    if (
      fact === undefined ||
      selection === undefined ||
      entry === undefined ||
      source === undefined
    ) {
      throw new Error("the profile fixture is incomplete");
    }

    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        candidateKnowledgeSelection: {
          ...selection,
          entries: [
            {
              ...entry,
              storeId: "store\u0000knowledge",
              knowledgeBaseId: "base",
              sources: [{ ...source, sourceId: "source", versionId: "version" }],
            },
          ],
        },
        facts: [
          {
            ...fact,
            provenance: [
              {
                storeId: "store",
                knowledgeBaseId: "knowledge\u0000base",
                sourceId: "source",
                versionId: "version",
                kind: "candidate-provided",
              },
            ],
          },
        ],
      }),
    ).toThrow(/exact source version/i);
  });

  it("blocks reviewed status on open errors and preserves visible conflicts", () => {
    const input = validCanonicalCandidateProfileInput();
    const reviewedInput = {
      ...input,
      status: "reviewed" as const,
      reviewedAt: "2026-08-12T11:00:00.000Z",
      updatedAt: "2026-08-12T11:00:00.000Z",
      issues: [
        {
          id: "issue-conflict",
          code: "conflict-date",
          severity: "error",
          status: "open",
          message: "Two dates require candidate review.",
          factIds: ["fact-01", "fact-02"],
          sourceRefs: [input.facts[0]?.provenance[0]].filter(
            (reference): reference is NonNullable<typeof reference> => reference !== undefined,
          ),
        },
      ],
    } satisfies CanonicalCandidateProfileInput;
    expect(() => createCanonicalCandidateProfile(reviewedInput)).toThrow(/open error/i);

    const acknowledgedInput = {
      ...reviewedInput,
      issues: [
        {
          id: "issue-conflict",
          code: "conflict-date" as const,
          severity: "error" as const,
          status: "acknowledged" as const,
          message: "Two dates require candidate review.",
          factIds: ["fact-01", "fact-02"],
          sourceRefs: reviewedInput.issues[0]?.sourceRefs ?? [],
        },
      ],
    } satisfies CanonicalCandidateProfileInput;
    expect(createCanonicalCandidateProfile(acknowledgedInput).status).toBe("reviewed");
  });

  it("requires reviewed profiles to bind a selection and retain at least one fact", () => {
    const input = validCanonicalCandidateProfileInput();
    const { candidateKnowledgeSelection: _selection, ...withoutSelection } = input;
    expect(() =>
      createCanonicalCandidateProfile({
        ...withoutSelection,
        status: "reviewed",
        reviewedAt: "2026-08-12T11:00:00.000Z",
        updatedAt: "2026-08-12T11:00:00.000Z",
      }),
    ).toThrow(/candidateKnowledgeSelection/i);

    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        status: "reviewed",
        reviewedAt: "2026-08-12T11:00:00.000Z",
        updatedAt: "2026-08-12T11:00:00.000Z",
        facts: [],
      }),
    ).toThrow(/at least one fact/i);
  });

  it("requires every issue source reference to be selected and correlated for conflicts", () => {
    const input = validCanonicalCandidateProfileInput();
    const firstFact = input.facts[0];
    const secondFact = input.facts[1];
    const selectedReference = firstFact?.provenance[0];
    if (firstFact === undefined || secondFact === undefined || selectedReference === undefined) {
      throw new Error("the profile fixture is incomplete");
    }
    const conflict = {
      id: "issue-date-conflict",
      code: "conflict-date" as const,
      severity: "error" as const,
      status: "open" as const,
      message: "Two dates require review.",
      factIds: [firstFact.id, secondFact.id],
      sourceRefs: [selectedReference],
    };
    const { candidateKnowledgeSelection: _selection, ...withoutSelection } = input;
    expect(() =>
      createCanonicalCandidateProfile({
        ...withoutSelection,
        facts: [],
        issues: [conflict],
      }),
    ).toThrow(/requires a bound candidateKnowledgeSelection/i);

    const unrelatedReference = {
      storeId: "store-a",
      knowledgeBaseId: "knowledge-a",
      sourceId: "source-b",
      versionId: "version-b",
      kind: "candidate-provided" as const,
    };
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        issues: [{ ...conflict, sourceRefs: [unrelatedReference] }],
      }),
    ).toThrow(/involved profile facts/i);
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        issues: [{ ...conflict, factIds: [firstFact.id] }],
      }),
    ).toThrow(/at least two distinct/i);
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        issues: [{ ...conflict, factIds: [firstFact.id, "unknown-fact"] }],
      }),
    ).toThrow(/existing profile fact/i);
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        issues: [
          {
            ...conflict,
            sourceRefs: [selectedReference],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("requires every reviewed issue, including warnings, to be acknowledged or resolved", () => {
    const input = validCanonicalCandidateProfileInput();
    const draftIssue = {
      id: "issue-omission",
      code: "omission" as const,
      severity: "warning" as const,
      status: "open" as const,
      message: "A candidate field remains to be confirmed.",
    };
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        status: "reviewed",
        reviewedAt: "2026-08-12T11:00:00.000Z",
        updatedAt: "2026-08-12T11:00:00.000Z",
        issues: [draftIssue],
      }),
    ).toThrow(/acknowledged or resolved/i);
    expect(
      createCanonicalCandidateProfile({
        ...input,
        status: "reviewed",
        reviewedAt: "2026-08-12T11:00:00.000Z",
        updatedAt: "2026-08-12T11:00:00.000Z",
        issues: [{ ...draftIssue, status: "resolved" as const }],
      }).status,
    ).toBe("reviewed");
  });

  it("enforces version lineage and timestamp invariants", () => {
    const input = validCanonicalCandidateProfileInput();
    expect(() =>
      createCanonicalCandidateProfile({ ...input, version: 1, parentVersion: 2 }),
    ).toThrow(/parentVersion null/i);
    expect(() =>
      createCanonicalCandidateProfile({ ...input, version: 3, parentVersion: 1 }),
    ).toThrow(/immediate predecessor/i);
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        updatedAt: "2026-08-12T09:00:00.000Z",
      }),
    ).toThrow(/updatedAt/i);
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        status: "draft",
        reviewedAt: "2026-08-12T10:00:00.000Z",
      }),
    ).toThrow(/omit reviewedAt/i);
  });

  it("rejects duplicate ids, unsupported keys, and unbound facts", () => {
    const input = validCanonicalCandidateProfileInput();
    const firstFact = input.facts[0];
    if (firstFact === undefined) throw new Error("the profile fixture is incomplete");
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        facts: [firstFact, { ...firstFact }],
      }),
    ).toThrow(/fact ids must be unique/i);
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        facts: [{ ...firstFact, unknown: "not allowed" } as never],
      }),
    ).toThrow(/not supported/i);
    const { candidateKnowledgeSelection: _selection, ...withoutSelection } = input;
    expect(() => createCanonicalCandidateProfile(withoutSelection)).toThrow(
      /candidateKnowledgeSelection/i,
    );
    expect(validateCanonicalCandidateProfile({ ...input, facts: [{ ...firstFact }] }).valid).toBe(
      true,
    );
  });

  it("does not accept unknown or path-bearing selection fields", () => {
    const input = validCanonicalCandidateProfileInput();
    const selection = input.candidateKnowledgeSelection;
    if (selection === undefined) throw new Error("the profile fixture is incomplete");
    const entry = selection.entries[0];
    if (entry === undefined) throw new Error("the selection fixture is incomplete");
    expect(() =>
      createCanonicalCandidateProfile({
        ...input,
        candidateKnowledgeSelection: {
          ...selection,
          entries: [{ ...entry, rootPath: "/private/candidate" }],
        } as never,
      }),
    ).toThrow(/not supported/i);
  });

  it("round-trips through JSON while retaining immutable canonical data", () => {
    const profile = createCanonicalCandidateProfile(validCanonicalCandidateProfileInput());
    const reloaded = createCanonicalCandidateProfile(JSON.parse(JSON.stringify(profile)));
    expect(reloaded).toEqual(profile);
    expect(Object.isFrozen(reloaded)).toBe(true);
    expect(Object.isFrozen(reloaded.candidateKnowledgeSelection)).toBe(true);
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
