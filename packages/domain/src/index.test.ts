import { describe, expect, it } from "vitest";

import {
  assertProviderDiversity,
  type ContextSnapshotInput,
  createAgentContextReference,
  createContextSnapshot,
  createWorkspace,
  hasProviderDiversity,
  type ModelConfigurationInput,
  type ModelSelection,
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

  it("rejects same-company pairings when cross-company mode is required", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const input = validInput({
      modelConfiguration: {
        ...configuration,
        critic: {
          ...configuration.critic,
          company: "anthropic",
        },
      },
    });

    expect(() => createContextSnapshot(input)).toThrow(/different model companies/i);
    const author = configuration.author as ModelSelection;
    const critic = { ...author, role: "critic" } as ModelSelection;
    expect(hasProviderDiversity(author, critic)).toBe(false);
    expect(() => assertProviderDiversity(author, critic)).toThrow(/different model companies/i);
  });

  it("treats provider company whitespace as non-distinct", () => {
    const configuration = validInput().modelConfiguration as ModelConfigurationInput;
    const author = {
      ...configuration.author,
      company: " anthropic ",
    } as ModelSelection;
    const critic = {
      ...configuration.critic,
      company: "anthropic",
    } as ModelSelection;

    expect(hasProviderDiversity(author, critic)).toBe(false);
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
