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
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import {
  type CandidateKnowledgeSensitivityExclusions,
  candidateKnowledgeRequestGuard,
  createCandidateKnowledgeSensitivityExclusions,
  sensitivityExclusionUnavailableMessage,
  sensitivityRequestRefusedMessage,
} from "./candidate-knowledge-sensitivity-exclusion.js";
import { CliUserError } from "./cli-user-error.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createSourceSensitivityService } from "./source-sensitivity-service.js";

const neverShareMarker = "alpha7731";
const neverShareLine = `Fictional salary history ${neverShareMarker} for the synthetic former employer.`;
const sensitiveMarker = "zeta4410";
const sensitiveLine = `Synthetic recovery information ${sensitiveMarker} about the fictional person.`;
const sharedLine = "This sentence appears in a normal section and in a withheld one.";

const markdown = [
  "# Fictional Candidate",
  "Opening line about platform engineering and reliable operations.",
  "",
  "## Experience",
  "Maintained fictional service pipelines with careful reliability work.",
  sharedLine,
  "",
  "## Compensation",
  neverShareLine,
  sharedLine,
  "",
  "## Health notes",
  sensitiveLine,
  "",
  "## Skills",
  "Java and distributed systems at fictional scale.",
  "",
].join("\n");

const rules: readonly SourceSensitivityRule[] = [
  { id: "r-never", tier: "never-share", match: { kind: "heading-contains", text: "compensation" } },
  { id: "r-sensitive", tier: "sensitive", match: { kind: "heading-contains", text: "health" } },
];

const passThrough: CandidateKnowledgeSensitivityExclusions = {
  filterChunks: async (chunks) => chunks,
  filterResult: async (result) => result,
  assertRequestClean: async () => undefined,
};

interface Fixture {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
  readonly selection: CandidateKnowledgeSelectionSnapshot;
}

