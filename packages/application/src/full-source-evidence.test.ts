import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
  CandidateKnowledgeSelectionSnapshot,
  ContextSnapshot,
} from "@draft-loop/domain";
import type { SourceSensitivityRule } from "@draft-loop/domain/source-sensitivity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import {
  announceRunEvidenceMode,
  decideFullSourceEvidence,
  defaultFullSourceBudgetCharacters,
  fullSourceBudgetCharacters,
} from "./full-source-evidence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createSourceSensitivityService } from "./source-sensitivity-service.js";
import type { EvidenceMode } from "./workspace-evidence-mode.js";

const withheldMarker = "alpha7731";
const projectCount = 30;

function projectParagraph(index: number): string {
  return `Synthetic project ${index} delivered fictional platform milestone ${index} for the invented client.`;
}

const markdown = [
  "# Fictional Candidate",
  "Opening line about platform engineering.",
  "",
  "## Projects",
  "",
  ...Array.from({ length: projectCount }, (_, index) => `${projectParagraph(index)}\n`),
  "## Compensation",
  `Fictional salary history ${withheldMarker} for the synthetic former employer.`,
  "",
].join("\n");

const rules: readonly SourceSensitivityRule[] = [
  { id: "r-never", tier: "never-share", match: { kind: "heading-contains", text: "compensation" } },
];

interface Fixture {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly selection: CandidateKnowledgeSelectionSnapshot;
}

function contextWith(fixture: Fixture, contextWindowTokens?: number): ContextSnapshot {
  const selectionFor = (role: "author" | "critic") =>
    contextWindowTokens === undefined
      ? { role }
      : { role, profile: { knownLimits: { maxOutputTokens: 1_000, contextWindowTokens } } };
  return {
    candidateKnowledgeSelection: fixture.selection,
    modelConfiguration: { author: selectionFor("author"), critic: selectionFor("critic") },
  } as unknown as ContextSnapshot;
}

