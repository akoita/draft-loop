import { describe, expect, it } from "vitest";

import type { CanonicalCandidateProfileFact } from "./canonical-candidate-profile.js";
import { editedFactChanges } from "./fact-suggestion-edit.js";

function fact(
  id: string,
  category: CanonicalCandidateProfileFact["category"],
  field: string,
  value: string,
) {
  return { id, category, field, value, provenance: [] } as unknown as CanonicalCandidateProfileFact;
}

const team = fact("f-team", "achievement", "summary", "Led a team of 5 engineers at Example Corp");
const start = fact("f-start", "date", "start", "Joined Example Corp in March 2021");
const title = fact("f-title", "role", "title", "Senior Platform Engineer at Example Corp");
const employer = fact("f-employer", "employer", "name", "Example Corp");
const facts = [team, start, title, employer];

function changes(draftedText: string, editedText: string, from = facts) {
  return editedFactChanges({ draftedText, editedText, facts: from });
}

describe("facts an approval edit changes", () => {
  it("finds a changed number and rewrites the fact", () => {
    const [change, ...rest] = changes(
      "Led a team of 5 engineers to rebuild billing. Cut costs by a third.",
      "Led a team of 8 engineers to rebuild billing. Cut costs by a third.",
    );
    expect(rest).toEqual([]);
    expect(change).toMatchObject({
      fact: team,
      before: "5",
      after: "8",
      value: "Led a team of 8 engineers at Example Corp",
      quote: "Led a team of 8 engineers to rebuild billing.",
    });
  });

  it("finds a changed date", () => {
    const [change] = changes(
      "Joined Example Corp in March 2021 to start the platform team.",
      "Joined Example Corp in May 2021 to start the platform team.",
    );
    expect(change?.fact).toBe(start);
    expect(change?.value).toBe("Joined Example Corp in May 2021");
  });

  it("finds a changed title", () => {
    const [change] = changes(
      "Promoted to Senior Platform Engineer after two years.",
      "Promoted to Staff Platform Engineer after two years.",
    );
    expect(change?.fact).toBe(title);
    expect(change?.value).toBe("Staff Platform Engineer at Example Corp");
  });

  it("finds a changed name and picks the fact closest to the block", () => {
    const [change] = changes(
      "Built the billing platform at Example Corp.",
      "Built the billing platform at Sample Ltd.",
      [employer, fact("f-other", "employer", "name", "Example Corp Labs")],
    );
    expect(change?.fact).toBe(employer);
    expect(change?.value).toBe("Sample Ltd");
  });

  it("suggests nothing for a reworded edit with no factual change", () => {
    expect(
      changes(
        "Led a team of 5 engineers to rebuild billing.",
        "Led a team of 5 engineers that rebuilt the billing system.",
      ),
    ).toEqual([]);
    expect(changes("Led a team of 5 engineers.", "led a team of 5 engineers")).toEqual([]);
    expect(changes("Led a team of 5 engineers.", "Managed a team of 5 engineers.")).toEqual([]);
  });

  it("suggests nothing when no fact or several equal facts hold the old words", () => {
    expect(changes("Shipped 12 releases.", "Shipped 14 releases.")).toEqual([]);
    expect(
      changes("Mentored 3 interns.", "Mentored 4 interns.", [
        fact("a", "achievement", "summary", "Mentored 3 interns in 2022"),
        fact("b", "achievement", "summary", "Mentored 3 interns in 2023"),
      ]),
    ).toEqual([]);
  });
});
