import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeRetrievalSourceVersionReference,
  CanonicalCandidateProfile,
  CanonicalCandidateProfileFact,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";
import type { EmbeddingModelIdentity, TextEmbedder } from "@draft-loop/embeddings";
import { describe, expect, it, vi } from "vitest";

import {
  candidateKnowledgeEvidenceChecksum,
  candidateKnowledgeEvidenceSourceId,
} from "./candidate-knowledge-retrieval.js";
import {
  mergeProfileFactEvidence,
  type ProfileFactEvidenceCandidate,
  profileFactEvidenceCandidates,
  profileFactEvidenceIdPrefix,
  profileFactEvidenceSlots,
  rankProfileFactEvidence,
} from "./profile-fact-evidence.js";

function reference(sourceId: string, versionId: string) {
  return {
    storeId: "store-1",
    knowledgeBaseId: "kb-1",
    sourceId,
    versionId,
  } as unknown as CandidateKnowledgeRetrievalSourceVersionReference;
}
const cv = reference("source-cv", "version-cv");
const notes = reference("source-notes", "version-notes");
const unpinned = reference("source-old", "version-old");

function chunk(
  reference: CandidateKnowledgeRetrievalSourceVersionReference,
  ordinal: number,
  lineStart: number,
  lineEnd: number,
  text: string,
): CandidateKnowledgeLexicalChunkInput {
  return {
    chunkId: `${reference.sourceId}-${ordinal}`,
    ordinal,
    lineStart,
    lineEnd,
    text,
    metadata: { provenance: reference },
  };
}

// The CV as the chunker splits it: blank lines 2 and 5 separate the chunks.
const cvChunks = [
  chunk(cv, 0, 1, 1, "# Jane Doe"),
  chunk(
    cv,
    1,
    3,
    4,
    "Senior Engineer at Acme Corp, 2019-2023.\nLed the Kubernetes platform migration.",
  ),
  chunk(cv, 2, 6, 6, "Skills: TypeScript, Go"),
];
// An overlong line is split into consecutive pieces on the same line.
const notesChunks = [
  chunk(notes, 0, 1, 1, "Mentored four engineers "),
  chunk(notes, 1, 1, 1, "through their first on-call rotation."),
];

function fact(
  id: string,
  value: string,
  provenance: readonly (CandidateKnowledgeRetrievalSourceVersionReference & {
    readonly quote?: string;
  })[],
): CanonicalCandidateProfileFact {
  return {
    id,
    category: "experience",
    field: "highlight",
    value,
    provenance: provenance.map((reference) => ({ ...reference, kind: "candidate-provided" })),
  } as unknown as CanonicalCandidateProfileFact;
}

function profile(
  facts: readonly CanonicalCandidateProfileFact[],
): Pick<CanonicalCandidateProfile, "id" | "version" | "facts"> {
  return { id: "profile-1", version: 3, facts } as unknown as Pick<
    CanonicalCandidateProfile,
    "id" | "version" | "facts"
  >;
}

const manifestSourceIds = new Set([
  candidateKnowledgeEvidenceSourceId(cv),
  candidateKnowledgeEvidenceSourceId(notes),
]);

const facts = [
  fact("f-role", "Senior Engineer", [{ ...cv, quote: "Senior Engineer at Acme Corp" }]),
  fact("f-k8s", "Kubernetes platform migration", [
    { ...cv, quote: "Led the Kubernetes platform migration." },
  ]),
  fact("f-span", "Acme Corp", [{ ...cv, quote: "Acme Corp, 2019-2023.\nLed the" }]),
  fact("f-ts", "TypeScript", [{ ...cv, quote: "TypeScript" }]),
  fact("f-mentor", "Mentored four engineers", [
    { ...unpinned, quote: "Mentored four engineers" },
    { ...notes, quote: "four engineers through their first on-call" },
  ]),
  fact("f-no-quote", "Go", [cv]),
  fact("f-edited", "Rust", [{ ...cv, quote: "Rust expert" }]),
  fact("f-withheld", "Salary", [{ ...notes, quote: "Salary expectations" }]),
  fact("f-unpinned", "Java", [{ ...unpinned, quote: "Java" }]),
];

