import type { RetrievalPort, ScoredEvidenceChunk } from "@draft-loop/domain";
import { describe, expect, it, vi } from "vitest";

import type { EvidenceModeDecision } from "./full-source-evidence.js";
import {
  maximumPicksPerRequirement,
  pickRequirementEvidence,
  withRequirementPickedEvidence,
} from "./requirement-picked-evidence.js";

const chunk = (id: string, text: string) =>
  ({ id, sourceId: "source-1", text }) as unknown as ScoredEvidenceChunk;

const eligible = [
  chunk("contact", "Fictional Candidate, invented city."),
  chunk("kube", "Operated Kubernetes clusters for a synthetic payments platform."),
  chunk("garden", "Kept a community garden for an invented neighbourhood."),
  chunk("python", "Built Python data pipelines for a fictional retailer."),
  chunk("kube-2", "Migrated synthetic workloads to Kubernetes with zero downtime."),
];

describe("requirement-picked evidence", () => {
  it("picks the chunks that match a requirement, in source order, and skips the rest", () => {
    const picks = pickRequirementEvidence({
      eligible,
      selected: [],
      requirements: ["Kubernetes operations", "Python pipelines"],
      budgetCharacters: 100_000,
    });
    expect(picks.map(({ id }) => id)).toEqual(["kube", "python", "kube-2"]);
  });

  it("never picks evidence that is already selected", () => {
    const picks = pickRequirementEvidence({
      eligible,
      selected: [eligible[1] as ScoredEvidenceChunk],
      requirements: ["Kubernetes operations"],
      budgetCharacters: 100_000,
    });
    expect(picks.map(({ id }) => id)).toEqual(["kube-2"]);
  });

  it("stays within the character budget and lets requirements take turns", () => {
    const one = JSON.stringify(eligible[1]).length + 1;
    const two = JSON.stringify(eligible[3]).length + 1;
    const picks = pickRequirementEvidence({
      eligible,
      selected: [],
      requirements: ["Kubernetes operations", "Python pipelines"],
      budgetCharacters: one + two,
    });
    // One chunk each before the first requirement gets its second.
    expect(picks.map(({ id }) => id)).toEqual(["kube", "python"]);
    expect(
      pickRequirementEvidence({
        eligible,
        selected: [],
        requirements: ["Kubernetes operations"],
        budgetCharacters: 10,
      }),
    ).toEqual([]);
  });

  it("bounds what one requirement adds", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      chunk(`k${index}`, `Synthetic Kubernetes delivery ${index}.`),
    );
    const picks = pickRequirementEvidence({
      eligible: many,
      selected: [],
      requirements: ["Kubernetes"],
      budgetCharacters: 1_000_000,
    });
    expect(picks).toHaveLength(maximumPicksPerRequirement);
  });

  it("matches without regard to case or accents", () => {
    const picks = pickRequirementEvidence({
      eligible: [chunk("fr", "Ingénierie de données pour un client fictif.")],
      selected: [],
      requirements: ["INGENIERIE"],
      budgetCharacters: 1_000,
    });
    expect(picks.map(({ id }) => id)).toEqual(["fr"]);
  });

  function runtime(decision: Partial<EvidenceModeDecision>, selected: ScoredEvidenceChunk[]) {
    return {
      port: { queryEvidence: vi.fn<RetrievalPort["queryEvidence"]>(async () => selected) },
      evidenceModeDecision: async () =>
        ({
          requestedMode: "full-source",
          effectiveMode: "retrieval",
          chunkCount: eligible.length,
          serializedCharacterCount: 0,
          budgetCharacters: 100_000,
          ...decision,
        }) as EvidenceModeDecision,
      fullSourceEvidence: vi.fn(async () => eligible),
      marker: "kept",
    };
  }
  const context = {
    requirements: [{ id: "r1", text: "Kubernetes operations", priority: "must" }],
  } as never;

  it("adds picks to retrieval's selection when the cost cap caused the fallback", async () => {
    const base = runtime({ fallbackReason: "cost-cap-exceeded" }, [
      eligible[0] as ScoredEvidenceChunk,
    ]);
    const wrapped = withRequirementPickedEvidence(base, context);
    expect(wrapped.marker).toBe("kept");
    const evidence = await wrapped.port.queryEvidence("job text", { workspaceId: "w" });
    expect(evidence.map(({ id }) => id)).toEqual(["contact", "kube", "kube-2"]);
    expect(base.port.queryEvidence).toHaveBeenCalledWith("job text", { workspaceId: "w" });
  });

  it("uses the query when the run has no requirements", async () => {
    const wrapped = withRequirementPickedEvidence(
      runtime({ fallbackReason: "cost-cap-exceeded" }, []),
      { requirements: [] },
    );
    const evidence = await wrapped.port.queryEvidence("Python pipelines wanted");
    expect(evidence.map(({ id }) => id)).toEqual(["python"]);
  });

  it.each([
    [{ effectiveMode: "full-source" as const }],
    [{ fallbackReason: "budget-exceeded" as const }],
    [{ fallbackReason: "no-eligible-chunks" as const }],
    [{ requestedMode: "retrieval" as const }],
  ])("leaves %o unchanged", async (decision) => {
    const selected = [eligible[0] as ScoredEvidenceChunk];
    const base = runtime(decision, selected);
    const evidence = await withRequirementPickedEvidence(base, context).port.queryEvidence("job");
    expect(evidence).toBe(selected);
    expect(base.fullSourceEvidence).not.toHaveBeenCalled();
  });
});
