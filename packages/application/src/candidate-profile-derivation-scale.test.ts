import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCandidateKnowledgeSelectionSnapshot } from "@draft-loop/domain";
import type { JsonObject } from "@draft-loop/providers";
import { openSqliteStorage } from "@draft-loop/storage";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import { beforeEach, describe, expect, it } from "vitest";

import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import {
  type CanonicalProfileExtractionControls,
  clearCanonicalProfileExtractionPartCache,
  executeCanonicalProfileExtractionWithFallback,
} from "./canonical-profile-extraction-fallback.js";

const createdAt = "2026-08-28T08:00:00.000Z";
const sharedSkills = ["TypeScript", "PostgreSQL", "Kubernetes", "Terraform"] as const;
const employers = ["Northwind Systems", "Contoso Labs", "Fabrikam Works"] as const;

const controls: CanonicalProfileExtractionControls = {
  model: {
    company: "anthropic",
    modelId: "claude-sonnet-5-5",
    role: "author",
    promptTemplateVersion: "scale-test-v1",
  },
  systemPrompt: "Extraction prompt.",
  maxOutputTokens: 8192,
  dataPolicy: {
    allowTransmission: true,
    allowedCompanies: ["anthropic"],
    sensitiveData: true,
    sensitiveDataAcknowledged: true,
  },
};

/** About 200,000 characters of synthetic Markdown: many headings, each followed by bullets. */
function syntheticCareerMarkdown(): string {
  const sections: string[] = ["# Career history\n"];
  let length = sections[0]?.length ?? 0;
  for (let index = 0; length < 200_000; index += 1) {
    const employer = employers[index % employers.length];
    const bullets = Array.from({ length: 12 }, (_, bullet) => {
      const skill = sharedSkills[(index + bullet) % sharedSkills.length];
      return `- Delivered synthetic milestone ${index}.${bullet} using ${skill} for the ${employer} platform team, covering design, review, rollout and follow-up work.`;
    });
    const section = `## Engineer ${index} at ${employer}\n\n${bullets.join("\n")}\n`;
    sections.push(section);
    length += section.length + 1;
  }
  return sections.join("\n");
}

/** A grounded batch per planned part: every fact quotes an exact line of the part's own text. */
function batchFor(sourceId: string, text: string): JsonObject {
  const lines = text.split("\n");
  const facts: JsonObject[] = [];
  const heading = lines.find((line) => line.startsWith("## "));
  const employer = employers.find((candidate) => heading?.includes(candidate));
  if (heading !== undefined && employer !== undefined) {
    const subjectKey = `employment-${heading.match(/^## Engineer (\d+)/u)?.[1] ?? "unknown"}`;
    facts.push(
      {
        key: "employer",
        category: "employer",
        subjectKey,
        field: "name",
        value: employer,
        evidence: [{ sourceId, quote: heading }],
      },
      {
        key: "role",
        category: "role",
        subjectKey,
        field: "title",
        value: heading.slice(3, heading.indexOf(" at ")),
        evidence: [{ sourceId, quote: heading }],
      },
    );
  }
  const bullets = lines.filter((entry) => entry.startsWith("- ")).slice(0, 8);
  for (const [lineIndex, line] of bullets.entries()) {
    const skill = sharedSkills.find((candidate) => line.includes(candidate));
    if (skill === undefined) continue;
    facts.push(
      {
        key: `skill-${lineIndex}`,
        category: "skill",
        subjectKey: `skill-${skill.toLowerCase()}`,
        field: "name",
        value: skill,
        evidence: [{ sourceId, quote: line }],
      },
      {
        key: `achievement-${lineIndex}`,
        category: "achievement",
        subjectKey: `achievement-${line.slice(2, 40).replace(/\W+/gu, "-").toLowerCase()}`,
        field: "summary",
        value: line.slice(2),
        evidence: [{ sourceId, quote: line }],
      },
    );
  }
  return { schemaVersion: 1, facts, issues: [] };
}

describe("canonical candidate profile derivation at real scale", () => {
  beforeEach(() => {
    clearCanonicalProfileExtractionPartCache();
  });

  it("derives and saves a profile from one 200,000-character source planned into many parts", async () => {
    const content = syntheticCareerMarkdown();
    expect(content.length).toBeGreaterThan(190_000);
    expect(content.length).toBeLessThan(215_000);

    const versionId = "version-source-career";
    const selected = createCandidateKnowledgeSelectionSnapshot({
      capturedAt: createdAt,
      entries: [
        {
          storeId: "store-1",
          knowledgeBaseId: "knowledge-1",
          sources: [
            {
              sourceId: "source-career",
              versionId,
              lifecycleRevision: {
                knowledgeBaseState: "active",
                knowledgeBaseArchivedAt: null,
                versionId,
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
    const bytes = new TextEncoder().encode(content);
    const handle = {
      descriptor: { schemaVersion: 1, id: "store-1", createdAt },
      getCandidateKnowledgeSourceSensitivityRules: async () => undefined,
      readManagedCandidateKnowledgeSourceVersion: async () => ({
        metadata: {
          knowledgeBaseId: "knowledge-1",
          kind: "file",
          id: versionId,
          sourceId: "source-career",
          version: 1,
          parentVersionId: null,
          mediaType: "text/markdown",
          checksum: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.byteLength,
          createdAt,
        },
        bytes,
      }),
      close: async () => undefined,
    } as unknown as CandidateKnowledgeStoreHandle;

    const directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-scale-"));
    const storage = openSqliteStorage(join(directory, "workspace.sqlite"));
    let partCount = 0;
    try {
      await storage.saveWorkspace({
        id: "workspace-1",
        state: "collecting",
        createdAt,
        updatedAt: createdAt,
      });
      const service = createCanonicalCandidateProfileDerivationService({
        persistence: createCanonicalCandidateProfilePersistenceService(storage),
        extractor: {
          extract: (request) =>
            executeCanonicalProfileExtractionWithFallback(
              {
                execute: async (modelRequest) => {
                  partCount += 1;
                  const [source] = modelRequest.input.sources as readonly {
                    id: string;
                    text: string;
                  }[];
                  return { output: batchFor(source?.id ?? "", source?.text ?? "") } as never;
                },
              },
              request,
              controls,
            ),
        },
        knowledgeService: { createKnowledgeSelectionSnapshot: async () => selected },
        openKnowledgeStore: async () => handle,
        now: () => createdAt,
      });

      const saved = await service.deriveCanonicalCandidateProfile({
        workspaceId: "workspace-1",
        profileId: "profile-1",
        selections: [{ storeRoot: "/private/store", knowledgeBaseId: "knowledge-1" }],
        allowProviderData: true,
      });

      expect(partCount).toBeGreaterThanOrEqual(25);
      expect(saved.profile.facts.length).toBeGreaterThan(100);
      expect(saved.profile.facts.length).toBeLessThan(2_048);
      const persisted = await createCanonicalCandidateProfilePersistenceService(
        storage,
      ).getLatestCanonicalCandidateProfile("workspace-1", "profile-1");
      expect(persisted?.profile.facts).toHaveLength(saved.profile.facts.length);
      expect(saved.profile.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    } finally {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
