import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api-client.js";
import {
  briefEdit,
  briefEditProblems,
  briefPatchBody,
  createBriefBody,
  isStaleVersion,
  jobTextProblem,
  latestBrief,
  newRequirement,
} from "./brief-model.js";
import { syntheticBrief } from "./test-fixtures.js";

describe("pasted job", () => {
  it("needs text and becomes one pasted job-posting source", () => {
    expect(jobTextProblem("  ")).toBe("Paste the job post first.");
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

  it("opens the application's newest brief", () => {
    expect(
      latestBrief({
        id: "app-1",
        name: "Default",
        nameChosen: false,
        status: "active",
        isDefault: true,
        archivedAt: null,
        createdAt: "2026-10-23T00:00:00.000Z",
        updatedAt: "2026-10-23T00:00:00.000Z",
        briefs: [
          {
            briefId: "old",
            latestVersion: 3,
            status: "reviewed",
            createdAt: "2026-10-22T00:00:00Z",
          },
          { briefId: "new", latestVersion: 1, status: "draft", createdAt: "2026-10-23T00:00:00Z" },
        ],
        runs: [],
        chosenRunId: null,
      })?.briefId,
    ).toBe("new");
  });
});

describe("brief edits", () => {
  it("patches the edited fields against the version the owner saw", () => {
    const edit = briefEdit(syntheticBrief);
    const added = newRequirement(syntheticBrief, edit.requirements);

    expect(
      briefPatchBody(syntheticBrief, {
        role: "Senior Platform Engineer",
        employer: "Example Ledger",
        requirements: [...edit.requirements, { ...added, text: " Postgres " }],
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

  it("refuses empty requirements", () => {
    const edit = briefEdit(syntheticBrief);
    expect(briefEditProblems(edit)).toEqual([]);
    expect(
      briefEditProblems({ ...edit, requirements: [newRequirement(syntheticBrief, [])] }),
    ).toEqual(["Write each requirement, or remove the empty ones."]);
    expect(briefEditProblems({ ...edit, requirements: [] })).toEqual([
      "Keep at least one requirement.",
    ]);
  });

  it("recognizes a stale version", () => {
    expect(isStaleVersion(new ApiRequestError(409, "conflict", "Stale."))).toBe(true);
    expect(isStaleVersion(new ApiRequestError(404, "not_found", "Missing."))).toBe(false);
  });
});
