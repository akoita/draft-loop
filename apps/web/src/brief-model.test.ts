import { describe, expect, it } from "vitest";

import { briefEdit, briefPatchBody, createBriefBody } from "./brief-model.js";
import { syntheticBrief } from "./test-fixtures.js";

describe("pasted job", () => {
  it("becomes one pasted job-posting source", () => {
    expect(
      createBriefBody(" Platform Engineer\n- TypeScript ", new Date("2026-10-23T01:00:00Z")),
    ).toEqual({
      sources: [
        {
          id: "job-posting",
          kind: "pasted-content",
          classification: "job-posting",
          capturedAt: "2026-10-23T01:00:00.000Z",
          content: "Platform Engineer\n- TypeScript",
        },
      ],
    });
  });
});

describe("brief edits", () => {
  it("patches the edited fields against the version the owner saw", () => {
    const edit = briefEdit(syntheticBrief);

    expect(
      briefPatchBody(syntheticBrief, {
        role: "Senior Platform Engineer",
        employer: "Example Ledger",
        requirements: [
          ...edit.requirements,
          { id: "owner-2", text: " Postgres ", priority: "medium", sourceIds: ["job-posting"] },
        ],
      }),
    ).toEqual({
      expectedVersion: 2,
      patch: {
        role: { value: "Senior Platform Engineer", sourceIds: ["job-posting"] },
        employer: { value: "Example Ledger", sourceIds: ["job-posting"] },
        requirements: [
          syntheticBrief.requirements[0],
          { id: "owner-2", text: "Postgres", priority: "medium", sourceIds: ["job-posting"] },
        ],
      },
    });
  });

  it("clears a field the owner empties", () => {
    expect(
      briefPatchBody(syntheticBrief, { ...briefEdit(syntheticBrief), employer: " " }).patch
        .employer,
    ).toBeNull();
  });
});
