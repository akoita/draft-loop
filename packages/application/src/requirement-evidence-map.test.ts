import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type {
  EmbeddingModelIdentity,
  SemanticRelevanceFloor,
  TextEmbedder,
} from "@draft-loop/embeddings";
import { describe, expect, it } from "vitest";

import {
  buildRequirementEvidenceMap,
  requirementEvidenceMapAuditPayload,
  requirementEvidenceMapPreflightLine,
} from "./requirement-evidence-map.js";

const chunk = (id: string, text: string) =>
  ({ id, sourceId: "source-1", text }) as unknown as ScoredEvidenceChunk;

/** Invented evidence: one reworded match, one French match, one keyword trap. */
const eligible = [
  chunk("lead", "Guided a team of five engineers through a platform rewrite."),
  chunk("fr", "Responsable de la migration vers le nuage pour une entreprise fictive."),
  chunk("trap", "Attended a machine learning meetup in an invented city."),
  chunk("kube", "Operated Kubernetes clusters for a synthetic payments platform."),
];

const requirements = [
  { id: "r-lead", text: "Engineering leadership experience" },
  { id: "r-cloud", text: "Led a cloud migration" },
  { id: "r-kube", text: "Kubernetes operations" },
  { id: "r-ml", text: "Machine learning engineering teams" },
];

/** Each text gets a fixed vector; the cosines are chosen so meaning beats shared words. */
const vectors: Readonly<Record<string, readonly number[]>> = {
  [eligible[0]?.text ?? ""]: [1, 0, 0, 0],
  [eligible[1]?.text ?? ""]: [0, 1, 0, 0],
  [eligible[2]?.text ?? ""]: [0, 0, 1, 0],
  [eligible[3]?.text ?? ""]: [0, 0, 0, 1],
  "Engineering leadership experience": [0.95, 0, 0.31, 0],
  "Led a cloud migration": [0, 0.97, 0, 0.24],
  "Kubernetes operations": [0, 0, 0, 1],
  "Machine learning engineering teams": [0.9, 0, 0.44, 0],
};

const identity: EmbeddingModelIdentity = {
  modelId: "fake-model",
  sourceRepository: "example/fake",
  revision: "rev-1",
  modelFileSha256: "a".repeat(64),
  dimensions: 4,
  pooling: "cls",
  runtime: "fake-runtime",
};

const floor: SemanticRelevanceFloor = { maxMarginFromTop: 0.1, minimumScore: 0.8 };

function fakeEmbedder(fail?: Error, zero = false): TextEmbedder & { readonly roles: string[] } {
  const roles: string[] = [];
  return {
    identity,
    roles,
    async embed(texts, role) {
      roles.push(role);
      if (fail !== undefined) throw fail;
      if (zero) return texts.map(() => new Float32Array(4));
      return texts.map((text) => Float32Array.from(vectors[text] ?? [0.5, 0.5, 0.5, 0.5]));
    },
    async dispose() {},
  };
}

describe("requirement-evidence map", () => {
  it("ranks by meaning first and adds the keyword matches meaning missed", async () => {
    const embedder = fakeEmbedder();
    const map = await buildRequirementEvidenceMap({ requirements, eligible, embedder, floor });

    expect(map).toMatchObject({ mode: "semantic", modelId: "fake-model", chunkCount: 4 });
    expect(map.reason).toBeUndefined();
    expect(embedder.roles).toEqual(["document", "query"]);
    const byId = Object.fromEntries(map.entries.map((entry) => [entry.requirementId, entry]));
    expect(byId["r-lead"]?.candidates).toEqual([
      { chunkId: "lead", score: expect.closeTo(0.95, 2), origin: "semantic" },
    ]);
    expect(byId["r-cloud"]?.candidates).toEqual([
      { chunkId: "fr", score: expect.closeTo(0.97, 2), origin: "both" },
    ]);
    expect(byId["r-kube"]?.candidates).toEqual([
      { chunkId: "kube", score: expect.closeTo(1, 2), origin: "both" },
    ]);
    // The keyword trap shares "machine learning" but meaning ranks the real match first.
    expect(byId["r-ml"]?.candidates).toEqual([
      { chunkId: "lead", score: expect.closeTo(0.9, 2), origin: "semantic" },
      { chunkId: "trap", origin: "keyword" },
    ]);
    expect(requirementEvidenceMapPreflightLine(map)).toBe(
      "Requirement evidence: 4 of 4 requirements matched by meaning and keywords",
    );
  });

  it("keeps at most the limit per requirement", async () => {
    const map = await buildRequirementEvidenceMap({
      requirements: [{ id: "r-platform", text: "platform engineering for a synthetic team" }],
      eligible,
      embedder: fakeEmbedder(),
      floor: { maxMarginFromTop: 1, minimumScore: -1 },
      limit: 2,
    });
    expect(map.entries[0]?.candidates).toHaveLength(2);
  });

  it("is keyword-only without a model and says why", async () => {
    const map = await buildRequirementEvidenceMap({ requirements, eligible });
    expect(map).toMatchObject({ mode: "keyword", reason: "no-model", chunkCount: 4 });
    const kube = map.entries.find(({ requirementId }) => requirementId === "r-kube");
    expect(kube?.candidates).toEqual([{ chunkId: "kube", origin: "keyword" }]);
    expect(requirementEvidenceMapPreflightLine(map)).toContain("no local model is installed");
  });

  it("is keyword-only for a model with no calibrated floor", async () => {
    const embedder = fakeEmbedder();
    const map = await buildRequirementEvidenceMap({ requirements, eligible, embedder });
    expect(map).toMatchObject({ mode: "keyword", reason: "uncalibrated-model" });
    expect(embedder.roles).toEqual([]);
  });

  it("falls back to keywords when the embedder fails", async () => {
    const map = await buildRequirementEvidenceMap({
      requirements,
      eligible,
      embedder: fakeEmbedder(new Error("runtime crashed")),
      floor,
    });
    expect(map).toMatchObject({ mode: "keyword", reason: "embedding-failed" });
    expect(requirementEvidenceMapPreflightLine(map)).toContain("the local model failed");
  });

  it("falls back to keywords when the embedder returns a zero vector", async () => {
    const map = await buildRequirementEvidenceMap({
      requirements,
      eligible,
      embedder: fakeEmbedder(undefined, true),
      floor,
    });
    expect(map).toMatchObject({ mode: "keyword", reason: "embedding-failed" });
  });

  it("rethrows an abort instead of falling back", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildRequirementEvidenceMap({
        requirements,
        eligible,
        embedder: fakeEmbedder(new Error("aborted")),
        floor,
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
  });

  it("records ids, origins and rounded scores, never evidence text", async () => {
    const map = await buildRequirementEvidenceMap({
      requirements,
      eligible,
      embedder: fakeEmbedder(),
      floor,
    });
    const payload = requirementEvidenceMapAuditPayload(map);
    expect(payload).toMatchObject({
      mode: "semantic",
      modelId: "fake-model",
      chunkCount: 4,
      requirementCount: 4,
      requirementsWithEvidence: 4,
    });
    const serialized = JSON.stringify(payload);
    for (const { text } of eligible) expect(serialized).not.toContain(text);
    for (const { text } of requirements) expect(serialized).not.toContain(text);
    expect(serialized).toMatch(/"score":0\.95\d?[,}]/u);
  });
});
