import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import { openSqliteStorage, type WorkspaceRecord } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-28T08:00:00.000Z";
const extraction = {
  company: "mistral",
  modelId: "synthetic-model",
  promptTemplateVersion: "synthetic-extraction-v1",
  extractionProfile: { id: "synthetic-extraction-profile", version: 2 },
};

describe("canonical profile derivation extraction identity", () => {
  it("records the extraction route on each derived version and omits it when unknown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-identity-"));
    const storeRoot = join(directory, "knowledge-store");
    const sourcePath = join(directory, "career.md");
    const knowledgeService = createCandidateKnowledgeStoreService({ now: () => createdAt });
    const storage = openSqliteStorage(join(directory, "workspace.sqlite"));
    const workspace: WorkspaceRecord = {
      id: "workspace-1",
      state: "collecting",
      createdAt,
      updatedAt: createdAt,
    };
    const extractor = {
      extract: async (request: {
        readonly sources: readonly { readonly id: string; readonly text: string }[];
      }) => ({
        schemaVersion: 1,
        facts: canonicalCandidateProfileFactCategories.map((category, index) => ({
          key: `fact-${index + 1}`,
          category,
          ...(category === "role" || category === "employer" || category === "date"
            ? { subjectKey: "employment-example" }
            : {}),
          field: `${category}-field`,
          value: request.sources[0]?.text ?? "",
          evidence: [{ sourceId: request.sources[0]?.id, quote: request.sources[0]?.text }],
        })),
        issues: [],
      }),
    };

    try {
      await writeFile(sourcePath, "Candidate-provided representative experience.", "utf8");
      const initialized = await knowledgeService.initializeStore({
        storeRoot,
        displayName: "Career evidence",
      });
      const knowledgeBaseId = initialized.knowledgeBases[0]?.id;
      if (knowledgeBaseId === undefined) throw new Error("missing knowledge base");
      await knowledgeService.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });
      await storage.saveWorkspace(workspace);
      const persistence = createCanonicalCandidateProfilePersistenceService(storage);
      const command = {
        workspaceId: workspace.id,
        selections: [{ storeRoot, knowledgeBaseId }],
        allowProviderData: true,
      };

      const recorded = await createCanonicalCandidateProfileDerivationService({
        persistence,
        extractor,
        extractionIdentity: extraction,
        knowledgeService,
        now: () => createdAt,
      }).deriveCanonicalCandidateProfile({ ...command, profileId: "profile-recorded" });
      const unknown = await createCanonicalCandidateProfileDerivationService({
        persistence,
        extractor,
        knowledgeService,
        now: () => createdAt,
      }).deriveCanonicalCandidateProfile({ ...command, profileId: "profile-unknown" });

      // The derivation also records the sensitivity filtering: the default tiers, no rules here.
      const recordedExtraction = {
        ...extraction,
        sensitivity: { excludedTiers: ["sensitive", "never-share"], rules: [] },
        evidenceKinds: [expect.objectContaining({ kind: expect.any(String) })],
      };
      expect(recorded.profile.extraction).toEqual(recordedExtraction);
      expect(
        (await storage.getLatestCanonicalCandidateProfile(workspace.id, "profile-recorded"))
          ?.profile.extraction,
      ).toEqual(recordedExtraction);
      expect(unknown.profile).not.toHaveProperty("extraction");
      expect(JSON.stringify(recorded)).not.toContain(storeRoot);
    } finally {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
