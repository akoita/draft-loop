import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCandidateKnowledgeSelectionSnapshot } from "@draft-loop/domain";
import type {
  CanonicalCandidateProfileFact,
  CanonicalCandidateProfileIssue,
} from "@draft-loop/schemas";
import { openSqliteStorage, type WorkspaceRecord } from "@draft-loop/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCanonicalCandidateProfile } from "./candidate-profile.js";
import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import { reconcileCanonicalCandidateProfileFacts } from "./candidate-profile-extraction.js";
import {
  hasEnoughDistinctFactsForIssue,
  isPairedProfileIssueCode,
} from "./candidate-profile-paired-issues.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-28T08:00:00.000Z";

describe("paired profile issue codes", () => {
  it("requires two distinct facts only for conflict and duplicate issues", () => {
    expect(isPairedProfileIssueCode("conflict-value")).toBe(true);
    expect(isPairedProfileIssueCode("duplicate")).toBe(true);
    expect(isPairedProfileIssueCode("omission")).toBe(false);
    expect(hasEnoughDistinctFactsForIssue("duplicate", ["a", "a"])).toBe(false);
    expect(hasEnoughDistinctFactsForIssue("conflict-date", ["a"])).toBe(false);
    expect(hasEnoughDistinctFactsForIssue("conflict-date", ["a", "b"])).toBe(true);
    expect(hasEnoughDistinctFactsForIssue("omission", [])).toBe(true);
  });
});

const reference = {
  storeId: "store-1",
  knowledgeBaseId: "knowledge-1",
  sourceId: "source-1",
  versionId: "version-1",
  kind: "candidate-provided" as const,
};

function skillFact(id: string, value: string): CanonicalCandidateProfileFact {
  return { id, category: "skill", field: "name", value, provenance: [reference] };
}

function pairedIssue(
  id: string,
  code: CanonicalCandidateProfileIssue["code"],
  factIds: string[],
): CanonicalCandidateProfileIssue {
  return {
    id,
    code,
    severity: "warning",
    status: "open",
    message: "Synthetic model-proposed issue.",
    factIds,
    sourceRefs: [reference],
  };
}

function selection() {
  return createCandidateKnowledgeSelectionSnapshot({
    capturedAt: createdAt,
    entries: [
      {
        storeId: "store-1",
        knowledgeBaseId: "knowledge-1",
        sources: [
          {
            sourceId: "source-1",
            versionId: "version-1",
            lifecycleRevision: {
              knowledgeBaseState: "active",
              knowledgeBaseArchivedAt: null,
              versionId: "version-1",
              version: 1,
              createdAt,
              managed: true,
              originBoundAt: createdAt,
              observation: null,
              retirement: null,
              provenanceFetchedAt: null,
              directory: null,
            },
          },
        ],
      },
    ],
  });
}

describe("reconciling facts that merge into one", () => {
  it("drops the conflict between them and still builds the profile", () => {
    const reconciled = reconcileCanonicalCandidateProfileFacts({
      reusedFacts: [skillFact("fact-reused", "TypeScript")],
      carriedIssues: [],
      extracted: {
        facts: [skillFact("fact-new", "typescript"), skillFact("fact-other", "SQL")],
        issues: [
          pairedIssue("issue-collapsed", "conflict-value", ["fact-reused", "fact-new"]),
          pairedIssue("issue-duplicate", "duplicate", ["fact-new", "fact-reused"]),
          pairedIssue("issue-kept", "conflict-value", ["fact-new", "fact-other"]),
        ],
      },
    });

    expect(reconciled.facts.map((fact) => fact.id)).toEqual(["fact-reused", "fact-other"]);
    const pairedIssues = reconciled.issues.filter((issue) => issue.code !== "omission");
    expect(pairedIssues.map((issue) => [issue.code, issue.factIds])).toEqual([
      ["conflict-value", ["fact-other", "fact-reused"]],
    ]);

    const profile = buildCanonicalCandidateProfile({
      id: "profile-1",
      version: 1,
      parentVersion: null,
      status: "draft",
      createdAt,
      updatedAt: createdAt,
      candidateKnowledgeSelection: selection(),
      facts: reconciled.facts.map((fact) => ({
        ...fact,
        provenance: [...fact.provenance],
      })),
      issues: reconciled.issues.map((issue) => ({
        ...issue,
        factIds: [...issue.factIds],
        sourceRefs: [...issue.sourceRefs],
      })),
    });
    expect(profile.facts).toHaveLength(2);
  });
});

describe("deriving a profile from a proposal with unpaired conflicts", () => {
  let directory: string;
  let storage: ReturnType<typeof openSqliteStorage>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-paired-"));
    storage = openSqliteStorage(join(directory, "workspace.sqlite"));
  });

  afterEach(async () => {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("saves the facts and drops every issue that lacks two distinct facts", async () => {
    const workspace: WorkspaceRecord = {
      id: "workspace-1",
      state: "collecting",
      createdAt,
      updatedAt: createdAt,
    };
    await storage.saveWorkspace(workspace);
    const knowledge = createCandidateKnowledgeStoreService({ now: () => createdAt });
    const storeRoot = join(directory, "knowledge-store");
    const initialized = await knowledge.initializeStore({ storeRoot, displayName: "Career" });
    const knowledgeBaseId = initialized.knowledgeBases[0]?.id;
    if (knowledgeBaseId === undefined) throw new Error("missing knowledge base");
    const sourcePath = join(directory, "career.md");
    await writeFile(sourcePath, "TypeScript and Java", "utf8");
    await knowledge.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });

    const skill = (key: string, value: string, sourceId: string) => ({
      key,
      category: "skill",
      field: "name",
      value,
      evidence: [{ sourceId, quote: value }],
    });
    const saved = await createCanonicalCandidateProfileDerivationService({
      persistence: createCanonicalCandidateProfilePersistenceService(storage),
      extractor: {
        extract: (request) => {
          const sourceId = request.sources[0]?.id ?? "";
          return {
            schemaVersion: 1,
            facts: [
              skill("a", "TypeScript", sourceId),
              skill("b", "typescript", sourceId),
              skill("c", "Java", sourceId),
            ],
            issues: [
              { code: "conflict-value", factKeys: ["c"], sourceIds: [] },
              { code: "conflict-value", factKeys: ["c", "missing"], sourceIds: [] },
              { code: "duplicate", factKeys: ["a", "b"], sourceIds: [] },
              { code: "conflict-value", factKeys: ["a", "c"], sourceIds: [] },
            ],
          };
        },
      },
      knowledgeService: knowledge,
      now: () => createdAt,
    }).deriveCanonicalCandidateProfile({
      workspaceId: workspace.id,
      profileId: "profile-1",
      selections: [{ storeRoot, knowledgeBaseId }],
      allowProviderData: true,
    });

    expect(saved.profile.facts.map((fact) => fact.value).sort()).toEqual(["Java", "TypeScript"]);
    const pairedIssues = saved.profile.issues.filter((issue) => issue.code !== "omission");
    expect(pairedIssues.map((issue) => [issue.code, issue.factIds.length])).toEqual([
      ["conflict-value", 2],
    ]);
  });
});
