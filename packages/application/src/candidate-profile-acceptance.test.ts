import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import {
  type CanonicalCandidateProfileExtractionProposal,
  canonicalCandidateProfileExtractionProposalJsonSchema,
  canonicalCandidateProfileExtractionProposalSchema,
  parseCanonicalCandidateProfile,
  serializeCanonicalCandidateProfile,
} from "@draft-loop/schemas";
import { openSqliteStorage, type WorkspaceRecord } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import type {
  CanonicalCandidateProfileExtractionPort,
  CanonicalCandidateProfileExtractionRequest,
} from "./candidate-profile-extraction.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-30T08:00:00.000Z";
const editedAt = "2026-08-30T08:05:00.000Z";

type FactDescriptor = {
  readonly category: (typeof canonicalCandidateProfileFactCategories)[number];
  readonly field: string;
  readonly value: string;
  readonly quote: string;
  readonly subjectKey?: string;
};

const completeFactDescriptors: readonly FactDescriptor[] = [
  {
    category: "identity",
    field: "full-name",
    value: "Alex Example",
    quote: "Name: Alex Example",
  },
  {
    category: "contact",
    field: "email",
    value: "alex@example.invalid",
    quote: "Email: alex@example.invalid",
  },
  {
    category: "role",
    subjectKey: "employment-example",
    field: "title",
    value: "Staff Engineer",
    quote: "Role: Staff Engineer",
  },
  {
    category: "employer",
    subjectKey: "employment-example",
    field: "name",
    value: "Example Labs",
    quote: "Employer: Example Labs",
  },
  {
    category: "date",
    subjectKey: "employment-example",
    field: "start-date",
    value: "2021-01",
    quote: "Start date: 2021-01",
  },
  {
    category: "achievement",
    field: "impact",
    value: "Reduced build time by 42%",
    quote: "Achievement: Reduced build time by 42%",
  },
  {
    category: "project",
    subjectKey: "private-project-example",
    field: "name",
    value: "Private Offline Migration",
    quote: "Private project: Private Offline Migration (candidate-provided)",
  },
  {
    category: "skill",
    field: "name",
    value: "TypeScript",
    quote: "Skill: TypeScript",
  },
  {
    category: "certification",
    field: "name",
    value: "Example Certified Systems",
    quote: "Certification: Example Certified Systems",
  },
  {
    category: "education",
    field: "degree",
    value: "BSc Computer Science",
    quote: "Education: BSc Computer Science",
  },
  {
    category: "language",
    field: "name",
    value: "English",
    quote: "Language: English",
  },
  {
    category: "approved-link",
    field: "portfolio",
    value: "https://portfolio.example.invalid/alex",
    quote: "Approved link: https://portfolio.example.invalid/alex",
  },
];

const issueFactDescriptors: readonly FactDescriptor[] = [
  completeFactDescriptors[0] as FactDescriptor,
  completeFactDescriptors[1] as FactDescriptor,
  {
    category: "role",
    subjectKey: "employment-example",
    field: "title",
    value: "Staff Engineer",
    quote: "Role alternative A: Staff Engineer",
  },
  {
    category: "role",
    subjectKey: "employment-example",
    field: "title",
    value: "Principal Engineer",
    quote: "Role alternative B: Principal Engineer",
  },
  {
    category: "employer",
    subjectKey: "employment-example",
    field: "name",
    value: "Example Labs",
    quote: "Employer: Example Labs",
  },
  {
    category: "date",
    subjectKey: "employment-example",
    field: "start-date",
    value: "2021-01",
    quote: "Start date: 2021-01",
  },
  {
    category: "achievement",
    field: "impact",
    value: "Reduced build time by 42%",
    quote: "Achievement: Reduced build time by 42%",
  },
  {
    category: "project",
    subjectKey: "private-project-example",
    field: "name",
    value: "Private Offline Migration",
    quote: "Private project: Private Offline Migration (candidate-provided)",
  },
  {
    category: "project",
    subjectKey: "private-project-example",
    field: "name",
    value: "Private Offline Migration",
    quote: "Private project duplicate: Private Offline Migration (candidate-provided)",
  },
  {
    category: "skill",
    field: "name",
    value: "TypeScript",
    quote: "Skill: TypeScript",
  },
  {
    category: "certification",
    field: "name",
    value: "Example Certified Systems",
    quote: "Certification: Example Certified Systems",
  },
  {
    category: "education",
    field: "degree",
    value: "BSc Computer Science",
    quote: "Education: BSc Computer Science",
  },
  {
    category: "approved-link",
    field: "portfolio",
    value: "https://portfolio.example.invalid/alex",
    quote: "Approved link: https://portfolio.example.invalid/alex",
  },
];

