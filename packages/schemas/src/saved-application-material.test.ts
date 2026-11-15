import { describe, expect, it } from "vitest";

import {
  maximumSavedApplicationMaterialItems,
  maximumSavedInterviewGuideItems,
  savedApplicationMaterialSchema,
} from "./saved-application-material.js";

// Invented content only.
const base = {
  id: "amd_fixture0001",
  workspace_id: "owner",
  application_id: "application-1",
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
  prompt_version: "interview-guide-v1",
  cost_usd: 0.1,
  created_at: "2026-11-10T09:00:00.000Z",
};
const details = { stage: "screen", depth: "essential" };
const item = (extra: Record<string, unknown> = {}) => ({
  question: "",
  text: "Fictional text.",
  citations: [],
  ...extra,
});

describe("saved interview guides", () => {
  it("keeps sectioned items with a question's trap", () => {
    const parsed = savedApplicationMaterialSchema.parse({
      ...base,
      kind: "interview-guide",
      interview_details: details,
      items: [
        item({ section: "read-first" }),
        item({ section: "questions", question: "Why this role?", trap: "Reciting the post." }),
      ],
    });
    expect(parsed.items.map((entry) => entry.section)).toEqual(["read-first", "questions"]);
  });

  it("holds a long guide but keeps the other kinds short", () => {
    const many = (count: number, extra: Record<string, unknown> = {}) =>
      Array.from({ length: count }, () => item(extra));
    expect(
      savedApplicationMaterialSchema.safeParse({
        ...base,
        kind: "interview-guide",
        interview_details: details,
        items: many(maximumSavedInterviewGuideItems, { section: "stories" }),
      }).success,
    ).toBe(true);
    expect(
      savedApplicationMaterialSchema.safeParse({
        ...base,
        kind: "interview-questions",
        items: many(maximumSavedApplicationMaterialItems + 1),
      }).success,
    ).toBe(false);
  });

  it("refuses a guide item without a section and a section or trap elsewhere", () => {
    const refused = (kind: string, items: unknown[], extra: Record<string, unknown> = {}) =>
      savedApplicationMaterialSchema.safeParse({ ...base, kind, items, ...extra }).success;
    expect(refused("interview-guide", [item()], { interview_details: details })).toBe(false);
    expect(refused("interview-guide", [item({ section: "pitch" })])).toBe(false);
    expect(refused("cover-letter", [item()], { interview_details: details })).toBe(false);
    expect(refused("cover-letter", [item({ section: "pitch" })])).toBe(false);
    expect(refused("interview-questions", [item({ question: "Why?", trap: "None." })])).toBe(false);
  });
});
