import { describe, expect, it } from "vitest";

import { coverLetterKitNoteProblem, coverLetterKitSchema } from "./cover-letter-kit.js";
import { savedApplicationMaterialSchema } from "./saved-application-material.js";

// Invented content only.
const kit = {
  requirements: [
    {
      requirement_id: "req_1",
      text: "Strong SQL reporting",
      facts: [{ fact_id: "f3", text: "achievement outcome: Cut report time by 40%" }],
    },
  ],
  angles: [
    { note: "Lead with the 40% faster reports", fact_ids: ["f3"], finding_ids: [] },
    { note: "Open on their clinic growth", fact_ids: [], finding_ids: ["fnd_1"] },
  ],
  employer_facts: [
    { finding_id: "fnd_1", text: "Example Health opened clinics.", published_on: "2026-10-15" },
  ],
  outline: [1, 2, 3, 4].map((paragraph) => ({
    paragraph,
    purpose: `Paragraph ${paragraph}: say what it must do`,
    requirement_ids: paragraph === 2 ? ["req_1"] : [],
    fact_ids: paragraph === 2 ? ["f3"] : [],
    finding_ids: [],
  })),
  avoid: ["proven track record"],
};

describe("cover letter writing kit schema", () => {
  it("round-trips a kit and keeps it with its application", () => {
    expect(coverLetterKitSchema.parse(JSON.parse(JSON.stringify(kit)))).toEqual(kit);
    const saved = {
      id: "amd_fixture0001",
      workspace_id: "owner",
      application_id: "application-1",
      kind: "cover-letter-kit",
      items: [],
      kit,
      model: { provider: "anthropic", model: "claude-haiku-5-5" },
      prompt_version: "cover-letter-kit-v1",
      cost_usd: 0.01,
      created_at: "2026-11-10T09:00:00.000Z",
    };
    expect(savedApplicationMaterialSchema.parse(saved)).toEqual(saved);
    expect(savedApplicationMaterialSchema.safeParse({ ...saved, kit: undefined }).success).toBe(
      false,
    );
    expect(
      savedApplicationMaterialSchema.safeParse({
        ...saved,
        items: [{ question: "", text: "Fictional.", citations: [] }],
      }).success,
    ).toBe(false);
    expect(
      savedApplicationMaterialSchema.safeParse({ ...saved, kind: "cover-letter" }).success,
    ).toBe(false);
  });

  it("refuses a note citing a fact or finding the kit does not list, and paragraphs out of order", () => {
    const stray = { ...kit, angles: [kit.angles[0], { ...kit.angles[1], fact_ids: ["f9"] }] };
    expect(coverLetterKitSchema.safeParse(stray).success).toBe(false);
    const unknownFinding = {
      ...kit,
      outline: kit.outline.map((entry) => ({ ...entry, finding_ids: ["fnd_9"] })),
    };
    expect(coverLetterKitSchema.safeParse(unknownFinding).success).toBe(false);
    const reversed = { ...kit, outline: [...kit.outline].reverse() };
    expect(coverLetterKitSchema.safeParse(reversed).success).toBe(false);
    const undated = { ...kit, employer_facts: [{ finding_id: "fnd_1", text: "Opened clinics." }] };
    expect(coverLetterKitSchema.safeParse(undated).success).toBe(false);
  });

  it("refuses a note that reads as a sentence of the letter", () => {
    const prose = { ...kit, angles: [kit.angles[0], { ...kit.angles[1], note: "I love it." }] };
    expect(coverLetterKitSchema.safeParse(prose).success).toBe(false);
  });
});

describe("the no-sentence rule for kit notes", () => {
  it.each([
    "Lead with the 40% faster SQL reports",
    "Tie the dashboards to their clinicians, e.g. ward reports",
    "Name Node.js and the 2026 rebuild",
    "Ouvrir sur la refonte des rapports",
    "Their need: faster weekly reporting; your Northwind rebuild",
  ])("accepts the fragment %j", (note) => {
    expect(coverLetterKitNoteProblem(note)).toBeUndefined();
  });

  it.each([
    ["I cut report time by 40%", "speaks in the first person"],
    ["Mention my Northwind work", "speaks in the first person"],
    ["My reports were faster", "speaks in the first person"],
    ["J'ai réduit le temps des rapports", "speaks in the first person"],
    ["Mettre en avant mes rapports", "speaks in the first person"],
    ["Lead with the reports.", "ends a sentence"],
    ["Why clinics? Their growth", "ends a sentence"],
    [
      "Lead with the reporting rebuild that cut the weekly time and then name the dashboards too",
      "has more than 14 words",
    ],
    ["", "is empty"],
  ])("refuses %j", (note, problem) => {
    expect(coverLetterKitNoteProblem(note)).toBe(problem);
  });
});
