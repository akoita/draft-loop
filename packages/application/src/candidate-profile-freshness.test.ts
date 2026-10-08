import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalCandidateProfileExtractionIdentity } from "@draft-loop/domain";
import { openSqliteStorage, type WorkspaceRecord } from "@draft-loop/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import {
  type CandidateProfileFreshness,
  computeCandidateProfileFreshness,
  countCandidateProfileSourceChanges,
  readCandidateProfileFreshness,
  withCandidateProfileFreshness,
} from "./candidate-profile-freshness.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { type ApplicationDriver, createApplicationService } from "./index.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-28T08:00:00.000Z";
const identity: CanonicalCandidateProfileExtractionIdentity = {
  company: "mistral",
  modelId: "synthetic-model",
  promptTemplateVersion: "synthetic-extraction-v1",
};

/** A source reads `title|skill`; the stub extracts one role and one skill fact from it. */
function proposalFor(sources: readonly { readonly id: string; readonly text: string }[]) {
  const facts = sources.flatMap((source) => {
    const [title = "", skill = ""] = source.text.trim().split("|");
    return [
      {
        key: `role-${source.id}`,
        category: "role",
        subjectKey: `employment-${source.id}`,
        field: "title",
        value: title,
        evidence: [{ sourceId: source.id, quote: source.text.trim() }],
      },
      {
        key: `skill-${source.id}`,
        category: "skill",
        field: "skill",
        value: skill,
        evidence: [{ sourceId: source.id, quote: source.text.trim() }],
      },
    ];
  });
  return { schemaVersion: 1, facts, issues: [] };
}

describe("candidate profile freshness", () => {
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
    directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-freshness-"));
    storeRoot = join(directory, "knowledge-store");
    storage = openSqliteStorage(join(directory, "workspace.sqlite"));
    tick = 0;
    await storage.saveWorkspace(workspace);
    const initialized = await knowledge.initializeStore({ storeRoot, displayName: "Career" });
    const id = initialized.knowledgeBases[0]?.id;
    if (id === undefined) throw new Error("missing knowledge base");
    knowledgeBaseId = id;
  });

  afterEach(async () => {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  });

  /** Each saved version needs a timestamp not before the one it follows. */
  let tick = 0;
  const nextTime = () => {
    tick += 1;
    return new Date(Date.UTC(2026, 7, 28, 8, 0, tick)).toISOString();
  };

  const persistence = () => createCanonicalCandidateProfilePersistenceService(storage);

  async function importSource(name: string, text: string): Promise<string> {
    const sourcePath = join(directory, `${name}.md`);
    await writeFile(sourcePath, text, "utf8");
    const written = await knowledge.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId,
      sourcePath,
    });
    return written.source.id;
  }

  async function appendVersion(sourceId: string, text: string): Promise<void> {
    const sourcePath = join(directory, `${sourceId}-next.md`);
    await writeFile(sourcePath, text, "utf8");
    await knowledge.appendKnowledgeSourceFileVersion({
      storeRoot,
      knowledgeBaseId,
      sourceId,
      sourcePath,
    });
  }

  function derive() {
    return createCanonicalCandidateProfileDerivationService({
      persistence: persistence(),
      extractor: { extract: (request) => proposalFor(request.sources) },
      extractionIdentity: identity,
      knowledgeService: knowledge,
      now: nextTime,
    }).deriveCanonicalCandidateProfile({
      workspaceId: workspace.id,
      profileId: "profile-1",
      selections: [{ storeRoot, knowledgeBaseId }],
      allowProviderData: true,
    });
  }

  /** Acknowledges every open issue, then reviews the newest draft; returns the reviewed version. */
  async function review(): Promise<number> {
    const latest = await persistence().getLatestCanonicalCandidateProfile(
      workspace.id,
      "profile-1",
    );
    if (latest === undefined) throw new Error("missing profile");
    const acknowledged = await persistence().editLatestCanonicalCandidateProfile({
      workspaceId: workspace.id,
      profileId: "profile-1",
      expectedVersion: latest.profile.version,
      patch: {
        issues: latest.profile.issues.map((issue) => ({ ...issue, status: "acknowledged" })),
      },
      updatedAt: nextTime(),
    });
    const reviewed = await persistence().reviewLatestCanonicalCandidateProfile({
      workspaceId: workspace.id,
      profileId: "profile-1",
      expectedVersion: acknowledged.profile.version,
      reviewedAt: nextTime(),
    });
    return reviewed.profile.version;
  }

  function freshness(
    selection: { readonly storeRoot: string; readonly knowledgeBaseId: string }[] | null = [
      { storeRoot, knowledgeBaseId },
    ],
  ): Promise<CandidateProfileFreshness> {
    return readCandidateProfileFreshness(
      { root: directory, profileId: "profile-1" },
      {
        listVersions: () =>
          persistence().listCanonicalCandidateProfileVersions(workspace.id, "profile-1"),
        readSelection: async () => (selection === null ? undefined : { entries: selection }),
      },
    );
  }

  it("is not generated before any version exists", async () => {
    await importSource("a", "Engineer|TypeScript");

    await expect(freshness()).resolves.toEqual({ state: "not-generated" });
  });

  it("asks for a review while the newest version is a draft", async () => {
    await importSource("a", "Engineer|TypeScript");
    await derive();

    await expect(freshness()).resolves.toEqual({ state: "review-pending", version: 1 });
  });

  it("is up to date once the newest draft is reviewed", async () => {
    await importSource("a", "Engineer|TypeScript");
    await derive();
    const reviewed = await review();

    await expect(freshness()).resolves.toEqual({ state: "up-to-date", version: reviewed });
  });

  it("counts an added source as new", async () => {
    await importSource("a", "Engineer|TypeScript");
    await derive();
    await review();

    await importSource("b", "Analyst|SQL");
    await importSource("c", "Lead|Rust");

    await expect(freshness()).resolves.toEqual({
      state: "update-available",
      version: 3,
      newSourceCount: 2,
      changedSourceCount: 0,
      removedSourceCount: 0,
    });
  });

  it("counts a source with a new version as changed", async () => {
    const a = await importSource("a", "Engineer|TypeScript");
    await importSource("b", "Analyst|SQL");
    await derive();
    await review();

    await appendVersion(a, "Lead|Rust");

    await expect(freshness()).resolves.toEqual({
      state: "update-available",
      version: 3,
      newSourceCount: 0,
      changedSourceCount: 1,
      removedSourceCount: 0,
    });
  });

  it("counts a retired source as removed", async () => {
    await importSource("a", "Engineer|TypeScript");
    const b = await importSource("b", "Analyst|SQL");
    await derive();
    await review();

    await knowledge.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: b });

    await expect(freshness()).resolves.toEqual({
      state: "update-available",
      version: 3,
      newSourceCount: 0,
      changedSourceCount: 0,
      removedSourceCount: 1,
    });
  });

  it("combines new, changed and removed sources", async () => {
    const a = await importSource("a", "Engineer|TypeScript");
    const b = await importSource("b", "Analyst|SQL");
    await importSource("c", "Lead|Rust");
    await derive();
    await review();

    await appendVersion(a, "Staff|Go");
    await knowledge.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: b });
    await importSource("d", "Manager|Excel");

    await expect(freshness()).resolves.toEqual({
      state: "update-available",
      version: 3,
      newSourceCount: 1,
      changedSourceCount: 1,
      removedSourceCount: 1,
    });
  });

  it("returns to up to date after the update is derived and its draft reviewed", async () => {
    await importSource("a", "Engineer|TypeScript");
    await derive();
    await review();
    await importSource("b", "Analyst|SQL");
    expect(await freshness()).toMatchObject({ state: "update-available", newSourceCount: 1 });

    await derive();
    await expect(freshness()).resolves.toEqual({
      state: "review-pending",
      version: 4,
      reviewedVersion: 3,
    });

    await review();
    await expect(freshness()).resolves.toEqual({ state: "up-to-date", version: 6 });
  });

  it("cannot compare when the configured selection cannot be read", async () => {
    await importSource("a", "Engineer|TypeScript");
    await derive();
    await review();

    await expect(freshness(null)).resolves.toEqual({ state: "unavailable", version: 3 });
    await expect(
      freshness([{ storeRoot: join(directory, "missing-store"), knowledgeBaseId }]),
    ).resolves.toEqual({ state: "unavailable", version: 3 });
  });

  it("reports nothing about source content or locations", async () => {
    await importSource("a", "Engineer|TypeScript");
    await derive();
    await review();
    await importSource("b", "Analyst|SQL");

    const serialized = JSON.stringify(await freshness());

    expect(serialized).not.toContain(directory);
    expect(serialized).not.toContain("Analyst");
  });
});

