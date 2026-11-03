import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api-client.js";
import { workJournalProblem } from "./work-journal.js";

describe("the web work journal", () => {
  it("explains a quarantined note's refused approval", () => {
    expect(
      workJournalProblem(
        new ApiRequestError(409, "note_quarantined", "Screening holds this note."),
      ),
    ).toBe("Screening holds this note. Edit it or discard it; it cannot be approved.");
  });

  it("falls back to the API's message, and to a connection hint", () => {
    expect(workJournalProblem(new ApiRequestError(429, "rate_limited", "Too many notes."))).toBe(
      "Too many notes.",
    );
    expect(workJournalProblem(new TypeError("fetch failed"))).toContain("could not be reached");
  });
});
