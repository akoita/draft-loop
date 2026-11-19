import type { CanonicalCandidateProfile } from "@draft-loop/domain";
import { createMemoryFactSuggestionStore } from "@draft-loop/storage/fact-suggestions";
import { describe, expect, it } from "vitest";

import { fileReviewEditSuggestions, reviewEditSuggestions } from "./review-edit-suggestions.js";

const profile = {
  id: "profile-1",
  version: 3,
  facts: [
    {
      id: "fact-team",
      category: "achievement",
      field: "summary",
      value: "Led a team of 5 engineers at Example Corp",
      provenance: [],
    },
  ],
} as unknown as CanonicalCandidateProfile;

let counter = 0;
const input = (draftedText: string, editedText: string) => ({
  blocks: [{ blockId: "block-1", draftedText, editedText }],
  profile,
  runId: "run-1",
  round: 2,
  createdAt: "2026-11-19T22:00:00.000Z",
  generateId: () => {
    counter += 1;
    return `fsg_test${String(counter).padStart(8, "0")}`;
  },
});

describe("profile suggestions from approval edits", () => {
  it("files a correct suggestion quoting the edited sentence", async () => {
    const [suggestion, ...rest] = reviewEditSuggestions(
      input("Led a team of 5 engineers on billing.", "Led a team of 8 engineers on billing."),
    );
    expect(rest).toEqual([]);
    expect(suggestion).toMatchObject({
      profileId: "profile-1",
      baseVersionId: "version-3",
      change: { kind: "correct", value: "Led a team of 8 engineers at Example Corp" },
      target: { factId: "fact-team" },
      quote: "Led a team of 8 engineers on billing.",
      speaker: "candidate",
      origin: { kind: "review-edit", runId: "run-1", blockId: "block-1", round: 2 },
      status: "pending",
    });
  });

  it("files nothing for a reworded edit", () => {
    expect(
      reviewEditSuggestions(
        input("Led a team of 5 engineers on billing.", "Led a 5-person team on billing work."),
      ),
    ).toEqual([]);
    expect(
      reviewEditSuggestions(
        input("Led a team of 5 engineers on billing.", "Led a team of 5 engineers on payments."),
      ),
    ).toEqual([]);
  });

  it("never offers the same change twice when a run is approved again", async () => {
    const store = createMemoryFactSuggestionStore();
    const edit = () =>
      reviewEditSuggestions(
        input("Led a team of 5 engineers on billing.", "Led a team of 8 engineers on billing."),
      );
    expect(await fileReviewEditSuggestions(store, "owner", edit())).toBe(1);
    expect(await fileReviewEditSuggestions(store, "owner", edit())).toBe(0);
    expect(await store.countPending("owner", "profile-1")).toBe(1);
  });
});
