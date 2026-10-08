import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalCandidateProfileExtractionIdentity } from "@draft-loop/domain";
import { openSqliteStorage, type WorkspaceRecord } from "@draft-loop/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  candidateProfileCapacityFailureMessage,
  candidateProfileCapacityLimitOf,
} from "./candidate-profile-capacity-failure.js";
import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import * as extraction from "./candidate-profile-extraction.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { CandidateProfileProposalValidationError } from "./candidate-profile-proposal-validation.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

vi.mock("./candidate-profile-extraction.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./candidate-profile-extraction.js")>();
  return {
    ...actual,
    processCanonicalCandidateProfileExtraction: vi.fn(
      actual.processCanonicalCandidateProfileExtraction,
    ),
    reconcileCanonicalCandidateProfileFacts: vi.fn(actual.reconcileCanonicalCandidateProfileFacts),
  };
});

const createdAt = "2026-08-28T08:00:00.000Z";
const identity: CanonicalCandidateProfileExtractionIdentity = {
  company: "mistral",
  modelId: "synthetic-model",
  promptTemplateVersion: "synthetic-extraction-v1",
};

describe("canonical profile capacity failures", () => {
  let directory: string;
  let storeRoot: string;
  let knowledgeBaseId: string;
  let storage: ReturnType<typeof openSqliteStorage>;
  const knowledge = createCandidateKnowledgeStoreService({ now: () => createdAt });
  const workspace: WorkspaceRecord = {
    id: "workspace-1",
    state: "collecting",
    createdAt,
    updatedAt: createdAt,
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-capacity-"));
    storeRoot = join(directory, "knowledge-store");
    storage = openSqliteStorage(join(directory, "workspace.sqlite"));
    await storage.saveWorkspace(workspace);
    const initialized = await knowledge.initializeStore({ storeRoot, displayName: "Career" });
    const id = initialized.knowledgeBases[0]?.id;
    if (id === undefined) throw new Error("missing knowledge base");
    knowledgeBaseId = id;
  });

  afterEach(async () => {
    vi.mocked(extraction.reconcileCanonicalCandidateProfileFacts).mockClear();
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function importSource(name: string, text: string): Promise<void> {
    const sourcePath = join(directory, `${name}.md`);
    await writeFile(sourcePath, text, "utf8");
    await knowledge.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });
  }

  function derive() {
    return createCanonicalCandidateProfileDerivationService({
      persistence: createCanonicalCandidateProfilePersistenceService(storage),
      extractor: {
        extract: (request) => ({
          schemaVersion: 1,
          facts: request.sources.map((source, index) => ({
            key: `skill-${index}`,
            category: "skill",
            field: "skill",
            value: source.text.trim(),
            evidence: [{ sourceId: source.id, quote: source.text.trim() }],
          })),
          issues: [],
        }),
      },
      extractionIdentity: identity,
      knowledgeService: knowledge,
      now: () => createdAt,
    }).deriveCanonicalCandidateProfile({
      workspaceId: workspace.id,
      profileId: "profile-1",
      selections: [{ storeRoot, knowledgeBaseId }],
      allowProviderData: true,
    });
  }

  it.each([
    ["profile_too_many_facts", "facts", "The profile would have more than 2,048 facts."],
    ["profile_too_many_issues", "issues", "The profile would have more than 1,024 review issues."],
  ] as const)(
    "records a failed generation when reconciling exceeds the %s limit",
    async (code, limit, expected) => {
      await importSource("a", "TypeScript");
      await derive();
      await importSource("b", "SQL");
      vi.mocked(extraction.reconcileCanonicalCandidateProfileFacts).mockImplementationOnce(() => {
        throw new CandidateProfileProposalValidationError([{ code, count: 1 }]);
      });

      const second = await derive();

      expect(second.profile.version).toBe(2);
      expect(second.profile.facts).toEqual([]);
      expect(second.profile.issues).toHaveLength(1);
      expect(second.profile.issues[0]).toMatchObject({
        code: "omission",
        severity: "error",
        message: candidateProfileCapacityFailureMessage(limit),
      });
      expect(second.profile.issues[0]?.message).toContain(expected);
      expect(second.profile.issues[0]?.message).toContain("Remove or split sources");
      expect(second.profile.issues[0]?.sourceRefs).toHaveLength(2);
    },
  );

  it("records a failed generation when the issue count exceeds the limit without reuse", async () => {
    await importSource("a", "TypeScript");
    const manyIssues = Array.from({ length: 1_025 }, (_, index) => ({
      id: `profile-issue-${index}`,
      code: "omission" as const,
      severity: "warning" as const,
      status: "open" as const,
      message: "Synthetic issue.",
      factIds: [],
      sourceRefs: [],
    }));
    vi.mocked(extraction.processCanonicalCandidateProfileExtraction).mockResolvedValueOnce({
      facts: [],
      issues: manyIssues,
    });

    const result = await derive();

    expect(result.profile.facts).toEqual([]);
    expect(result.profile.issues).toHaveLength(1);
    expect(result.profile.issues[0]).toMatchObject({
      severity: "error",
      message: candidateProfileCapacityFailureMessage("issues"),
    });
  });

  it("does not treat other reconcile errors as capacity failures", async () => {
    await importSource("a", "TypeScript");
    await derive();
    await importSource("b", "SQL");
    vi.mocked(extraction.reconcileCanonicalCandidateProfileFacts).mockImplementationOnce(() => {
      throw new Error("synthetic unexpected failure");
    });

    await expect(derive()).rejects.toThrow(
      "The canonical candidate profile could not be derived from the selected knowledge.",
    );
  });

  it("recognizes capacity errors only by their diagnostic code", () => {
    expect(
      candidateProfileCapacityLimitOf(
        new CandidateProfileProposalValidationError([{ code: "profile_too_many_facts", count: 1 }]),
      ),
    ).toBe("facts");
    expect(
      candidateProfileCapacityLimitOf(
        new CandidateProfileProposalValidationError([
          { code: "profile_duplicate_fact_keys", count: 1 },
        ]),
      ),
    ).toBeUndefined();
    expect(candidateProfileCapacityLimitOf(new Error("profile_too_many_facts"))).toBeUndefined();
  });
});
