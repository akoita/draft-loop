import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalCandidateProfileExtractionIdentity } from "@draft-loop/domain";
import { openSqliteStorage, type WorkspaceRecord } from "@draft-loop/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const createdAt = "2026-08-28T08:00:00.000Z";
const identity: CanonicalCandidateProfileExtractionIdentity = {
  company: "mistral",
  modelId: "synthetic-model",
  promptTemplateVersion: "synthetic-extraction-v1",
};

/** A source reads `title|skill`; the stub extracts one role and one skill fact from it. */
function proposalFor(
  sources: readonly { readonly id: string; readonly text: string }[],
  failOn?: string,
) {
  const facts = sources.flatMap((source, index) => {
    if (failOn !== undefined && source.text.includes(failOn)) throw new Error("synthetic failure");
    const [title = "", skill = ""] = source.text.trim().split("|");
    return [
      {
        key: `role-${index}`,
        category: "role",
        subjectKey: "employment-1",
        field: "title",
        value: title,
        evidence: [{ sourceId: source.id, quote: source.text.trim() }],
      },
      {
        key: `skill-${index}`,
        category: "skill",
        field: "skill",
        value: skill,
        evidence: [{ sourceId: source.id, quote: source.text.trim() }],
      },
    ];
  });
  return { schemaVersion: 1, facts, issues: [] };
}