describe("candidate knowledge sensitivity exclusion", () => {
  const directories: string[] = [];
  const knowledge = createCandidateKnowledgeStoreService();
  const sensitivity = createSourceSensitivityService();

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  async function createFixture(options: {
    readonly text?: string;
    readonly fileName?: string;
    readonly rules?: readonly SourceSensitivityRule[];
  }): Promise<Fixture> {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-run-sensitivity-"));
    directories.push(directory);
    const storeRoot = join(directory, "store");
    const view = await knowledge.initializeStore({ storeRoot });
    const knowledgeBaseId = view.knowledgeBases[0]?.id ?? "";
    const sourcePath = join(directory, options.fileName ?? "history.md");
    await writeFile(sourcePath, options.text ?? markdown, "utf8");
    await knowledge.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });
    for (const rule of options.rules ?? []) {
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
    exclusions: CandidateKnowledgeSensitivityExclusions | undefined,
    requiredSections: readonly string[] = ["Experience", "Skills"],
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
        id: "workspace-sensitivity",
        requiredSections,
        candidateKnowledgeSelection: {
          entries: [{ storeRoot: fixture.storeRoot, knowledgeBaseId: fixture.knowledgeBaseId }],
        },
      },
      { candidateKnowledgeSelection: fixture.selection } as ContextSnapshot,
      exclusions,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge retrieval.");
    return { runtime, traces };
  }

  const queries = [
    `salary history ${neverShareMarker} recovery ${sensitiveMarker}`,
    "Java distributed systems reliability",
  ];

  it("keeps never-share and sensitive text out of every retrieval path", async () => {
    const fixture = await createFixture({ rules });
    const { runtime, traces } = retrieval(fixture, undefined);
    for (const query of queries) {
      const result = await runtime.inspect(query);
      const texts = result.hits.map(({ text }) => text).join("\n");
      expect(texts).not.toContain(neverShareMarker);
      expect(texts).not.toContain(sensitiveMarker);
      expect(texts).not.toContain("Compensation");
      expect(texts).not.toContain("Health notes");
      expect(result.selectedChunkCount).toBe(result.hits.length);
    }
    const evidence = await runtime.port.queryEvidence(queries[0] ?? "");
    expect(evidence.map(({ text }) => text).join("\n")).not.toContain(neverShareMarker);
    expect(traces.length).toBeGreaterThan(0);
  });

  it("keeps normal sections and keeps traces consistent with the filtered result", async () => {
    const fixture = await createFixture({ rules });
    const filtered = retrieval(fixture, undefined);
    const unfiltered = retrieval(fixture, passThrough);
    const query = queries[1] ?? "";
    const result = await filtered.runtime.inspect(query);
    expect(result.hits.map(({ text }) => text).join("\n")).toContain(
      "Java and distributed systems at fictional scale.",
    );
    expect(result.hits.map(({ text }) => text).join("\n")).toContain(
      "Maintained fictional service pipelines",
    );

    const withheldIds = new Set<string>(
      (await unfiltered.runtime.inspect(queries[0] ?? "")).hits
        .filter(({ text }) => text.includes(neverShareMarker) || text.includes(sensitiveMarker))
        .map(({ chunkId }) => chunkId),
    );
    expect(withheldIds.size).toBeGreaterThan(0);
    await filtered.runtime.inspect(queries[0] ?? "");
    const tracedIds = filtered.traces.flatMap(({ selectedChunks }) =>
      selectedChunks.map(({ chunkId }) => chunkId),
    );
    expect(tracedIds.some((id) => withheldIds.has(id))).toBe(false);
    for (const trace of filtered.traces) {
      expect(trace.selectedChunkCount).toBe(trace.selectedChunks.length);
    }
  });

  it("control: the same retrieval leaks the withheld text when the filter is disabled", async () => {
    const fixture = await createFixture({ rules });
    const { runtime } = retrieval(fixture, passThrough);
    const texts = (await runtime.inspect(queries[0] ?? "")).hits.map(({ text }) => text).join("\n");
    expect(texts).toContain(neverShareMarker);
    expect(texts).toContain(sensitiveMarker);
  });

  it("drops a chunk that straddles a withheld boundary", async () => {
    const text = [
      "# Fictional Candidate",
      "",
      "## Skills",
      "Straddling normal skills sentence.",
      "## Compensation",
      neverShareLine,
      "",
      "## Education",
      "Fictional degree at a synthetic university.",
      "",
    ].join("\n");
    const fixture = await createFixture({ text, rules });
    const result = await retrieval(fixture, undefined, ["Skills"]).runtime.inspect(
      `skills ${neverShareMarker} degree`,
    );
    const texts = result.hits.map((hit) => hit.text).join("\n");
    expect(texts).not.toContain(neverShareMarker);
    expect(texts).not.toContain("Straddling normal skills sentence.");
    expect(texts).toContain("Fictional degree at a synthetic university.");
    const control = await retrieval(fixture, passThrough, ["Skills"]).runtime.inspect(
      `skills ${neverShareMarker} degree`,
    );
    expect(control.hits.map((hit) => hit.text).join("\n")).toContain("Straddling normal skills");
  });

  it("filters chunks by inclusive 1-based line overlap", async () => {
    const fixture = await createFixture({ rules });
    const exclusions = createCandidateKnowledgeSensitivityExclusions(
      [{ storeRoot: fixture.storeRoot, knowledgeBaseId: fixture.knowledgeBaseId }],
      fixture.selection,
    );
    const source = fixture.selection.entries[0]?.sources[0];
    const entry = fixture.selection.entries[0];
    if (entry === undefined || source === undefined) throw new Error("Expected a source.");
    const lines = markdown.split("\n");
    const lineOf = (needle: string) => lines.findIndex((line) => line.startsWith(needle)) + 1;
    const chunk = (lineStart: number, lineEnd: number) => ({
      lineStart,
      lineEnd,
      metadata: {
        provenance: {
          storeId: entry.storeId,
          knowledgeBaseId: entry.knowledgeBaseId,
          sourceId: source.sourceId,
          versionId: source.versionId,
        },
      },
    });
    const compensation = lineOf("## Compensation");
    const health = lineOf("## Health notes");
    const skills = lineOf("## Skills");
    const kept = [
      chunk(1, 2),
      chunk(lineOf("## Experience"), compensation - 2),
      chunk(skills, skills + 1),
    ];
    const dropped = [
      chunk(compensation, compensation),
      chunk(compensation - 1, compensation),
      chunk(compensation + 1, compensation + 2),
      chunk(health, health + 1),
      chunk(health + 1, health + 3),
      chunk(1, lines.length),
    ];
    expect(await exclusions.filterChunks([...kept, ...dropped])).toEqual(kept);
  });

  describe("chronology role bodies", () => {
    const role = (index: number, withheld: boolean): string[] => [
      `## Fictional Employer ${index} — Platform Engineer — January ${2000 + index} to December ${2000 + index}`,
      "",
      `Maintained fictional service number ${index} with documented operations.`,
      "",
      ...(withheld ? ["### Compensation", neverShareLine, ""] : []),
    ];
    const roleDocument = (roles: number, fillers: number): string =>
      [
        "# Fictional Candidate",
        "",
        ...Array.from({ length: roles }, (_, i) => role(i + 1, i === 1)).flat(),
        ...(fillers === 0 ? [] : ["## Notes", ""]),
        ...Array.from({ length: fillers }, (_, i) => [`Filler note ${i} from January.`, ""]).flat(),
      ].join("\n");

    for (const [name, roles, fillers] of [
      ["bounded", 4, 0],
      ["saturated local-source scan", 12, 130],
    ] as const) {
      it(`keeps withheld text out of ${name} role evidence`, async () => {
        const fixture = await createFixture({ text: roleDocument(roles, fillers), rules });
        const filtered = await retrieval(fixture, undefined, ["Experience"]).runtime.inspect(
          "platform engineer operations",
        );
        const texts = filtered.hits.map((hit) => hit.text).join("\n");
        expect(texts).toContain("Fictional Employer 1 ");
        expect(texts).not.toContain(neverShareMarker);
        const control = await retrieval(fixture, passThrough, ["Experience"]).runtime.inspect(
          "platform engineer operations",
        );
        expect(control.hits.map((hit) => hit.text).join("\n")).toContain(neverShareMarker);
      }, 120_000);
    }
  });

  // Each retrieval runs a dozen real lexical queries, so the two scenarios are separate cases:
  // together they used most of the per-test timeout.
  describe("changes nothing", () => {
    const scenarios = [
      ["without rules", {}],
      [
        "for non-Markdown sources",
        {
          text: "# Compensation\nPlain text heading with a synthetic pay line.\n",
          fileName: "notes.txt",
          rules,
        },
      ],
    ] as const;

    for (const [name, fixtureOptions] of scenarios) {
      it(name, async () => {
        const fixture = await createFixture(fixtureOptions);
        const filtered = await retrieval(fixture, undefined).runtime.inspect("pay line recovery");
        const unfiltered = await retrieval(fixture, passThrough).runtime.inspect(
          "pay line recovery",
        );
        expect(filtered.hits.map(({ text }) => text)).toEqual(
          unfiltered.hits.map(({ text }) => text),
        );
        expect(filtered.hits.length).toBeGreaterThan(0);
      });
    }
  });

  it("fails closed when the rules or sources cannot be read", async () => {
    const fixture = await createFixture({ rules });
    const unreadable = createCandidateKnowledgeSensitivityExclusions(
      [{ storeRoot: fixture.storeRoot, knowledgeBaseId: fixture.knowledgeBaseId }],
      fixture.selection,
      {
        open: async () => {
          throw new Error("secret local path /private/location");
        },
      },
    );
    await expect(unreadable.filterChunks([])).rejects.toThrow(
      sensitivityExclusionUnavailableMessage,
    );
    await expect(unreadable.assertRequestClean({})).rejects.toBeInstanceOf(CliUserError);
    await expect(retrieval(fixture, unreadable).runtime.inspect(queries[0] ?? "")).rejects.toThrow(
      sensitivityExclusionUnavailableMessage,
    );

    const missingBinding = createCandidateKnowledgeSensitivityExclusions([], fixture.selection);
    await expect(missingBinding.filterChunks([])).rejects.toBeInstanceOf(CliUserError);
  });

  describe("outgoing request guard", () => {
    const authorRequest = (text: string): ModelRequest<JsonObject> =>
      ({
        input: { retrievedEvidence: [{ id: "e1", text }], findings: [] },
      }) as unknown as ModelRequest<JsonObject>;
    const criticRequest = (text: string): ModelRequest<JsonObject> =>
      ({
        input: { artifact: { blocks: [{ text: `Draft: ${text}` }] }, retrievedEvidence: [] },
      }) as unknown as ModelRequest<JsonObject>;

    async function guardedAdapter(fixture: Fixture) {
      const execute = vi.fn(async () => ({ output: {} }) as unknown as ModelResponse<JsonObject>);
      const guard = candidateKnowledgeRequestGuard(
        {
          candidateKnowledgeSelection: {
            entries: [{ storeRoot: fixture.storeRoot, knowledgeBaseId: fixture.knowledgeBaseId }],
          },
        },
        { candidateKnowledgeSelection: fixture.selection },
      );
      return { execute, adapter: guard({ execute }) };
    }

    it("refuses author and critic requests that contain withheld text without calling the provider", async () => {
      const fixture = await createFixture({ rules });
      const { adapter, execute } = await guardedAdapter(fixture);
      for (const planted of [neverShareLine, sensitiveLine]) {
        // Case and whitespace changes do not hide a withheld line.
        const reshaped = `  ${planted.toUpperCase().replace(/ /gu, "  ")} `;
        for (const request of [authorRequest(reshaped), criticRequest(planted)]) {
          const error = await adapter.execute(request).catch((caught: unknown) => caught);
          expect(error).toBeInstanceOf(CliUserError);
          expect((error as Error).message).toBe(sensitivityRequestRefusedMessage);
          expect((error as Error).message).not.toContain(neverShareMarker);
          expect((error as Error).message).not.toContain(sensitiveMarker);
        }
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it("passes clean requests, including lines that also appear in normal sections", async () => {
      const fixture = await createFixture({ rules });
      const { adapter, execute } = await guardedAdapter(fixture);
      await adapter.execute(authorRequest("Java and distributed systems at fictional scale."));
      await adapter.execute(criticRequest(sharedLine));
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("leaves a workspace without sensitivity rules or a selection untouched", async () => {
      const fixture = await createFixture({});
      const { adapter, execute } = await guardedAdapter(fixture);
      await adapter.execute(authorRequest(neverShareLine));
      expect(execute).toHaveBeenCalledTimes(1);
      const unwrapped = { execute };
      expect(candidateKnowledgeRequestGuard({}, {})(unwrapped)).toBe(unwrapped);
    });
  });
});
