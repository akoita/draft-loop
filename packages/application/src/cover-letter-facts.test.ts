import { describe, expect, it } from "vitest";

import type {
  ApplicationMaterialFact,
  ApplicationMaterialRequirement,
} from "./application-material.js";
import { keepCareerFrame } from "./career-frame-facts.js";
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

  // A career role: a group with a title, an employer and dates.
  const frame = (subjectId: string): ApplicationMaterialFact[] => [
    { id: `${subjectId}-title`, category: "role", field: "title", value: "Architect", subjectId },
    {
      id: `${subjectId}-employer`,
      category: "employer",
      field: "name",
      value: "Example Bank",
      subjectId,
    },
    {
      id: `${subjectId}-dates`,
      category: "date",
      field: "dates",
      value: "2018 to 2023",
      subjectId,
    },
  ];

  it("gives three places to career roles and adds their title, employer and dates", () => {
    const notes = Array.from({ length: 14 }, (_, i) =>
      note(`k${i}`, `Threat modelling for a ledger side project ${i}`),
    );
    const career = [
      ...frame("bank"),
      role("b1", "bank", "Ran the settlement desk migration"),
      role("b2", "bank", "Led eight engineers"),
      ...frame("shop"),
      role("s1", "shop", "Rebuilt the order system"),
      role("s2", "shop", "Cut hosting costs"),
    ];
    const picked = pickCoverLetterFacts([...notes, ...career], requirements);
    const ids = picked.map((fact) => fact.id);
    // Nine loose notes keep their places; three career facts take the lowest-ranked three.
    expect(ids.slice(0, 12)).toEqual([
      ...notes.slice(0, 9).map((fact) => fact.id),
      "b1",
      "b2",
      "s1",
    ]);
    expect(ids.slice(12)).toEqual([
      "bank-title",
      "bank-employer",
      "bank-dates",
      "shop-title",
      "shop-employer",
      "shop-dates",
    ]);
  });

  it("adds no framing fact for a role nothing was picked from", () => {
    const picked = pickCoverLetterFacts(
      [...frame("bank"), ...Array.from({ length: 12 }, (_, i) => note(`k${i}`, `Kafka ${i}`))],
      requirements,
      { minimum: 8, maximum: 12, perGroup: 4, career: 0, frame: 6 },
    );
    expect(picked.map((fact) => fact.id).some((id) => id.startsWith("bank"))).toBe(false);
  });

  it("keeps a leading role's title, employer and dates when a large record is cut", () => {
    const ranked = [
      role("b1", "bank", "Designed DvP settlement"),
      ...Array.from({ length: 30 }, (_, i) => note(`k${i}`, `Note ${i}`)),
      ...frame("bank"),
      ...frame("shop"),
    ];
    const kept = keepCareerFrame(ranked, 25).map((fact) => fact.id);
    expect(kept).toHaveLength(25);
    expect(kept.slice(0, 22)).toEqual(ranked.slice(0, 22).map((fact) => fact.id));
    expect(kept.slice(22)).toEqual(["bank-title", "bank-employer", "bank-dates"]);
  });

  it("returns what there is when the record is small", () => {
    expect(pickCoverLetterFacts([note("n1", "Plays chess")], requirements)).toHaveLength(1);
  });
});