function sourceText(descriptors: readonly FactDescriptor[]): string {
  return descriptors.map((descriptor) => descriptor.quote).join("\n");
}

function proposalFromDescriptors(
  sourceId: string,
  text: string,
  descriptors: readonly FactDescriptor[],
): CanonicalCandidateProfileExtractionProposal {
  for (const descriptor of descriptors) {
    if (!text.includes(descriptor.quote)) {
      throw new Error("deterministic fixture quote missing from source");
    }
  }
  const proposal = {
    schemaVersion: 1 as const,
    facts: descriptors.map((descriptor, index) => ({
      key: `fact-${index + 1}`,
      category: descriptor.category,
      ...(descriptor.subjectKey === undefined ? {} : { subjectKey: descriptor.subjectKey }),
      field: descriptor.field,
      value: descriptor.value,
      evidence: [{ sourceId, quote: descriptor.quote }],
    })),
    issues: [],
  };
  return canonicalCandidateProfileExtractionProposalSchema.parse(
    JSON.parse(JSON.stringify(proposal)) as unknown,
  );
}

function recordingExtractor(
  proposal: (sourceId: string, text: string) => CanonicalCandidateProfileExtractionProposal,
): {
  readonly port: CanonicalCandidateProfileExtractionPort;
  readonly requests: CanonicalCandidateProfileExtractionRequest[];
} {
  const requests: CanonicalCandidateProfileExtractionRequest[] = [];
  return {
    requests,
    port: {
      extract: (request) => {
        requests.push(request);
        const source = request.sources[0];
        if (source === undefined) throw new Error("deterministic fixture source missing");
        return proposal(source.id, source.text);
      },
    },
  };
}

type Fixture = {
  readonly directory: string;
  readonly storeRoot: string;
  readonly sourcePath: string;
  readonly databasePath: string;
  readonly storage: ReturnType<typeof openSqliteStorage>;
  readonly knowledgeService: ReturnType<typeof createCandidateKnowledgeStoreService>;
  readonly workspace: WorkspaceRecord;
  readonly knowledgeBaseId: string;
};