async function candidates(
  profileFacts: readonly CanonicalCandidateProfileFact[] = facts,
): Promise<readonly ProfileFactEvidenceCandidate[]> {
  return profileFactEvidenceCandidates({
    profile: profile(profileFacts),
    workspaceId: "workspace-1",
    manifestSourceIds,
    loadSourceChunks: async () => [...cvChunks, ...notesChunks],
  });
}

describe("profileFactEvidenceCandidates", () => {
  it("turns grounded facts into chunk-shaped items that keep their provenance", async () => {
    const result = await candidates();

    expect(result.map(({ factId }) => factId)).toEqual([
      "f-role",
      "f-k8s",
      "f-span",
      "f-ts",
      "f-mentor",
    ]);
    const [role, k8s, span, typescript, mentor] = result;
    expect(role?.item).toEqual({
      id: expect.stringMatching(new RegExp(`^${profileFactEvidenceIdPrefix}[0-9a-f]{32}$`)),
      workspaceId: "workspace-1",
      sourceId: candidateKnowledgeEvidenceSourceId(cv),
      ordinal: 1,
      lineStart: 3,
      lineEnd: 3,
      checksum: candidateKnowledgeEvidenceChecksum(cv),
      text: "Senior Engineer\nSenior Engineer at Acme Corp",
      rank: 0,
    });
    expect(role?.provenance).toEqual({
      ...cv,
      kind: "candidate-provided",
      quote: "Senior Engineer at Acme Corp",
    });
    expect(k8s?.item).toMatchObject({ lineStart: 4, lineEnd: 4 });
    expect(span?.item).toMatchObject({ lineStart: 3, lineEnd: 4 });
    // A quote that says no more than the value is not repeated.
    expect(typescript?.item).toMatchObject({ lineStart: 6, lineEnd: 6, text: "TypeScript" });
    // The first reference outside the manifest is passed over for the next grounded one.
    expect(mentor?.item).toMatchObject({
      sourceId: candidateKnowledgeEvidenceSourceId(notes),
      lineStart: 1,
      lineEnd: 1,
      ordinal: 0,
    });
    expect(mentor?.provenance.sourceId).toBe("source-notes");
    expect(new Set(result.map(({ item }) => item.id)).size).toBe(result.length);
  });

  it("returns nothing for a profile without grounded facts and loads no source", async () => {
    const loadSourceChunks = vi.fn(async () => cvChunks);
    const request = {
      workspaceId: "workspace-1",
      manifestSourceIds,
      loadSourceChunks,
    };

    expect(await profileFactEvidenceCandidates({ ...request, profile: profile([]) })).toEqual([]);
    expect(
      await profileFactEvidenceCandidates({
        ...request,
        profile: profile([fact("f-no-quote", "Go", [cv])]),
      }),
    ).toEqual([]);
    expect(loadSourceChunks).not.toHaveBeenCalled();
  });

  it("loads only the manifest source versions that facts cite", async () => {
    const loadSourceChunks = vi.fn(async () => cvChunks);
    await profileFactEvidenceCandidates({
      profile: profile(facts),
      workspaceId: "workspace-1",
      manifestSourceIds,
      loadSourceChunks,
    });

    expect(loadSourceChunks).toHaveBeenCalledTimes(1);
    expect(loadSourceChunks).toHaveBeenCalledWith([cv, notes]);
  });

  it("keeps item ids stable for the same profile version and distinct across versions", async () => {
    const first = await candidates();
    const again = await candidates();
    const next = await profileFactEvidenceCandidates({
      profile: { ...profile(facts), version: 4 },
      workspaceId: "workspace-1",
      manifestSourceIds,
      loadSourceChunks: async () => cvChunks,
    });

    expect(again.map(({ item }) => item.id)).toEqual(first.map(({ item }) => item.id));
    expect(next[0]?.item.id).not.toBe(first[0]?.item.id);
  });
});