describe("incremental canonical profile derivation", () => {
  let directory: string;
  let storeRoot: string;
  let knowledgeBaseId: string;
  let storage: ReturnType<typeof openSqliteStorage>;
  let calls: string[][];
  let failOn: string | undefined;
  const knowledge = createCandidateKnowledgeStoreService({ now: () => createdAt });
  const workspace: WorkspaceRecord = {
    id: "workspace-1",
    state: "collecting",
    createdAt,
    updatedAt: createdAt,
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-incremental-"));
    storeRoot = join(directory, "knowledge-store");
    storage = openSqliteStorage(join(directory, "workspace.sqlite"));
    await storage.saveWorkspace(workspace);
    const initialized = await knowledge.initializeStore({ storeRoot, displayName: "Career" });
    const id = initialized.knowledgeBases[0]?.id;
    if (id === undefined) throw new Error("missing knowledge base");
    knowledgeBaseId = id;
    calls = [];
    failOn = undefined;
  });

  afterEach(async () => {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  });

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

  function derive(
    options: {
      readonly identity?: CanonicalCandidateProfileExtractionIdentity | undefined;
      readonly fullExtraction?: boolean;
    } = {},
  ) {
    const extractionIdentity = "identity" in options ? options.identity : identity;
    return createCanonicalCandidateProfileDerivationService({
      persistence: createCanonicalCandidateProfilePersistenceService(storage),
      extractor: {
        extract: (request) => {
          calls.push(request.sources.map((source) => source.text.trim()));
          return proposalFor(request.sources, failOn);
        },
      },
      ...(extractionIdentity === undefined ? {} : { extractionIdentity }),
      knowledgeService: knowledge,
      now: () => createdAt,
    }).deriveCanonicalCandidateProfile({
      workspaceId: workspace.id,
      profileId: "profile-1",
      selections: [{ storeRoot, knowledgeBaseId }],
      allowProviderData: true,
      ...(options.fullExtraction === undefined ? {} : { fullExtraction: options.fullExtraction }),
    });
  }

  it("extracts everything first and records the identity", async () => {
    await importSource("a", "Engineer|TypeScript");
    await importSource("b", "Analyst|SQL");

    const first = await derive();

    expect(calls.flat().sort()).toEqual(["Analyst|SQL", "Engineer|TypeScript"]);
    expect(first.profile.extraction).toEqual(identity);
    expect(first).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 2 });
  });

  it("extracts only an added source and keeps the other facts byte for byte", async () => {
    await importSource("a", "Engineer|TypeScript");
    const first = await derive();

    await importSource("b", "Analyst|SQL");
    calls = [];
    const second = await derive();

    expect(calls).toEqual([["Analyst|SQL"]]);
    expect(second).toMatchObject({ reusedSourceCount: 1, extractedSourceCount: 1 });
    expect(second.profile.version).toBe(2);
    for (const fact of first.profile.facts) {
      expect(second.profile.facts).toContainEqual(fact);
    }
    expect(second.profile.facts).toHaveLength(first.profile.facts.length + 2);
  });

  it("extracts only the changed source when a source gets a new version", async () => {
    const a = await importSource("a", "Engineer|TypeScript");
    await importSource("b", "Analyst|SQL");
    const first = await derive();

    await appendVersion(a, "Lead|Rust");
    calls = [];
    const second = await derive();

    expect(calls).toEqual([["Lead|Rust"]]);
    expect(second).toMatchObject({ reusedSourceCount: 1, extractedSourceCount: 1 });
    expect(second.profile.facts.map((fact) => fact.value).sort()).toEqual(
      ["Analyst", "Lead", "Rust", "SQL"].sort(),
    );
    for (const fact of first.profile.facts.filter((candidate) =>
      ["Analyst", "SQL"].includes(candidate.value),
    )) {
      expect(second.profile.facts).toContainEqual(fact);
    }
  });

  it("drops the facts of a retired source without calling the provider", async () => {
    await importSource("a", "Engineer|TypeScript");
    const b = await importSource("b", "Analyst|SQL");
    await derive();

    await knowledge.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: b });
    calls = [];
    const second = await derive();

    expect(calls).toEqual([]);
    expect(second).toMatchObject({ reusedSourceCount: 1, extractedSourceCount: 0 });
    expect(second.profile.facts.map((fact) => fact.value).sort()).toEqual([
      "Engineer",
      "TypeScript",
    ]);
  });

  it("makes no provider call and still saves a new version when nothing changed", async () => {
    await importSource("a", "Engineer|TypeScript");
    await importSource("b", "Analyst|SQL");
    const first = await derive();

    calls = [];
    const second = await derive();

    expect(calls).toEqual([]);
    expect(second.profile.version).toBe(2);
    expect(second).toMatchObject({ reusedSourceCount: 2, extractedSourceCount: 0 });
    expect(second.profile.facts).toEqual(first.profile.facts);
    expect(second.profile.issues).toEqual(first.profile.issues);
  });

  it("extracts everything when the identity differs or the earlier version has none", async () => {
    await importSource("a", "Engineer|TypeScript");
    await derive({ identity: undefined });

    calls = [];
    const afterUnknown = await derive();
    expect(calls.flat()).toEqual(["Engineer|TypeScript"]);
    expect(afterUnknown).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 1 });

    calls = [];
    const afterOtherModel = await derive({ identity: { ...identity, modelId: "other-model" } });
    expect(calls.flat()).toEqual(["Engineer|TypeScript"]);
    expect(afterOtherModel).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 1 });
    expect(afterOtherModel.profile.extraction?.modelId).toBe("other-model");

    calls = [];
    await derive({ identity: undefined });
    expect(calls.flat()).toEqual(["Engineer|TypeScript"]);
  });

  it("forces every source through extraction on request", async () => {
    await importSource("a", "Engineer|TypeScript");
    await importSource("b", "Analyst|SQL");
    await derive();

    calls = [];
    const forced = await derive({ fullExtraction: true });

    expect(calls.flat().sort()).toEqual(["Analyst|SQL", "Engineer|TypeScript"]);
    expect(forced).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 2 });
  });

  it("recomputes conflicts and merged provenance over reused and new facts", async () => {
    const a = await importSource("a", "Engineer|TypeScript");
    const first = await derive();
    expect(first.profile.issues.map((issue) => issue.code)).not.toContain("conflict-title");

    const b = await importSource("b", "Manager|TypeScript");
    calls = [];
    const merged = await derive();

    expect(calls).toEqual([["Manager|TypeScript"]]);
    expect(merged.profile.issues.map((issue) => issue.code)).toContain("conflict-title");
    const skill = merged.profile.facts.filter((fact) => fact.field === "skill");
    expect(skill).toHaveLength(1);
    expect(skill[0]?.provenance.map((reference) => reference.sourceId).sort()).toEqual(
      [a, b].sort(),
    );
    const factIds = merged.profile.facts.map((fact) => fact.id);
    for (const issue of merged.profile.issues) {
      for (const factId of issue.factIds) expect(factIds).toContain(factId);
    }

    // Retiring b drops the merged skill fact, so a is extracted again to restore its share.
    await knowledge.retireKnowledgeSource({ storeRoot, knowledgeBaseId, sourceId: b });
    calls = [];
    const afterRetire = await derive();
    expect(calls).toEqual([["Engineer|TypeScript"]]);
    expect(afterRetire).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 1 });
    expect(afterRetire.profile.issues.map((issue) => issue.code)).not.toContain("conflict-title");
    expect(afterRetire.profile.facts.map((fact) => fact.value).sort()).toEqual([
      "Engineer",
      "TypeScript",
    ]);
  });

  it("retries the sources of an earlier failed extraction call", async () => {
    await importSource("a", "Engineer|TypeScript");
    await importSource("b", "Engineer|Broken");
    failOn = "Broken";
    const first = await derive();
    expect(first.profile.issues.some((issue) => issue.severity === "error")).toBe(true);

    failOn = undefined;
    calls = [];
    const second = await derive();

    // The failure issue cites every source of the failed call, so all of them are retried.
    expect(calls.flat().sort()).toEqual(["Engineer|Broken", "Engineer|TypeScript"]);
    expect(second).toMatchObject({ reusedSourceCount: 0, extractedSourceCount: 2 });
    expect(second.profile.issues.some((issue) => issue.severity === "error")).toBe(false);
    expect(second.profile.facts.map((fact) => fact.value)).toContain("Broken");
  });
});
