import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import { estimateCanonicalProfileExtraction } from "./candidate-profile-derivation-estimate.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-28T08:00:00.000Z";
const pricing = { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 };

describe("career profile derivation estimate (#3182)", () => {
  it("prices a small source as one call", () => {
    const estimate = estimateCanonicalProfileExtraction({
      sources: [{ id: "s1", text: "x".repeat(12_000) }],
      reusedSourceCount: 2,
      budget: { maxOutputTokens: 32_000, pricing },
    });
    // Low: (3,000 + 3,000) input and 10,200 output tokens; high: (4,000 + 3,000) and 19,200.
    expect(estimate).toEqual({
      reusedSourceCount: 2,
      extractedSourceCount: 1,
      extractedCharacters: 12_000,
      calls: 1,
      estimatedUsd: { low: 0.17, high: 0.31 },
    });
  });

  it("counts the windows of a large source and leaves an unpriced model unpriced", () => {
    const text = Array.from({ length: 2_000 }, (_, index) => `Line ${index} of a long CV.`).join(
      "\n",
    );
    const estimate = estimateCanonicalProfileExtraction({
      sources: [{ id: "s1", text: text.repeat(4) }],
      reusedSourceCount: 0,
    });
    expect(estimate.calls).toBeGreaterThan(1);
    expect(estimate.estimatedUsd).toBeNull();
  });

  it("estimates nothing to extract when every source is reused", () => {
    expect(
      estimateCanonicalProfileExtraction({
        sources: [],
        reusedSourceCount: 3,
        budget: { pricing },
      }),
    ).toEqual({
      reusedSourceCount: 3,
      extractedSourceCount: 0,
      extractedCharacters: 0,
      calls: 0,
      estimatedUsd: { low: 0, high: 0 },
    });
  });

  it("reads the selection like a derivation and calls no model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-estimate-"));
    const storeRoot = join(directory, "knowledge-store");
    const sourcePath = join(directory, "career.md");
    const knowledgeService = createCandidateKnowledgeStoreService({ now: () => createdAt });
    const storage = openSqliteStorage(join(directory, "workspace.sqlite"));
    const extract = vi.fn(async (request) => ({
      schemaVersion: 1,
      facts: canonicalCandidateProfileFactCategories.map((category, index) => ({
        key: `fact-${index + 1}`,
        category,
        ...(category === "role" || category === "employer" || category === "date"
          ? { subjectKey: "employment-example" }
          : {}),
        field: `${category}-field`,
        value: request.sources[0]?.text ?? "",
        evidence: [{ sourceId: request.sources[0]?.id ?? "", quote: request.sources[0]?.text }],
      })),
      issues: [],
    }));
    try {
      const text = "# Career history\n\nCandidate-provided representative experience.";
      await writeFile(sourcePath, text, "utf8");
      const initialized = await knowledgeService.initializeStore({
        storeRoot,
        displayName: "Career evidence",
      });
      const knowledgeBaseId = initialized.knowledgeBases[0]?.id ?? "";
      await knowledgeService.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });
      await storage.saveWorkspace({
        id: "workspace-1",
        state: "collecting",
        createdAt,
        updatedAt: createdAt,
      });
      const service = createCanonicalCandidateProfileDerivationService({
        persistence: createCanonicalCandidateProfilePersistenceService(storage),
        extractor: { extract },
        extractionIdentity: {
          company: "anthropic",
          modelId: "fixture-model",
          promptTemplateVersion: "fixture-prompt",
        },
        extractionBudget: { pricing },
        knowledgeService,
        now: () => createdAt,
      });
      const command = {
        workspaceId: "workspace-1",
        profileId: "profile-1",
        selections: [{ storeRoot, knowledgeBaseId }],
      };

      const before = await service.estimateCanonicalCandidateProfileDerivation(command);
      expect(before).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 1, calls: 1 });
      expect(before.extractedCharacters).toBeGreaterThan(0);
      expect(extract).not.toHaveBeenCalled();
      expect(JSON.stringify(before)).not.toContain("Candidate-provided");

      await service.deriveCanonicalCandidateProfile({ ...command, allowProviderData: true });
      expect(await service.estimateCanonicalCandidateProfileDerivation(command)).toMatchObject({
        reusedSourceCount: 1,
        extractedSourceCount: 0,
        calls: 0,
      });
      expect(extract).toHaveBeenCalledTimes(1);
    } finally {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
