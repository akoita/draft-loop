import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CanonicalCandidateProfileExtractionIdentity,
  maximumCanonicalCandidateProfileProvenanceQuoteLength,
} from "@draft-loop/domain";
import { openSqliteStorage, type WorkspaceRecord } from "@draft-loop/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalCandidateProfileDerivationService } from "./candidate-profile-derivation.js";
import {
  type CanonicalCandidateProfileExtractionInput,
  type CanonicalCandidateProfileExtractionRequest,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const checksum = "a".repeat(64);

type Material = CanonicalCandidateProfileExtractionInput["sources"][number];

function material(overrides: Partial<Material> = {}): Material {
  return {
    id: "source-a",
    mediaType: "text/markdown",
    checksum,
    text: "Led the platform team.\nShipped TypeScript services.",
    reference: {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      sourceId: "source-1",
      versionId: "version-1",
      kind: "candidate-provided",
    },
    ...overrides,
  };
}

function skill(key: string, value: string, sourceId: string, quote: string) {
  return {
    key,
    category: "skill",
    subjectKey: "skills",
    field: "name",
    value,
    evidence: [{ sourceId, quote }],
  };
}

async function extract(
  facts: readonly unknown[],
  sources: readonly Material[] = [material()],
  issues: readonly unknown[] = [],
) {
  return processCanonicalCandidateProfileExtraction(
    { extract: () => ({ schemaVersion: 1, facts, issues }) },
    { operationId: "quote-operation", sources, allowProviderData: true },
  );
}

describe("canonical profile fact quotes", () => {
  it("keeps the exact source quote for each cited source version", async () => {
    const result = await extract([
      skill("a", "TypeScript", "source-a", "Shipped TypeScript services."),
    ]);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.provenance).toEqual([
      { ...material().reference, quote: "Shipped TypeScript services." },
    ]);
  });

  it("stores the exact source span when the quote differs in case or whitespace", async () => {
    const result = await extract([
      skill("a", "TypeScript", "source-a", "  shipped   TYPESCRIPT\nservices. "),
      skill("b", "platform", "source-a", "led the PLATFORM team."),
    ]);

    expect(result.facts.map((fact) => fact.provenance[0]?.quote).sort()).toEqual([
      "Led the platform team.",
      "Shipped TypeScript services.",
    ]);
  });

  it("resolves a quote that matched only after Markdown formatting was ignored", async () => {
    const source = material({ text: "- **Led** the `platform` team\n" });
    const result = await extract(
      [skill("a", "platform", "source-a", "Led the platform team")],
      [source],
    );

    const quote = result.facts[0]?.provenance[0]?.quote;
    expect(quote).toBeDefined();
    expect(source.text).toContain(quote);
    expect(quote).toContain("platform");
  });

  it("keeps the first quote that cites each source and one quote per identical source version", async () => {
    const other = material({
      id: "source-b",
      reference: { ...material().reference, sourceId: "source-2" },
    });
    const result = await extract(
      [
        {
          ...skill("a", "TypeScript", "source-a", "Shipped TypeScript services."),
          evidence: [
            { sourceId: "source-a", quote: "Shipped TypeScript services." },
            { sourceId: "source-a", quote: "typescript" },
          ],
        },
      ],
      [material(), other],
    );

    // Both source versions share the same text, so one representative maps to both references.
    expect(result.facts[0]?.provenance.map((reference) => reference.sourceId)).toEqual([
      "source-1",
      "source-2",
    ]);
    expect(result.facts[0]?.provenance.map((reference) => reference.quote)).toEqual([
      "Shipped TypeScript services.",
      "Shipped TypeScript services.",
    ]);
  });

  it("omits the quote when no exact span within the bound can be resolved", async () => {
    const gap = "\n".repeat(maximumCanonicalCandidateProfileProvenanceQuoteLength + 100);
    const source = material({ text: `Led the platform${gap}team of engineers.` });
    const result = await extract(
      [skill("a", "platform", "source-a", "Led the platform team of engineers.")],
      [source],
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.provenance).toEqual([source.reference]);
    expect(result.facts[0]?.provenance[0]).not.toHaveProperty("quote");
  });

  it("falls back to a later quote for the same source when the first has no exact span", async () => {
    const gap = "\n".repeat(maximumCanonicalCandidateProfileProvenanceQuoteLength + 100);
    const source = material({ text: `Led the platform${gap}team.\nShipped platform tooling.` });
    const result = await extract(
      [
        {
          ...skill("a", "platform", "source-a", "Led the platform team."),
          evidence: [
            { sourceId: "source-a", quote: "Led the platform team." },
            { sourceId: "source-a", quote: "Shipped platform tooling." },
          ],
        },
      ],
      [source],
    );

    expect(result.facts[0]?.provenance[0]?.quote).toBe("Shipped platform tooling.");
  });

  it("keeps the first quote when identical facts from two sources merge", async () => {
    const second = material({
      id: "source-b",
      checksum: "b".repeat(64),
      text: "Also shipped typescript services.",
      reference: { ...material().reference, sourceId: "source-2" },
    });
    const result = await extract(
      [
        skill("a", "TypeScript", "source-a", "Shipped TypeScript services."),
        skill("b", "typescript", "source-b", "shipped typescript services."),
        skill("c", "TypeScript", "source-a", "TypeScript"),
      ],
      [material(), second],
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.provenance).toEqual([
      { ...material().reference, quote: "Shipped TypeScript services." },
      { ...second.reference, quote: "shipped typescript services." },
    ]);
  });

  it("does not let quotes change fact identity", async () => {
    const withQuote = await extract([
      skill("a", "TypeScript", "source-a", "Shipped TypeScript services."),
    ]);
    const otherQuote = await extract([skill("a", "TypeScript", "source-a", "TypeScript")]);

    expect(withQuote.facts[0]?.id).toBe(otherQuote.facts[0]?.id);
  });

  it("never puts quotes on issue source references", async () => {
    const other = material({
      id: "source-b",
      checksum: "b".repeat(64),
      text: "Principal Engineer",
      reference: { ...material().reference, sourceId: "source-2" },
    });
    const title = (key: string, value: string, sourceId: string) => ({
      key,
      category: "role",
      subjectKey: "employment-1",
      field: "title",
      value,
      evidence: [{ sourceId, quote: value }],
    });
    const result = await extract(
      [
        title("a", "Principal Engineer", "source-b"),
        skill("b", "TypeScript", "source-a", "TypeScript"),
      ],
      [material({ text: "Staff Engineer\nTypeScript" }), other],
      [{ code: "omission", factKeys: ["b"], sourceIds: ["source-a"] }],
    );
    const conflicting = await extract(
      [title("a", "Principal Engineer", "source-b"), title("b", "Staff Engineer", "source-a")],
      [material({ text: "Staff Engineer\nTypeScript" }), other],
    );

    const issues = [...result.issues, ...conflicting.issues];
    expect(conflicting.issues.some((issue) => issue.code === "conflict-title")).toBe(true);
    expect(issues.flatMap((issue) => issue.sourceRefs).length).toBeGreaterThan(0);
    for (const issue of issues) {
      for (const reference of issue.sourceRefs) expect(reference).not.toHaveProperty("quote");
    }
    expect(
      conflicting.facts.every((fact) => fact.provenance.every((reference) => reference.quote)),
    ).toBe(true);
  });

  it("resolves quotes of a windowed extraction against the whole source", async () => {
    const filler = "Unrelated filler sentence for a large synthetic document.\n";
    const text = `${filler.repeat(2_000)}Mentored the Platform Team lead.\n${filler.repeat(2_000)}`;
    expect(text.length).toBeGreaterThan(65_536);
    const source = material({ text });
    let windowed = false;
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: (request: CanonicalCandidateProfileExtractionRequest) => {
          windowed = request.groundProposal !== undefined;
          const proposal = {
            schemaVersion: 1,
            facts: [skill("a", "platform team", "source-a", "mentored the PLATFORM team lead.")],
            issues: [],
          };
          return request.groundProposal === undefined
            ? proposal
            : request.groundProposal(
                proposal as unknown as Parameters<typeof request.groundProposal>[0],
              );
        },
      },
      { operationId: "quote-operation", sources: [source], allowProviderData: true },
    );

    expect(windowed).toBe(true);
    expect(result.facts[0]?.provenance[0]?.quote).toBe("Mentored the Platform Team lead.");
  });

  it("resolves a filtered source's quote in the original text outside excluded ranges", async () => {
    const excluded = "Led the Platform Team";
    const original = `# Private\n\n${excluded}\n\n# Public\n\nled the   platform team\n`;
    const start = original.indexOf(excluded);
    const filtered = "# Public\n\nled the   platform team\n";
    const source = material({
      text: filtered,
      sensitivity: {
        originalText: original,
        excludedRanges: [{ start: 0, end: start + excluded.length + 1 }],
      },
    });
    const result = await extract(
      [skill("a", "platform", "source-a", "Led the Platform Team")],
      [source],
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.provenance[0]?.quote).toBe("led the   platform team");
  });

  it("stores only substrings of the cited source text", async () => {
    const source = material({
      text: "Line one has Typescript.\nLine  two\thas   SQL.\n\n- **Rust** and Go",
    });
    const result = await extract(
      [
        skill("a", "TypeScript", "source-a", "LINE ONE HAS TYPESCRIPT."),
        skill("b", "SQL", "source-a", "line two has sql."),
        skill("c", "Rust", "source-a", "Rust and Go"),
      ],
      [source],
    );

    const quotes = result.facts.flatMap((fact) =>
      fact.provenance.flatMap((reference) =>
        reference.quote === undefined ? [] : [reference.quote],
      ),
    );
    expect(quotes.length).toBe(result.facts.length);
    for (const quote of quotes) {
      expect(source.text).toContain(quote);
      expect(quote.length).toBeLessThanOrEqual(
        maximumCanonicalCandidateProfileProvenanceQuoteLength,
      );
    }
  });
});

