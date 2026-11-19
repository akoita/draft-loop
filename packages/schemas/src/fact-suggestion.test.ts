import { factSuggestionDedupeKey, factSuggestionTarget } from "@draft-loop/domain/fact-suggestion";
import { describe, expect, it } from "vitest";

import { factSuggestionSchema } from "./fact-suggestion.js";

// Fictional content only.
const target = factSuggestionTarget({
  id: "fact-1",
  category: "achievement",
  field: "team size",
  value: "Led a team of 5",
  provenance: [],
});
const change = { kind: "correct", value: "Led a team of 8" } as const;

const pending = {
  schemaVersion: 1,
  id: "fsg_abcdefgh12",
  profileId: "profile-1",
  baseVersionId: "version-3",
  change,
  target,
  quote: "I led a team of 8 engineers at the end.",
  speaker: "candidate",
  origin: { kind: "review-edit", applicationId: "app-1", runId: "run-1", round: 2, blockId: "b-4" },
  dedupeKey: factSuggestionDedupeKey(change, target),
  status: "pending",
  createdAt: "2026-11-19T21:00:00.000Z",
} as const;

const decision = { role: "candidate", memberId: "member-1", decidedAt: "2026-11-19T21:05:00Z" };

describe("fact suggestion schema", () => {
  it("accepts a pending correction and a decided one", () => {
    expect(factSuggestionSchema.parse(pending)).toEqual(pending);
    expect(
      factSuggestionSchema.safeParse({ ...pending, status: "accepted", decision }).success,
    ).toBe(true);
    expect(
      factSuggestionSchema.safeParse({
        ...pending,
        status: "edited",
        decision,
        appliedChange: { kind: "correct", value: "Led a team of 7" },
      }).success,
    ).toBe(true);
  });

  it("accepts an add without a target", () => {
    const add = { kind: "add", category: "skill", field: "language", value: "Go" } as const;
    const { target: _target, ...rest } = pending;
    expect(
      factSuggestionSchema.safeParse({
        ...rest,
        change: add,
        dedupeKey: factSuggestionDedupeKey(add),
        origin: { kind: "agent", agentClientId: "client-1" },
        speaker: "agent",
      }).success,
    ).toBe(true);
  });

  it("refuses a targeted kind without a target, and an add with one", () => {
    const { target: _target, ...untargeted } = pending;
    expect(factSuggestionSchema.safeParse(untargeted).success).toBe(false);
    const add = { kind: "add", category: "skill", field: "language", value: "Go" } as const;
    expect(
      factSuggestionSchema.safeParse({
        ...pending,
        change: add,
        dedupeKey: factSuggestionDedupeKey(add, target),
      }).success,
    ).toBe(false);
  });

  it("refuses a dedupe key that does not match the change", () => {
    expect(
      factSuggestionSchema.safeParse({
        ...pending,
        dedupeKey: factSuggestionDedupeKey({ kind: "retire" }, target),
      }).success,
    ).toBe(false);
  });

  it("keeps status, decision and applied change in step", () => {
    expect(factSuggestionSchema.safeParse({ ...pending, status: "rejected" }).success).toBe(false);
    expect(factSuggestionSchema.safeParse({ ...pending, decision }).success).toBe(false);
    expect(factSuggestionSchema.safeParse({ ...pending, status: "stale", decision }).success).toBe(
      false,
    );
    expect(factSuggestionSchema.safeParse({ ...pending, status: "edited", decision }).success).toBe(
      false,
    );
    expect(
      factSuggestionSchema.safeParse({
        ...pending,
        status: "edited",
        decision,
        appliedChange: { kind: "retire" },
      }).success,
    ).toBe(false);
  });

  it("bounds the quote and values and refuses control characters", () => {
    expect(factSuggestionSchema.safeParse({ ...pending, quote: "" }).success).toBe(false);
    expect(factSuggestionSchema.safeParse({ ...pending, quote: "x".repeat(1_001) }).success).toBe(
      false,
    );
    expect(factSuggestionSchema.safeParse({ ...pending, quote: "two\nlines" }).success).toBe(true);
    const long = { kind: "correct", value: "x".repeat(2_001) } as const;
    expect(
      factSuggestionSchema.safeParse({
        ...pending,
        change: long,
        dedupeKey: factSuggestionDedupeKey(long, target),
      }).success,
    ).toBe(false);
    const broken = { kind: "correct", value: "bad\u0007value" } as const;
    expect(
      factSuggestionSchema.safeParse({
        ...pending,
        change: broken,
        dedupeKey: factSuggestionDedupeKey(broken, target),
      }).success,
    ).toBe(false);
  });

  it("refuses an agent origin without its client and a decision by an agent", () => {
    expect(factSuggestionSchema.safeParse({ ...pending, origin: { kind: "agent" } }).success).toBe(
      false,
    );
    expect(
      factSuggestionSchema.safeParse({
        ...pending,
        status: "accepted",
        decision: { ...decision, role: "agent" },
      }).success,
    ).toBe(false);
  });

  it("refuses unknown fields and ids", () => {
    expect(factSuggestionSchema.safeParse({ ...pending, extra: true }).success).toBe(false);
    expect(factSuggestionSchema.safeParse({ ...pending, id: "wjn_abcdefgh12" }).success).toBe(
      false,
    );
  });
});
