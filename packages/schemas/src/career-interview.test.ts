import { describe, expect, it } from "vitest";

import { careerInterviewSessionSchema } from "./career-interview.js";

const base = {
  id: "cis_fixture0001",
  workspace_id: "owner",
  status: "open",
  created_at: "2026-11-05T09:00:00.000Z",
  updated_at: "2026-11-05T09:00:00.000Z",
} as const;

const topic = {
  key: "role-gap:job-1:abcd1234",
  kind: "role-gap",
  reason: "Your record names Analyst but not when it happened.",
  status: "proposed",
} as const;

describe("careerInterviewSessionSchema", () => {
  it("round-trips a session with defaults filled", () => {
    const parsed = careerInterviewSessionSchema.parse({ ...base, topics: [topic] });
    expect(parsed.topics[0]).toEqual({ ...topic, fact_ids: [], requirement_ids: [], turns: [] });
    expect(careerInterviewSessionSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("accepts a skip or an unknown mark from the candidate only", () => {
    const turn = { role: "candidate", text: "", mark: "unknown", at: base.created_at };
    expect(
      careerInterviewSessionSchema.safeParse({ ...base, topics: [{ ...topic, turns: [turn] }] })
        .success,
    ).toBe(true);
    expect(
      careerInterviewSessionSchema.safeParse({
        ...base,
        topics: [{ ...topic, turns: [{ ...turn, role: "interviewer" }] }],
      }).success,
    ).toBe(false);
    expect(
      careerInterviewSessionSchema.safeParse({
        ...base,
        topics: [{ ...topic, turns: [{ role: "candidate", text: " ", at: base.created_at }] }],
      }).success,
    ).toBe(false);
  });

  it("refuses a repeated topic, an unknown field and an update before creation", () => {
    expect(
      careerInterviewSessionSchema.safeParse({ ...base, topics: [topic, topic] }).success,
    ).toBe(false);
    expect(careerInterviewSessionSchema.safeParse({ ...base, extra: true }).success).toBe(false);
    expect(
      careerInterviewSessionSchema.safeParse({ ...base, updated_at: "2026-11-04T00:00:00.000Z" })
        .success,
    ).toBe(false);
  });
});
