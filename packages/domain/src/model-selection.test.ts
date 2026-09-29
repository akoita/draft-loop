import { describe, expect, it } from "vitest";
import {
  type ContextSnapshotInput,
  createContextSnapshot,
  validateContextSnapshotInput,
} from "./index.js";
import type { ModelProfile } from "./model-profile.js";

function validProfile(): ModelProfile {
  return {
    id: " author-profile ",
    version: 2,
    provider: " anthropic ",
    modelId: " claude-exact ",
    tier: "standard",
    roles: ["author"],
    runtime: {
      effort: "high",
      maxOutputTokens: 4_000,
      thinking: { mode: "budgeted", maxTokens: 1_000 },
    },
    knownLimits: { maxOutputTokens: 8_000, contextWindowTokens: 32_000 },
  };
}

function validInput(authorProfile?: unknown): ContextSnapshotInput {
  const author = {
    company: " anthropic ",
    modelId: " claude-exact ",
    role: "author",
    promptTemplateVersion: " author-v3 ",
    ...(authorProfile === undefined ? {} : { profile: authorProfile }),
  };

  return {
    id: "snapshot-1",
    workspaceId: "workspace-1",
    createdAt: "2026-08-12T10:00:00.000Z",
    jobDescription: "Build reliable local-first software.",
    requirements: [{ id: "requirement-1", text: "TypeScript experience", priority: "critical" }],
    candidateInstructions: "Use concise, evidence-backed language.",
    language: "en",
    outputConstraints: { format: "markdown", requiredSections: ["Experience"] },
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
        checksum: "a".repeat(64),
      },
    ],
    modelConfiguration: {
      author,
      critic: {
        company: "openai",
        modelId: "gpt-exact",
        role: "critic",
        promptTemplateVersion: "critic-v2",
      },
      requireProviderDiversity: true,
    },
  } as unknown as ContextSnapshotInput;
}

function validationIssues(input: ContextSnapshotInput) {
  return validateContextSnapshotInput(input).issues;
}

describe("model selection profile snapshots", () => {
  it("keeps a detached, normalized profile beside the prompt version in a context snapshot", () => {
    const profile = validProfile();
    const snapshot = createContextSnapshot(validInput(profile));

    expect(snapshot.modelConfiguration.author.promptTemplateVersion).toBe("author-v3");
    expect(snapshot.modelConfiguration.author.profile).toEqual({
      ...profile,
      id: "author-profile",
      provider: "anthropic",
      modelId: "claude-exact",
    });

    const mutableProfile = profile as unknown as {
      id: string;
      roles: string[];
      runtime: { thinking: { maxTokens: number } };
    };
    mutableProfile.id = "changed-profile";
    mutableProfile.roles[0] = "critic";
    mutableProfile.runtime.thinking.maxTokens = 3_000;

    expect(snapshot.modelConfiguration.author.profile?.id).toBe("author-profile");
    expect(snapshot.modelConfiguration.author.profile?.roles).toEqual(["author"]);
    expect(snapshot.modelConfiguration.author.profile?.runtime.thinking).toEqual({
      mode: "budgeted",
      maxTokens: 1_000,
    });
  });

  it("preserves legacy selections without injecting a profile", () => {
    const snapshot = createContextSnapshot(validInput());

    expect(snapshot.modelConfiguration.author).toEqual({
      company: "anthropic",
      modelId: "claude-exact",
      role: "author",
      promptTemplateVersion: "author-v3",
    });
    expect("profile" in snapshot.modelConfiguration.author).toBe(false);
  });

  it.each([
    [
      "unexpected profile keys",
      (profile: Record<string, unknown>) => ({ ...profile, extra: true }),
    ],
    [
      "sparse profile roles",
      (profile: Record<string, unknown>) => ({ ...profile, roles: new Array(1) }),
    ],
    [
      "unknown profile roles",
      (profile: Record<string, unknown>) => ({ ...profile, roles: ["tool"] }),
    ],
    [
      "unsafe profile versions",
      (profile: Record<string, unknown>) => ({ ...profile, version: Number.MAX_SAFE_INTEGER + 1 }),
    ],
    [
      "non-positive output budgets",
      (profile: Record<string, unknown>) => ({
        ...profile,
        runtime: { ...(profile.runtime as object), maxOutputTokens: 0 },
      }),
    ],
    [
      "thinking budgets above the output ceiling",
      (profile: Record<string, unknown>) => ({
        ...profile,
        runtime: {
          ...(profile.runtime as object),
          maxOutputTokens: 1_000,
          thinking: { mode: "budgeted", maxTokens: 1_001 },
        },
        knownLimits: { ...(profile.knownLimits as object), maxOutputTokens: 2_000 },
      }),
    ],
  ])("rejects %s", (_case, mutateProfile) => {
    const profile = mutateProfile(validProfile() as unknown as Record<string, unknown>);
    const issues = validationIssues(validInput(profile));

    expect(
      issues.some((issue) => issue.field.startsWith("modelConfiguration.author.profile")),
    ).toBe(true);
  });

  it.each([
    ["provider", { provider: "openai" }, "modelConfiguration.author.profile.provider"],
    ["exact model id", { modelId: "claude-other" }, "modelConfiguration.author.profile.modelId"],
    ["role", { roles: ["critic"] }, "modelConfiguration.author.profile.roles"],
  ])(
    "rejects a profile whose %s disagrees with its selection",
    (_case, override, expectedField) => {
      const profile = { ...validProfile(), ...override };
      const issues = validationIssues(validInput(profile));

      expect(issues.some((issue) => issue.field === expectedField)).toBe(true);
    },
  );
});