const identity: EmbeddingModelIdentity = {
  modelId: "fake-model",
  sourceRepository: "example/fake",
  revision: "rev-1",
  modelFileSha256: "a".repeat(64),
  dimensions: 3,
  pooling: "cls",
  runtime: "fake-runtime",
};
const floor = { maxMarginFromTop: 0.5, minimumScore: 0.5 };

/** Leadership-flavoured texts point one way, language skills another, everything else a third. */
function fakeEmbedder(embed?: TextEmbedder["embed"]): TextEmbedder {
  return {
    identity,
    embed:
      embed ??
      (async (texts) =>
        texts.map((text) =>
          Float32Array.from(
            /lead|led|mentor|kubernetes/iu.test(text)
              ? [1, 0, 0]
              : /typescript|programming/iu.test(text)
                ? [0, 1, 0]
                : [0, 0, 1],
          ),
        )),
    dispose: async () => undefined,
  };
}

describe("rankProfileFactEvidence", () => {
  it("ranks lexically and leaves out facts that share no query term", async () => {
    const ranked = await rankProfileFactEvidence({
      candidates: await candidates(),
      query: "Kubernetes migration leadership",
      limit: 8,
    });

    expect(ranked.effectiveMode).toBe("lexical");
    expect(ranked.candidates.map(({ factId }) => factId)).toEqual(["f-k8s"]);
    expect(ranked.candidates[0]?.item.rank).toBeLessThan(0);
  });

  it("selects no facts for a query without searchable terms", async () => {
    const ranked = await rankProfileFactEvidence({
      candidates: await candidates(),
      query: "and the of",
      limit: 8,
      semantic: { mode: "semantic", embedder: fakeEmbedder(), relevanceFloor: floor },
    });

    expect(ranked).toEqual({ candidates: [], effectiveMode: "lexical" });
  });

  it("ranks by meaning in semantic mode", async () => {
    const ranked = await rankProfileFactEvidence({
      candidates: await candidates(),
      query: "people leadership",
      limit: 8,
      semantic: { mode: "semantic", embedder: fakeEmbedder(), relevanceFloor: floor },
    });

    expect(ranked.effectiveMode).toBe("semantic");
    // Neither fact shares a word with the query; the floor drops the unrelated ones.
    expect(ranked.candidates.map(({ factId }) => factId)).toEqual(["f-k8s", "f-span", "f-mentor"]);
  });

  it("fuses vector and lexical ranks in hybrid mode", async () => {
    const request = {
      candidates: await candidates(),
      query: "TypeScript programming migration",
      limit: 8,
    };
    const semantic = await rankProfileFactEvidence({
      ...request,
      semantic: { mode: "semantic", embedder: fakeEmbedder(), relevanceFloor: floor },
    });
    const hybrid = await rankProfileFactEvidence({
      ...request,
      semantic: { mode: "hybrid", embedder: fakeEmbedder(), relevanceFloor: floor },
    });

    expect(semantic.candidates.map(({ factId }) => factId)).toEqual(["f-ts"]);
    expect(hybrid.effectiveMode).toBe("hybrid");
    // f-ts carries both signals; f-k8s joins through its lexical match on "migration".
    expect(hybrid.candidates.map(({ factId }) => factId)).toEqual(["f-ts", "f-k8s"]);
  });

  it("falls back to the lexical ranking when embedding fails", async () => {
    const ranked = await rankProfileFactEvidence({
      candidates: await candidates(),
      query: "Kubernetes",
      limit: 8,
      semantic: {
        mode: "hybrid",
        embedder: fakeEmbedder(async () => {
          throw new Error("model crashed");
        }),
      },
    });

    expect(ranked.effectiveMode).toBe("lexical");
    expect(ranked.candidates.map(({ factId }) => factId)).toEqual(["f-k8s"]);
  });

  it("falls back to the lexical ranking when the floor rejects every fact", async () => {
    const ranked = await rankProfileFactEvidence({
      candidates: await candidates(),
      query: "TypeScript",
      limit: 8,
      semantic: {
        mode: "semantic",
        embedder: fakeEmbedder(),
        relevanceFloor: { maxMarginFromTop: 0, minimumScore: 2 },
      },
    });

    expect(ranked.effectiveMode).toBe("lexical");
    expect(ranked.candidates.map(({ factId }) => factId)).toEqual(["f-ts"]);
  });
});

