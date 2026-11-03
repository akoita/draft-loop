import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { modelFacingRunEvidence } from "./model-facing-evidence.js";
import { createRequirementAchievementPlan } from "./requirement-achievement-plan.js";

function chunk(ordinal: number, sourceId: string, text: string): ScoredEvidenceChunk {
  return {
    id: `${ordinal}`.repeat(64).slice(0, 64),
    workspaceId: "workspace",
    sourceId,
    ordinal,
    lineStart: ordinal * 10 + 1,
    lineEnd: ordinal * 10 + 9,
    checksum: "b".repeat(64),
    text,
    rank: 0.0612345678912345 + ordinal,
  };
}

const evidence = [
  chunk(0, "ckb-source-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Built TypeScript tools in 2020."),
  chunk(1, "ckb-source-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "Led a Postgres migration in 2021."),
  chunk(2, "ckb-source-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Mentored four engineers in 2022."),
];
const requirements = [
  { id: "req-ts", text: "TypeScript tools" },
  { id: "req-pg", text: "Postgres migration" },
];

describe("modelFacingRunEvidence", () => {
  it("sends each chunk's id, source alias, line numbers and text and nothing else", () => {
    const plan = createRequirementAchievementPlan(requirements, evidence);
    const facing = modelFacingRunEvidence(evidence, plan);
    expect(facing.retrievedEvidence).toEqual([
      { id: evidence[0]?.id, sourceId: "S1", lineStart: 1, lineEnd: 9, text: evidence[0]?.text },
      { id: evidence[1]?.id, sourceId: "S2", lineStart: 11, lineEnd: 19, text: evidence[1]?.text },
      { id: evidence[2]?.id, sourceId: "S1", lineStart: 21, lineEnd: 29, text: evidence[2]?.text },
    ]);
    const serialized = JSON.stringify(facing);
    for (const key of ["checksum", "workspaceId", "rank", "ordinal", "ckb-source-"]) {
      expect(serialized).not.toContain(key);
    }
  });

  it("names the plan's achievements by the same source alias and keeps the rest of the plan", () => {
    const plan = createRequirementAchievementPlan(requirements, evidence);
    const facing = modelFacingRunEvidence(evidence, plan);
    expect(facing.achievementPlan).toEqual({
      ...plan,
      achievements: plan.achievements.map((achievement) => ({
        ...achievement,
        sourceId: achievement.sourceId.endsWith("a".repeat(32)) ? "S1" : "S2",
      })),
    });
    expect(facing.achievementPlan.coverage).toBe(plan.coverage);
    expect(facing.achievementPlan.status).toBe("ready");
  });

  it("keeps real source ids when one already looks like an alias", () => {
    const aliased = [chunk(0, "S7", "Built tools."), chunk(1, "other", "Led work.")];
    const plan = createRequirementAchievementPlan([], aliased);
    const facing = modelFacingRunEvidence(aliased, plan);
    expect(facing.retrievedEvidence.map(({ sourceId }) => sourceId)).toEqual(["S7", "other"]);
  });

  it("gives the same aliases on every call of a run, so the cached prefix stays identical", () => {
    const plan = createRequirementAchievementPlan(requirements, evidence);
    expect(JSON.stringify(modelFacingRunEvidence(evidence, plan))).toBe(
      JSON.stringify(modelFacingRunEvidence([...evidence], { ...plan })),
    );
  });
});
