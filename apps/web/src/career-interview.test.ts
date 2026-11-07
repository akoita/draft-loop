import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import {
  allowInterviewProviders,
  careerInterviewProblem,
  careerInterviewRefused,
  careerInterviewSessionView,
  interviewLanguage,
  withInterviewLanguage,
} from "./career-interview.js";

function consentClient(current: unknown) {
  const posted: unknown[] = [];
  const client: ApiClient = {
    call: async (operation, input) => {
      if (operation === "GET /v1/workspaces/{workspaceId}/consents") {
        return { current: { "provider-transmission": current } } as never;
      }
      if (operation === "POST /v1/workspaces/{workspaceId}/consents") {
        posted.push((input as unknown as { body: unknown }).body);
        return {} as never;
      }
      throw new Error(`unexpected call: ${operation}`);
    },
  };
  return { client, posted };
}

describe("the web career interview", () => {
  it("explains a refusal for missing consent and falls back to the API's words", () => {
    expect(
      careerInterviewProblem(new ApiRequestError(403, "consent_required", "Consent needed.")),
    ).toContain("your answers go to Anthropic");
    expect(careerInterviewProblem(new ApiRequestError(429, "rate_limited", "Slow down."))).toBe(
      "Slow down.",
    );
    expect(careerInterviewProblem(new TypeError("fetch failed"))).toContain("could not be reached");
    expect(
      careerInterviewRefused(new ApiRequestError(403, "consent_required", "Consent needed.")),
    ).toEqual({ code: "consent_required", message: "Consent needed." });
  });

  it("grants the interviewer's providers with or without an earlier grant, keeping the others", async () => {
    const fresh = consentClient(undefined);
    expect(
      await allowInterviewProviders(fresh.client, "owner", ["anthropic"], "Career interview"),
    ).toBe(undefined);
    expect(fresh.posted).toEqual([
      {
        kind: "provider-transmission",
        action: "granted",
        basis: "candidate-consent",
        providers: ["anthropic"],
        note: "Career interview",
      },
    ]);
    const earlier = consentClient({ action: "granted", providers: ["openai"] });
    await allowInterviewProviders(earlier.client, "owner", ["anthropic", "google"], "Live voice");
    expect(earlier.posted).toMatchObject([{ providers: ["anthropic", "google", "openai"] }]);
    const withdrawn = consentClient({ action: "withdrawn", providers: ["openai"] });
    await allowInterviewProviders(withdrawn.client, "owner", ["anthropic"], "Career interview");
    expect(withdrawn.posted).toMatchObject([{ providers: ["anthropic"] }]);
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

describe("interview language", () => {
  it("follows the screen's locale, French or English", () => {
    expect(interviewLanguage("fr")).toBe("fr");
    expect(interviewLanguage("en")).toBe("en");
    expect(interviewLanguage("pseudo")).toBe("en");
  });

  it("adds it only to the actions that call the interviewer", () => {
    expect(withInterviewLanguage({ action: "accept", topic_key: "k" }, "fr")).toEqual({
      action: "accept",
      topic_key: "k",
      language: "fr",
    });
    expect(withInterviewLanguage({ action: "answer", topic_key: "k", text: "Oui" }, "fr")).toEqual({
      action: "answer",
      topic_key: "k",
      text: "Oui",
      language: "fr",
    });
    expect(withInterviewLanguage({ action: "pause" }, "fr")).toEqual({ action: "pause" });
  });
});
