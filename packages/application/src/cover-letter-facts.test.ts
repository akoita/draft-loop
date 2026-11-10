import { describe, expect, it } from "vitest";

import type {
  ApplicationMaterialFact,
  ApplicationMaterialRequirement,
} from "./application-material.js";
import { pickCoverLetterFacts } from "./cover-letter-facts.js";

// An invented record: one long role, one short role, and many loose notes.
const role = (id: string, subjectId: string, value: string): ApplicationMaterialFact => ({
  id,
  category: "achievement",
  field: "outcome",
  value,
  subjectId,
});
const note = (id: string, value: string): ApplicationMaterialFact => ({
  id,
  category: "achievement",
  field: "achievement",
  value,
});

const requirements: ApplicationMaterialRequirement[] = [
  { id: "q1", text: "Design DvP settlement on permissioned ledgers", priority: "critical" },
  { id: "q2", text: "Threat modelling for market infrastructure", priority: "high" },
  { id: "q3", text: "Kafka streaming", priority: "low" },
];

describe("pickCoverLetterFacts", () => {
  it("keeps the best matches, roles before loose notes of the same score", () => {
    const picked = pickCoverLetterFacts(
      [
        note("n1", "Fixed a flaky test"),
        note("n2", "Wrote a threat model for a side project"),
        role("r1", "bank", "Wrote a threat model for the clearing platform"),
        role("r2", "bank", "Designed DvP settlement on a permissioned ledger"),
      ],
      requirements,
    );
    expect(picked.map((fact) => fact.id)).toEqual(["r2", "r1", "n2", "n1"]);
    expect(picked[0]).toMatchObject({
      group: "bank",
      brief: "achievement outcome: Designed DvP settlement on a permissioned ledger",
    });
    expect(picked[2]).toEqual({
      id: "n2",
      brief: "achievement: Wrote a threat model for a side project",
      score: expect.any(Number),
    });
  });

  it("caps one role at four places and the list at twelve", () => {
    const long = Array.from({ length: 10 }, (_, i) =>
      role(`a${i}`, "long", `DvP settlement design ${i}`),
    );
    const others = Array.from({ length: 12 }, (_, i) => note(`k${i}`, `Kafka streaming job ${i}`));
    const picked = pickCoverLetterFacts([...long, ...others], requirements);
    expect(picked).toHaveLength(12);
    expect(picked.filter((fact) => fact.group === "long")).toHaveLength(4);
  });

  it("fills up to eight with unmatched facts, roles first, and never past that", () => {
    const facts = [
      note("n1", "Plays chess"),
      role("r1", "shop", "Ran the shop's till"),
      role("r2", "shop", "Opened on Sundays"),
      note("n2", "Kafka streaming"),
      ...Array.from({ length: 8 }, (_, i) => note(`z${i}`, `Unrelated note ${i}`)),
    ];
    const picked = pickCoverLetterFacts(facts, requirements);
    expect(picked).toHaveLength(8);
    expect(picked.slice(0, 3).map((fact) => fact.id)).toEqual(["n2", "r1", "r2"]);
  });

  it("returns what there is when the record is small", () => {
    expect(pickCoverLetterFacts([note("n1", "Plays chess")], requirements)).toHaveLength(1);
  });
});
