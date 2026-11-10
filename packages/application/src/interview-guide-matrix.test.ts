import { factUsageKey } from "@draft-loop/domain/fact-usage";
import { describe, expect, it } from "vitest";

import {
  interviewGuideFacts,
  interviewGuideMatrix,
  interviewGuideNeverSay,
  touchesNeverSay,
} from "./interview-guide-matrix.js";

// An invented candidate and job only.
const fact = (id: string, field: string, value: string, category = "experience") => ({
  id,
  category,
  field,
  value,
});
const facts = [
  fact("f1", "outcome", "Migrated a payments ledger to PostgreSQL with zero data loss"),
  fact("f2", "skill", "Kubernetes"),
  fact("f3", "outcome", "Coached two junior engineers through their first releases"),
];
const requirements = [
  { id: "r1", text: "Kubernetes", priority: "medium" as const },
  {
    id: "r2",
    text: "Lead database migrations on PostgreSQL ledger systems",
    priority: "critical" as const,
  },
  { id: "r3", text: "People management of a team of eight", priority: "high" as const },
];

describe("interview guide matrix", () => {
  it("orders requirements by priority and lists the facts that support each", () => {
    const matrix = interviewGuideMatrix(requirements, facts);
    expect(matrix.rows.map((row) => [row.requirementId, row.factIds])).toEqual([
      ["r2", ["f1"]],
      ["r3", []],
      ["r1", ["f2"]],
    ]);
    expect(matrix.gaps.map((row) => row.requirementId)).toEqual(["r3"]);
  });

  it("counts one shared word only for a short requirement", () => {
    const matrix = interviewGuideMatrix(
      [
        {
          id: "r1",
          text: "Experience with ledger reconciliation and audit trails",
          priority: "high",
        },
      ],
      facts,
    );
    expect(matrix.gaps).toHaveLength(1);
  });

  it("never cites a fact it was not given", () => {
    expect(interviewGuideMatrix(requirements, []).gaps).toHaveLength(3);
  });
});

describe("never say", () => {
  it("lists never-said facts, then the candidate's own entries, without repeats", () => {
    expect(
      interviewGuideNeverSay(
        [fact("f9", "departure", "Left after a dispute with the founders", "experience")],
        ["The settlement amount", " the settlement amount ", ""],
      ),
    ).toEqual([
      { text: "experience departure: Left after a dispute with the founders", source: "fact" },
      { text: "The settlement amount", source: "own" },
    ]);
  });

  it("flags a sentence that holds most of an entry's telling words", () => {
    const entries = [
      { text: "Left after a dispute with the founders" },
      { text: "Settlement amount" },
    ];
    expect(touchesNeverSay("I left after a long dispute with both founders.", entries)).toBe(true);
    expect(touchesNeverSay("The settlement amount was fair.", entries)).toBe(true);
    expect(touchesNeverSay("I left to join a larger team.", entries)).toBe(false);
    expect(touchesNeverSay("Anything at all.", [{ text: "the and" }])).toBe(false);
  });
});

describe("guide facts", () => {
  it("keeps interview facts, sets never-said ones apart and drops the rest", () => {
    const record = [
      fact("a1", "achievement", "Shipped a fictional ledger", "achievement"),
      fact("a2", "achievement", "A fictional dispute", "achievement"),
      fact("s1", "skill", "Kubernetes", "skill"),
      fact("c1", "email", "someone@example.org", "contact"),
      fact("p1", "project", "A withheld project", "project"),
    ];
    const split = interviewGuideFacts(record, {
      usage: {
        schemaVersion: 1,
        sections: { skill: "interview-only" },
        facts: {
          [factUsageKey({
            category: "achievement",
            field: "achievement",
            value: "A fictional dispute",
          })]: "never-say",
        },
      },
      mayTransmit: (entry) => entry.id !== "p1",
    });
    expect(split.allowed.map((entry) => entry.id)).toEqual(["a1", "s1"]);
    expect(split.neverSaid.map((entry) => entry.id)).toEqual(["a2"]);
  });
});