function scored(id: string, text: string, sourceId = candidateKnowledgeEvidenceSourceId(cv)) {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId,
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    checksum: "c".repeat(64),
    text,
    rank: -1,
  } satisfies ScoredEvidenceChunk;
}

function factCandidate(index: number, quote = `quote ${index}`): ProfileFactEvidenceCandidate {
  return {
    item: scored(`${profileFactEvidenceIdPrefix}${index}`, `value ${index}\n${quote}`),
    factId: `f-${index}`,
    provenance: {
      ...cv,
      kind: "candidate-provided",
      quote,
    } as ProfileFactEvidenceCandidate["provenance"],
  };
}

describe("mergeProfileFactEvidence", () => {
  const manyFacts = Array.from({ length: 12 }, (_, index) => factCandidate(index));
  const manyChunks = Array.from({ length: 20 }, (_, index) =>
    scored(`chunk-${index}`, `chunk ${index}`),
  );

  it("gives facts up to their share of the limit and fills the rest with chunks", () => {
    const merged = mergeProfileFactEvidence({ facts: manyFacts, chunks: manyChunks, limit: 20 });

    expect(profileFactEvidenceSlots(20)).toBe(8);
    expect(merged).toHaveLength(20);
    expect(merged.slice(0, 8).map(({ id }) => id)).toEqual(
      manyFacts.slice(0, 8).map(({ item }) => item.id),
    );
    expect(merged.slice(8).map(({ id }) => id)).toEqual(
      manyChunks.slice(0, 12).map(({ id }) => id),
    );
  });

  it("returns the chunks unchanged when the profile has no selected facts", () => {
    const merged = mergeProfileFactEvidence({ facts: [], chunks: manyChunks, limit: 20 });

    expect(merged).toEqual(manyChunks);
  });

  it("keeps every reserved chunk, even when facts would crowd it out", () => {
    const reserved = new Set(["chunk-15", "chunk-16", "chunk-17", "chunk-18", "chunk-19"]);
    const merged = mergeProfileFactEvidence({
      facts: manyFacts,
      chunks: manyChunks,
      limit: 10,
      isReserved: ({ id }) => reserved.has(id),
    });

    expect(merged).toHaveLength(10);
    expect(merged.filter(({ id }) => id.startsWith(profileFactEvidenceIdPrefix))).toHaveLength(4);
    for (const id of reserved) expect(merged.map((item) => item.id)).toContain(id);
  });

  it("skips a chunk that repeats a selected fact's quote from the same source version", () => {
    const quote = "Led the Kubernetes platform migration.";
    const merged = mergeProfileFactEvidence({
      facts: [factCandidate(0, quote)],
      chunks: [
        scored("duplicate", `Senior Engineer\n${quote}`),
        scored("other-source", quote, candidateKnowledgeEvidenceSourceId(notes)),
        scored("reserved-duplicate", `Contact\n${quote}`),
        scored("unrelated", "Skills: TypeScript"),
      ],
      limit: 20,
      isReserved: ({ id }) => id === "reserved-duplicate",
    });

    expect(merged.map(({ id }) => id)).toEqual([
      `${profileFactEvidenceIdPrefix}0`,
      "other-source",
      "reserved-duplicate",
      "unrelated",
    ]);
  });
});