describe("canonical profile fact quotes across versions", () => {
  const createdAt = "2026-08-28T08:00:00.000Z";
  const identity: CanonicalCandidateProfileExtractionIdentity = {
    company: "mistral",
    modelId: "synthetic-model",
    promptTemplateVersion: "synthetic-extraction-v1",
  };
  let directory: string;
  let storeRoot: string;
  let knowledgeBaseId: string;
  let storage: ReturnType<typeof openSqliteStorage>;
  let calls: string[][];
  const knowledge = createCandidateKnowledgeStoreService({ now: () => createdAt });
  const workspace: WorkspaceRecord = {
    id: "workspace-1",
    state: "collecting",
    createdAt,
    updatedAt: createdAt,
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-quotes-"));
    storeRoot = join(directory, "knowledge-store");
    storage = openSqliteStorage(join(directory, "workspace.sqlite"));
    await storage.saveWorkspace(workspace);
    const initialized = await knowledge.initializeStore({ storeRoot, displayName: "Career" });
    const id = initialized.knowledgeBases[0]?.id;
    if (id === undefined) throw new Error("missing knowledge base");
    knowledgeBaseId = id;
    calls = [];
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

  /** A source reads `title|skill`; the stub quotes it in upper case, so storing it needs resolving. */
  function derive() {
    return createCanonicalCandidateProfileDerivationService({
      persistence: createCanonicalCandidateProfilePersistenceService(storage),
      extractor: {
        extract: (request) => {
          calls.push(request.sources.map((source) => source.text.trim()));
          const facts = request.sources.flatMap((source, index) => {
            const [title = "", skill = ""] = source.text.trim().split("|");
            const quote = source.text.trim().toUpperCase();
            return [
              {
                key: `role-${index}`,
                category: "role",
                subjectKey: "employment-1",
                field: "title",
                value: title,
                evidence: [{ sourceId: source.id, quote }],
              },
              {
                key: `skill-${index}`,
                category: "skill",
                field: "skill",
                value: skill,
                evidence: [{ sourceId: source.id, quote }],
              },
            ];
          });
          return { schemaVersion: 1, facts, issues: [] };
        },
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

  it("persists exact quotes, then keeps them through reuse, edit, and review", async () => {
    await importSource("a", "Engineer|TypeScript");
    const first = await derive();
    const sourceTexts = ["Engineer|TypeScript"];
    for (const fact of first.profile.facts) {
      expect(fact.provenance).toHaveLength(1);
      expect(fact.provenance[0]?.quote).toBe("Engineer|TypeScript");
      expect(sourceTexts.some((text) => text.includes(fact.provenance[0]?.quote ?? "?"))).toBe(
        true,
      );
    }

    await importSource("b", "Analyst|SQL");
    calls = [];
    const second = await derive();
    expect(calls).toEqual([["Analyst|SQL"]]);
    for (const fact of first.profile.facts) expect(second.profile.facts).toContainEqual(fact);
    expect(second.profile.facts.every((fact) => fact.provenance[0]?.quote !== undefined)).toBe(
      true,
    );

    const persistence = createCanonicalCandidateProfilePersistenceService(storage);
    const stored = await persistence.getLatestCanonicalCandidateProfile("workspace-1", "profile-1");
    expect(stored?.profile.facts).toEqual(second.profile.facts);

    const edited = await persistence.editLatestCanonicalCandidateProfile({
      workspaceId: "workspace-1",
      profileId: "profile-1",
      expectedVersion: second.profile.version,
      updatedAt: createdAt,
      patch: {
        facts: second.profile.facts,
        issues: second.profile.issues.map((issue) => ({
          ...issue,
          status: "acknowledged" as const,
        })),
      },
    });
    expect(edited.profile.facts).toEqual(second.profile.facts);

    const reviewed = await persistence.reviewLatestCanonicalCandidateProfile({
      workspaceId: "workspace-1",
      profileId: "profile-1",
      expectedVersion: edited.profile.version,
      reviewedAt: createdAt,
    });
    expect(reviewed.profile.status).toBe("reviewed");
    expect(reviewed.profile.facts).toEqual(second.profile.facts);
    for (const issue of reviewed.profile.issues) {
      for (const reference of issue.sourceRefs) expect(reference).not.toHaveProperty("quote");
    }
  });
});
