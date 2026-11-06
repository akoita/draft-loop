import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api-client.js";
import { careerInterviewProblem, careerInterviewSessionView } from "./career-interview.js";

describe("the web career interview", () => {
  it("explains a refusal for missing consent and falls back to the API's words", () => {
    expect(
      careerInterviewProblem(new ApiRequestError(403, "consent_required", "Consent needed.")),
    ).toContain("permission to send career material");
    expect(careerInterviewProblem(new ApiRequestError(429, "rate_limited", "Slow down."))).toBe(
      "Slow down.",
    );
    expect(careerInterviewProblem(new TypeError("fetch failed"))).toContain("could not be reached");
  });

  it("keeps only what the panel reads from the API's session", () => {
    // An invented topic only.
    const view = careerInterviewSessionView(
      {
        id: "cis_fixture0001",
        workspace_id: "owner",
        status: "open",
        topics: [
          {
            key: "untold-theme:mentoring",
            kind: "untold-theme",
            reason: "You mention mentoring but no example of it.",
            status: "open",
            fact_ids: ["f1"],
            requirement_ids: [],
            turns: [
              { role: "interviewer", text: "Who did you mentor?", at: "2026-11-05T08:00:00Z" },
            ],
          },
        ],
        created_at: "2026-11-05T08:00:00Z",
        updated_at: "2026-11-05T08:00:00Z",
      },
      false,
    );
    expect(view.interviewerAvailable).toBe(false);
    expect(view.topics[0]?.turns).toEqual([
      { role: "interviewer", text: "Who did you mentor?", mark: undefined },
    ]);
    expect(view).not.toHaveProperty("workspace_id");
  });
});