describe("computeCandidateProfileFreshness", () => {
  it("is not generated without versions", () => {
    expect(computeCandidateProfileFreshness({ versions: [], current: undefined })).toEqual({
      state: "not-generated",
    });
  });

  it("counts changes between two snapshots by logical source", () => {
    const source = (sourceId: string, versionId: string, version: number) => ({
      sourceId,
      versionId,
      lifecycleRevision: { version, createdAt, managed: false },
    });
    const snapshot = (sources: ReturnType<typeof source>[]) =>
      ({
        schemaVersion: 1,
        capturedAt: createdAt,
        entries: [{ storeId: "store-1", knowledgeBaseId: "kb-1", sources }],
      }) as unknown as Parameters<typeof countCandidateProfileSourceChanges>[0];

    expect(
      countCandidateProfileSourceChanges(
        snapshot([source("a", "a-1", 1), source("b", "b-1", 1), source("c", "c-1", 1)]),
        snapshot([source("a", "a-2", 2), source("c", "c-1", 1), source("d", "d-1", 1)]),
      ),
    ).toEqual({ newSourceCount: 1, changedSourceCount: 1, removedSourceCount: 1 });
  });
});

describe("profile freshness on the application service", () => {
  it("is answered by the driver with the workspace's configured selection", async () => {
    const seen: string[] = [];
    const driver = withCandidateProfileFreshness(
      {
        listCanonicalCandidateProfileVersions: async (command: { root: string }) => {
          seen.push(command.root);
          return [];
        },
      },
      { readWorkspace: async () => ({}) },
    );

    await expect(
      driver.getCandidateProfileFreshness({ root: "/workspace", profileId: "profile-1" }),
    ).resolves.toEqual({ state: "not-generated" });
    expect(seen).toEqual(["/workspace"]);
  });

  it("is refused by a service whose driver cannot compare", async () => {
    const service = createApplicationService({} as ApplicationDriver);

    await expect(
      service.getCandidateProfileFreshness?.({ root: "/workspace", profileId: "profile-1" }),
    ).rejects.toThrow(/does not support/u);
  });
});
