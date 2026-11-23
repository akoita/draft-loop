import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { webCoverLetterCheck } from "./cover-letter-check-bridge.js";
import { createHttpBridge } from "./http-bridge.js";

// An invented letter and answer.
const workspaceId = "owner";
const applicationId = "app_fixture0001";
const text = "I led a team of 40 analysts.";
const answer = {
  claims: {
    status: "checked",
    checked_sentences: 1,
    findings: [
      {
        paragraph: 0,
        sentence: text,
        about: "candidate",
        reason: "number_not_in_fact",
        numbers: ["40"],
        closest_fact: { fact_id: "f1", text: "role title: Data Analyst" },
      },
    ],
  },
  requirements: { source: "brief", total: 1, unanswered: [] },
  wording: [{ code: "word_count", match: "7" }],
  model: { provider: "anthropic", model: "claude-haiku-5-5" },
  prompt_version: "cover-letter-claims-v2",
  cost_usd: 0.002,
};
const view = {
  claims: {
    status: "checked",
    reason: null,
    checkedSentences: 1,
    findings: [
      {
        paragraph: 0,
        sentence: text,
        about: "candidate",
        reason: "number_not_in_fact",
        numbers: ["40"],
        closestFact: { factId: "f1", text: "role title: Data Analyst" },
      },
    ],
  },
  requirements: { source: "brief", total: 1, unanswered: [] },
  wording: [{ code: "word_count", paragraph: null, sentence: null, match: "7" }],
};

function client(calls: unknown[]): ApiClient {
  return {
    call: async (operation, input) => {
      calls.push({ operation, input });
      return answer as never;
    },
  };
}

describe("Check my letter over HTTP", () => {
  it("sends the letter once and answers in the shared screens' shape", async () => {
    const calls: unknown[] = [];
    const port = createCapabilityPort(createHttpBridge({ client: client(calls) }));
    expect(port.hasCapability("application.check-cover-letter")).toBe(true);

    const result = await port.execute({
      type: "application.check-cover-letter",
      input: { workspaceId, applicationId, text },
    });

    expect(result).toEqual({ ok: true, value: { workspaceId, applicationId, check: view } });
    expect(calls).toEqual([
      {
        operation:
          "POST /v1/workspaces/{workspaceId}/applications/{applicationId}/cover-letter-check",
        input: { path: { workspaceId, applicationId }, body: { text } },
      },
    ]);
  });

  it("refuses an empty letter before calling the server", async () => {
    const calls: unknown[] = [];
    const port = createCapabilityPort(createHttpBridge({ client: client(calls) }));
    const result = await port.execute({
      type: "application.check-cover-letter",
      input: { workspaceId, applicationId, text: "  " },
    });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("binds the check to one application for a web screen", async () => {
    const calls: unknown[] = [];
    expect(await webCoverLetterCheck(client(calls), workspaceId, applicationId)(text)).toEqual(
      view,
    );
  });
});
