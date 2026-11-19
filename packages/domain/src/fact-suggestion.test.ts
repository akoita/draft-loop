import { describe, expect, it } from "vitest";

import type { CanonicalCandidateProfileFact } from "./canonical-candidate-profile.js";
import {
  canMoveFactSuggestion,
  type FactSuggestionChange,
  factSuggestionDedupeKey,
  factSuggestionDedupeKeyPattern,
  factSuggestionStatuses,
  factSuggestionTarget,
  findFactSuggestionTarget,
  isFactSuggestionStale,
  isTargetedFactSuggestionKind,
} from "./fact-suggestion.js";

// Fictional facts only.
const teamSize: CanonicalCandidateProfileFact = {
  id: "fact-1",
  category: "achievement",
  field: "team size",
  value: "Led a team of 5",
  provenance: [],
};
const skill: CanonicalCandidateProfileFact = {
  id: "fact-2",
  category: "skill",
  field: "language",
  value: "TypeScript",
  provenance: [],
};

describe("fact suggestion dedupe key", () => {
  it("matches its pattern and holds no fact text", () => {
    const key = factSuggestionDedupeKey(
      { kind: "correct", value: "Led a team of 8" },
      factSuggestionTarget(teamSize),
    );
    expect(key).toMatch(factSuggestionDedupeKeyPattern);
    expect(key).not.toContain("team");
  });

  it("ignores case, spacing and the fact id, so a re-derived fact gets the same key", () => {
    const change: FactSuggestionChange = { kind: "correct", value: "Led a team of 8" };
    const first = factSuggestionDedupeKey(change, factSuggestionTarget(teamSize));
    const rederived = factSuggestionTarget({ ...teamSize, id: "fact-99" });
    expect(
      factSuggestionDedupeKey({ kind: "correct", value: "  led a TEAM of 8 " }, rederived),
    ).toBe(first);
  });

  it("differs by kind, target and proposed content", () => {
    const target = factSuggestionTarget(teamSize);
    const keys = new Set([
      factSuggestionDedupeKey({ kind: "correct", value: "Led a team of 8" }, target),
      factSuggestionDedupeKey({ kind: "correct", value: "Led a team of 9" }, target),
      factSuggestionDedupeKey({ kind: "retire" }, target),
      factSuggestionDedupeKey({ kind: "confirm" }, target),
      factSuggestionDedupeKey({ kind: "set-usage", usage: "interview-only" }, target),
      factSuggestionDedupeKey({ kind: "set-usage", usage: "never-say" }, target),
      factSuggestionDedupeKey({ kind: "retire" }, factSuggestionTarget(skill)),
      factSuggestionDedupeKey({ kind: "add", category: "skill", field: "language", value: "Go" }),
    ]);
    expect(keys.size).toBe(8);
  });
});

describe("fact suggestion kinds and statuses", () => {
  it("targets an existing fact for every kind but add", () => {
    expect(isTargetedFactSuggestionKind("add")).toBe(false);
    for (const kind of ["correct", "retire", "set-usage", "confirm"] as const) {
      expect(isTargetedFactSuggestionKind(kind)).toBe(true);
    }
  });

  it("moves only from pending, and never back to pending", () => {
    expect(canMoveFactSuggestion("pending", "accepted")).toBe(true);
    expect(canMoveFactSuggestion("pending", "edited")).toBe(true);
    expect(canMoveFactSuggestion("pending", "rejected")).toBe(true);
    expect(canMoveFactSuggestion("pending", "stale")).toBe(true);
    for (const from of factSuggestionStatuses.filter((status) => status !== "pending")) {
      for (const to of factSuggestionStatuses) expect(canMoveFactSuggestion(from, to)).toBe(false);
    }
  });
});

describe("stale detection", () => {
  const correction = {
    change: { kind: "correct", value: "Led a team of 8" } as const,
    target: factSuggestionTarget(teamSize),
  };

  it("keeps a suggestion whose target is unchanged, even under a new id", () => {
    expect(isFactSuggestionStale(correction, [teamSize, skill])).toBe(false);
    expect(isFactSuggestionStale(correction, [{ ...teamSize, id: "fact-7" }])).toBe(false);
  });

  it("marks it stale when the target's content changed or the fact is gone", () => {
    expect(isFactSuggestionStale(correction, [{ ...teamSize, value: "Led a team of 6" }])).toBe(
      true,
    );
    expect(isFactSuggestionStale(correction, [skill])).toBe(true);
    expect(isFactSuggestionStale({ change: { kind: "retire" } }, [teamSize])).toBe(true);
  });

  it("marks an add stale once the profile already holds that fact", () => {
    const add = {
      change: { kind: "add", category: "skill", field: "Language", value: "typescript" } as const,
    };
    expect(isFactSuggestionStale(add, [teamSize])).toBe(false);
    expect(isFactSuggestionStale(add, [teamSize, skill])).toBe(true);
  });

  it("finds the target by id, else by content when exactly one fact matches", () => {
    const target = factSuggestionTarget(teamSize);
    expect(findFactSuggestionTarget(target, [skill, teamSize])).toBe(teamSize);
    const moved = { ...teamSize, id: "fact-7" };
    expect(findFactSuggestionTarget(target, [moved])).toBe(moved);
    expect(findFactSuggestionTarget(target, [moved, { ...moved, id: "fact-8" }])).toBeUndefined();
    expect(findFactSuggestionTarget(target, [skill])).toBeUndefined();
  });
});