async function createFixture(prefix: string, text: string): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), `draft-loop-${prefix}-`));
  const storeRoot = join(directory, "candidate-knowledge");
  const sourcePath = join(directory, "candidate-career.md");
  const databasePath = join(directory, "workspace.sqlite");
  const storage = openSqliteStorage(databasePath);
  const knowledgeService = createCandidateKnowledgeStoreService({ now: () => createdAt });
  const workspace: WorkspaceRecord = {
    id: `workspace-${prefix}`,
    state: "collecting",
    createdAt,
    updatedAt: createdAt,
  };

  try {
    await writeFile(sourcePath, text, "utf8");
    const initialized = await knowledgeService.initializeStore({
      storeRoot,
      displayName: "Example candidate evidence",
    });
    const knowledgeBaseId = initialized.knowledgeBases[0]?.id;
    if (knowledgeBaseId === undefined)
      throw new Error("deterministic fixture knowledge base missing");
    await knowledgeService.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId,
      sourcePath,
    });
    await storage.saveWorkspace(workspace);
    return {
      directory,
      storeRoot,
      sourcePath,
      databasePath,
      storage,
      knowledgeService,
      workspace,
      knowledgeBaseId,
    };
  } catch (error) {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

describe("canonical candidate profile representative-career acceptance", () => {
  it("derives every category with exact candidate provenance and survives JSON and SQLite restart", async () => {
    const text = sourceText(completeFactDescriptors);
    const fixture = await createFixture("profile-acceptance", text);
    const extractor = recordingExtractor((sourceId, source) =>
      proposalFromDescriptors(sourceId, source, completeFactDescriptors),
    );
    const persistence = createCanonicalCandidateProfilePersistenceService(fixture.storage);
    const service = createCanonicalCandidateProfileDerivationService({
      persistence,
      extractor: extractor.port,
      knowledgeService: fixture.knowledgeService,
      now: () => createdAt,
    });

    try {
      const saved = await service.deriveCanonicalCandidateProfile({
        workspaceId: fixture.workspace.id,
        profileId: "representative-career",
        selections: [
          {
            storeRoot: fixture.storeRoot,
            knowledgeBaseId: fixture.knowledgeBaseId,
          },
        ],
        allowProviderData: true,
      });

      expect(canonicalCandidateProfileExtractionProposalJsonSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(saved.profile.status).toBe("draft");
      expect(saved.profile.issues).toEqual([]);
      expect(new Set(saved.profile.facts.map((fact) => fact.category))).toEqual(
        new Set(canonicalCandidateProfileFactCategories),
      );
      expect(saved.profile.facts).toHaveLength(canonicalCandidateProfileFactCategories.length);

      const selection = saved.profile.candidateKnowledgeSelection;
      const selectionEntry = selection?.entries[0];
      const selectedSource = selectionEntry?.sources[0];
      if (selection === undefined || selectionEntry === undefined || selectedSource === undefined) {
        throw new Error("deterministic fixture selection missing");
      }
      expect(selection.entries).toHaveLength(1);
      expect(selectionEntry.sources).toHaveLength(1);
      const expectedReference = {
        storeId: selectionEntry.storeId,
        knowledgeBaseId: selectionEntry.knowledgeBaseId,
        sourceId: selectedSource.sourceId,
        versionId: selectedSource.versionId,
        kind: "candidate-provided" as const,
      };
      for (const fact of saved.profile.facts) {
        expect(fact.provenance).toEqual([expectedReference]);
        expect(fact.provenance.some((reference) => reference.kind === "public-corroboration")).toBe(
          false,
        );
      }
      const privateProject = saved.profile.facts.find(
        (fact) => fact.category === "project" && fact.value === "Private Offline Migration",
      );
      expect(privateProject).toBeDefined();
      expect(privateProject?.provenance).toEqual([expectedReference]);

      expect(extractor.requests).toHaveLength(1);
      const request = extractor.requests[0];
      if (request === undefined) throw new Error("deterministic fixture request missing");
      expect(Object.keys(request)).toEqual(["operationId", "sources"]);
      expect(request.sources).toHaveLength(1);
      const providerSource = request.sources[0];
      if (providerSource === undefined)
        throw new Error("deterministic fixture provider source missing");
      expect(Object.keys(providerSource).sort()).toEqual(["checksum", "id", "mediaType", "text"]);
      expect(providerSource.text).toBe(text);
      expect(JSON.stringify(request)).not.toContain(fixture.directory);
      expect(JSON.stringify(request)).not.toContain("storeRoot");
      expect(JSON.stringify(request)).not.toContain("sourcePath");
      expect(JSON.stringify(request)).not.toContain("storeId");
      expect(JSON.stringify(request)).not.toContain("knowledgeBaseId");

      const serializedProfile = serializeCanonicalCandidateProfile(saved.profile);
      expect(parseCanonicalCandidateProfile(serializedProfile)).toEqual(saved.profile);
      expect(serializedProfile).not.toContain(fixture.directory);
      expect(serializedProfile).not.toContain(fixture.sourcePath);
      expect(serializedProfile).not.toContain("storeRoot");
      expect(serializedProfile).not.toContain("sourcePath");
      expect(serializedProfile).toContain("portfolio.example.invalid");

      await fixture.storage.close();
      const reopened = openSqliteStorage(fixture.databasePath);
      try {
        const restartedPersistence = createCanonicalCandidateProfilePersistenceService(reopened);
        const restarted = await restartedPersistence.getLatestCanonicalCandidateProfile(
          fixture.workspace.id,
          "representative-career",
        );
        expect(restarted).toEqual(saved);
        expect(restarted === undefined ? undefined : JSON.stringify(restarted)).toBe(
          JSON.stringify(saved),
        );
        expect(
          restarted === undefined
            ? undefined
            : serializeCanonicalCandidateProfile(restarted.profile),
        ).toBe(serializedProfile);
      } finally {
        await reopened.close();
      }
    } finally {
      await fixture.storage.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("keeps conflicting and duplicate alternatives visible while omission remains an open blocker", async () => {
    const text = sourceText(issueFactDescriptors);
    const fixture = await createFixture("profile-issues", text);
    const extractor = recordingExtractor((sourceId, source) =>
      proposalFromDescriptors(sourceId, source, issueFactDescriptors),
    );
    const persistence = createCanonicalCandidateProfilePersistenceService(fixture.storage);
    const service = createCanonicalCandidateProfileDerivationService({
      persistence,
      extractor: extractor.port,
      knowledgeService: fixture.knowledgeService,
      now: () => createdAt,
    });

    try {
      const saved = await service.deriveCanonicalCandidateProfile({
        workspaceId: fixture.workspace.id,
        profileId: "profile-with-visible-issues",
        selections: [
          {
            storeRoot: fixture.storeRoot,
            knowledgeBaseId: fixture.knowledgeBaseId,
          },
        ],
        allowProviderData: true,
      });

      expect(saved.profile.status).toBe("draft");
      expect(saved.profile.facts.filter((fact) => fact.category === "language")).toHaveLength(0);
      expect(
        saved.profile.facts
          .filter((fact) => fact.category === "role")
          .map((fact) => fact.value)
          .sort(),
      ).toEqual(["Principal Engineer", "Staff Engineer"]);
      expect(
        saved.profile.facts.filter((fact) => fact.category === "project").map((fact) => fact.value),
      ).toEqual(["Private Offline Migration", "Private Offline Migration"]);
      expect(
        new Set(
          saved.profile.facts.filter((fact) => fact.category === "project").map((fact) => fact.id),
        ).size,
      ).toBe(2);

      const issueCodes = saved.profile.issues.map((issue) => issue.code);
      expect(issueCodes).toEqual(
        expect.arrayContaining(["conflict-title", "duplicate", "omission"]),
      );
      expect(saved.profile.issues).toHaveLength(3);
      expect(saved.profile.issues.every((issue) => issue.status === "open")).toBe(true);
      expect(saved.profile.issues.filter((issue) => issue.code === "omission")).toHaveLength(1);
      expect(saved.profile.issues.find((issue) => issue.code === "omission")).toMatchObject({
        status: "open",
        factIds: [],
        sourceRefs: [],
      });

      const roleFactIds = saved.profile.facts
        .filter((fact) => fact.category === "role")
        .map((fact) => fact.id);
      expect(saved.profile.issues.find((issue) => issue.code === "conflict-title")).toMatchObject({
        status: "open",
        factIds: expect.arrayContaining(roleFactIds),
      });
      const projectFactIds = saved.profile.facts
        .filter((fact) => fact.category === "project")
        .map((fact) => fact.id);
      expect(saved.profile.issues.find((issue) => issue.code === "duplicate")).toMatchObject({
        status: "open",
        factIds: expect.arrayContaining(projectFactIds),
      });

      await expect(
        persistence.reviewLatestCanonicalCandidateProfile({
          workspaceId: fixture.workspace.id,
          profileId: "profile-with-visible-issues",
          expectedVersion: saved.profile.version,
          reviewedAt: editedAt,
        }),
      ).rejects.toThrow();
      await expect(
        persistence.listCanonicalCandidateProfileVersions(
          fixture.workspace.id,
          "profile-with-visible-issues",
        ),
      ).resolves.toHaveLength(1);
    } finally {
      await fixture.storage.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});