describe("full-source evidence", () => {
  const directories: string[] = [];
  const knowledge = createCandidateKnowledgeStoreService();
  const sensitivity = createSourceSensitivityService();

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  async function createFixture(withRules: readonly SourceSensitivityRule[] = []): Promise<Fixture> {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-full-source-"));
    directories.push(directory);
    const storeRoot = join(directory, "store");
    const view = await knowledge.initializeStore({ storeRoot });
    const knowledgeBaseId = view.knowledgeBases[0]?.id ?? "";
    const sourcePath = join(directory, "history.md");
    await writeFile(sourcePath, markdown, "utf8");
    await knowledge.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });
    for (const rule of withRules) {
      await sensitivity.addSensitivityRule({
        storeRoot,
        knowledgeBaseId,
        rule: { tier: rule.tier, match: rule.match },
      });
    }
    const selection = await knowledge.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot, knowledgeBaseId }],
    });
    return { storeRoot, knowledgeBaseId, selection };
  }

  function retrieval(
    fixture: Fixture,
    mode: EvidenceMode | undefined,
    contextWindowTokens?: number,
  ) {
    const traces: CandidateKnowledgeRetrievalTraceInput[] = [];
    const runtime = candidateKnowledgeRuntimeRetrieval(
      {
        appendCandidateKnowledgeRetrievalTrace: async (input) => {
          traces.push(input);
          return input as unknown as CandidateKnowledgeRetrievalTrace;
        },
      },
      {
        id: "workspace-full-source",
        requiredSections: [],
        candidateKnowledgeSelection: {
          entries: [{ storeRoot: fixture.storeRoot, knowledgeBaseId: fixture.knowledgeBaseId }],
        },
      },
      contextWith(fixture, contextWindowTokens),
      undefined,
      mode,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge retrieval.");
    return { runtime, traces };
  }

  const query = "platform milestone delivered";

  it("returns every eligible chunk in source order, beyond the retrieval limit", async () => {
    const fixture = await createFixture();
    const { runtime, traces } = retrieval(fixture, "full-source");
    const evidence = await runtime.port.queryEvidence(query);

    expect(evidence.length).toBeGreaterThan(20);
    const texts = evidence.map(({ text }) => text);
    const projectTexts = texts.filter((text) => text.startsWith("Synthetic project"));
    expect(projectTexts).toEqual(
      Array.from({ length: projectCount }, (_, i) => projectParagraph(i)),
    );
    expect(texts[0]).toBe("# Fictional Candidate\nOpening line about platform engineering.");
    expect(evidence.map(({ ordinal }) => ordinal)).toEqual(evidence.map((_, index) => index));
    expect(new Set(evidence.map(({ sourceId }) => sourceId)).size).toBe(1);
    expect(new Set(evidence.map(({ id }) => id)).size).toBe(evidence.length);
    expect(await runtime.evidenceModeDecision()).toMatchObject({
      requestedMode: "full-source",
      effectiveMode: "full-source",
      chunkCount: evidence.length,
    });
    // No retrieval query ran, so nothing was traced as a lexical selection.
    expect(traces).toEqual([]);
    const summary = await runtime.inspect(query);
    expect(summary).toMatchObject({ status: "matched", selectedChunkCount: evidence.length });
  });

  it("uses the same evidence ids and provenance as retrieval mode", async () => {
    const fixture = await createFixture();
    const retrieved = await retrieval(fixture, undefined).runtime.port.queryEvidence(query);
    const full = await retrieval(fixture, "full-source").runtime.port.queryEvidence(query);
    const fullById = new Map(full.map((chunk) => [chunk.id, chunk] as const));
    expect(retrieved.length).toBeGreaterThan(0);
    for (const chunk of retrieved) {
      expect(fullById.get(chunk.id)).toMatchObject({
        sourceId: chunk.sourceId,
        checksum: chunk.checksum,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        text: chunk.text,
        workspaceId: chunk.workspaceId,
      });
    }
  });

  it("keeps sensitivity-withheld chunks out of full-source evidence", async () => {
    const fixture = await createFixture(rules);
    const { runtime } = retrieval(fixture, "full-source");
    const evidence = await runtime.port.queryEvidence(query);
    const text = evidence.map((chunk) => chunk.text).join("\n");
    expect(text).not.toContain(withheldMarker);
    expect(text).not.toContain("Compensation");
    expect(text).toContain(projectParagraph(projectCount - 1));
    expect((await runtime.evidenceModeDecision()).chunkCount).toBe(evidence.length);
  });

  it("control: the withheld section is present when no rule withholds it", async () => {
    const fixture = await createFixture();
    const evidence = await retrieval(fixture, "full-source").runtime.port.queryEvidence(query);
    expect(evidence.map((chunk) => chunk.text).join("\n")).toContain(withheldMarker);
  });

  it("falls back to retrieval when the eligible evidence exceeds the budget, and says so", async () => {
    const fixture = await createFixture();
    const expected = await retrieval(fixture, undefined).runtime.port.queryEvidence(query);
    // 100 tokens of context leaves a 200 character budget.
    const { runtime } = retrieval(fixture, "full-source", 100);
    const evidence = await runtime.port.queryEvidence(query);

    expect(evidence).toEqual(expected);
    const decision = await runtime.evidenceModeDecision();
    expect(decision).toMatchObject({
      requestedMode: "full-source",
      effectiveMode: "retrieval",
      fallbackReason: "budget-exceeded",
      budgetCharacters: 200,
    });
    expect(decision.serializedCharacterCount).toBeGreaterThan(200);

    const lines: string[] = [];
    const appendAuditEvent = vi.fn(async (input: unknown) => input as never);
    await announceRunEvidenceMode(
      { appendAuditEvent },
      runtime,
      "workspace-full-source",
      "run-1",
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("full-source requested, using retrieval");
    expect(lines[0]).toContain("exceeds the budget");
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "run.evidence-mode",
        entityType: "run",
        entityId: "run-1",
        workspaceId: "workspace-full-source",
        payload: expect.objectContaining({
          requestedMode: "full-source",
          effectiveMode: "retrieval",
          fallbackReason: "budget-exceeded",
          budgetCharacters: 200,
        }),
      }),
    );
  });

  it("records the mode and chunk count when full-source is in force", async () => {
    const fixture = await createFixture();
    const { runtime } = retrieval(fixture, "full-source");
    const lines: string[] = [];
    const appendAuditEvent = vi.fn(async (input: unknown) => input as never);
    await announceRunEvidenceMode({ appendAuditEvent }, runtime, "workspace", "run-2", (line) =>
      lines.push(line),
    );
    const evidence = await runtime.port.queryEvidence(query);
    expect(lines).toEqual([
      expect.stringContaining(`Evidence mode: full-source (${evidence.length} eligible chunks`),
    ]);
    expect(appendAuditEvent.mock.calls[0]?.[0]).toMatchObject({
      payload: { effectiveMode: "full-source", chunkCount: evidence.length },
    });
  });

  it("leaves retrieval mode unchanged and silent", async () => {
    const fixture = await createFixture();
    const implicit = await retrieval(fixture, undefined).runtime.port.queryEvidence(query);
    const explicit = retrieval(fixture, "retrieval");
    expect(await explicit.runtime.port.queryEvidence(query)).toEqual(implicit);
    expect(implicit.length).toBeLessThanOrEqual(20);
    expect(await explicit.runtime.evidenceModeDecision()).toMatchObject({
      requestedMode: "retrieval",
      effectiveMode: "retrieval",
    });
    const lines: string[] = [];
    const appendAuditEvent = vi.fn();
    await announceRunEvidenceMode(
      { appendAuditEvent },
      explicit.runtime,
      "workspace",
      "run-3",
      (line) => lines.push(line),
    );
    expect(lines).toEqual([]);
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it("derives the budget from the smaller known context window, else the default", () => {
    const selection = (contextWindowTokens?: number) =>
      contextWindowTokens === undefined
        ? {}
        : { profile: { knownLimits: { maxOutputTokens: 1, contextWindowTokens } } };
    const configuration = (author?: number, critic?: number) =>
      ({ author: selection(author), critic: selection(critic) }) as unknown as Pick<
        ContextSnapshot["modelConfiguration"],
        "author" | "critic"
      >;
    expect(fullSourceBudgetCharacters(configuration(200_000, 1_000_000))).toBe(400_000);
    expect(fullSourceBudgetCharacters(configuration(1_000_000, 100_000))).toBe(200_000);
    expect(fullSourceBudgetCharacters(configuration(200_000, undefined))).toBe(
      defaultFullSourceBudgetCharacters,
    );
    expect(fullSourceBudgetCharacters(configuration())).toBe(240_000);
  });

  it("falls back, with a reason, when nothing is eligible", () => {
    expect(decideFullSourceEvidence([], 1_000)).toMatchObject({
      effectiveMode: "retrieval",
      fallbackReason: "no-eligible-chunks",
    });
  });
});
