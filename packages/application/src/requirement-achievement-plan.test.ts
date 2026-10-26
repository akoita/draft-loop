import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import {
  createRequirementAchievementPlan,
  requirementsWithoutEvidence,
} from "./requirement-achievement-plan.js";

function chunk(id: string, text: string, rank: number): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: `source-${id}`,
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    checksum: "a".repeat(64),
    text,
    rank,
  };
}

describe("requirement-to-achievement planning", () => {
  const requirements = [
    { id: "typescript", text: "Build reliable TypeScript services", priority: "critical" as const },
    { id: "mentoring", text: "Mentor engineering teams", priority: "high" as const },
    { id: "kubernetes", text: "Operate Kubernetes clusters", priority: "medium" as const },
  ];

  it("selects the strongest unique evidence and exposes uncovered requirements", () => {
    const result = createRequirementAchievementPlan(requirements, [
      chunk("weak-typescript", "Used TypeScript for internal scripts", -1),
      chunk("strong-typescript", "Built reliable TypeScript services", -4),
      chunk("mentoring", "Mentored distributed engineering teams", -2),
      chunk("strong-typescript", "duplicate must be ignored", -9),
    ]);

    expect(result).toEqual({
      status: "ready",
      coverage: [
        { requirementId: "typescript", evidenceChunkId: "strong-typescript" },
        { requirementId: "mentoring", evidenceChunkId: "mentoring" },
        { requirementId: "kubernetes", evidenceChunkId: null },
      ],
      achievements: [
        {
          evidenceChunkId: "strong-typescript",
          sourceId: "source-strong-typescript",
          requirementIds: ["typescript"],
        },
        {
          evidenceChunkId: "mentoring",
          sourceId: "source-mentoring",
          requirementIds: ["mentoring"],
        },
      ],
      uncoveredRequirementIds: ["kubernetes"],
    });
  });

  it("returns an explicit no-evidence plan", () => {
    expect(createRequirementAchievementPlan(requirements, [])).toMatchObject({
      status: "no-evidence",
      achievements: [],
      uncoveredRequirementIds: ["typescript", "mentoring", "kubernetes"],
    });
    expect(
      createRequirementAchievementPlan(requirements, [
        chunk("irrelevant", "Designed accessible color palettes", -10),
      ]),
    ).toMatchObject({
      status: "no-evidence",
      achievements: [],
      uncoveredRequirementIds: ["typescript", "mentoring", "kubernetes"],
    });
  });
});

describe("requirements without sent evidence (#1775)", () => {
  it("counts one chunk for every requirement it answers, worded differently or not", () => {
    const requirements = [
      { id: "services", text: "Build TypeScript services" },
      {
        id: "remote",
        text: "Communicate clearly in writing and work autonomously with remote teams",
      },
      { id: "kubernetes", text: "Operate Kubernetes clusters" },
    ];
    const sent = [
      chunk(
        "notes",
        "Built TypeScript services and collaborated remotely through written design notes",
        -1,
      ),
    ];

    // The plan gives the one chunk to the first requirement only.
    expect(createRequirementAchievementPlan(requirements, sent).uncoveredRequirementIds).toEqual([
      "remote",
      "kubernetes",
    ]);
    // "remote" begins "remotely", so the chunk speaks to it too; nothing speaks to Kubernetes.
    expect(requirementsWithoutEvidence(requirements, sent)).toEqual(["kubernetes"]);
  });

  it("does not match a short shared beginning or an empty chunk", () => {
    const requirements = [{ id: "art", text: "Art direction" }];
    expect(requirementsWithoutEvidence(requirements, [chunk("a", "Artist portfolio", -1)])).toEqual(
      ["art"],
    );
    expect(requirementsWithoutEvidence(requirements, [chunk("b", "   ", -1)])).toEqual(["art"]);
  });
});
