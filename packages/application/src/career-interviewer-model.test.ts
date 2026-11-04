import type { ModelSelection } from "@draft-loop/domain";
import { nextCareerInterviewTurn } from "@draft-loop/orchestrator";
import type { JsonValue, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import type { CareerInterviewFact } from "./career-interview-topics.js";
import {
  careerInterviewDefaultModelId,
  careerInterviewPromptVersion,
  careerInterviewTopicContext,
  createModelCareerInterviewer,
} from "./career-interviewer-model.js";

// An invented record.
const facts: CareerInterviewFact[] = [
  { id: "f1", category: "role", subjectId: "job", field: "title", value: "Analyst" },
  { id: "f2", category: "employer", subjectId: "job", field: "name", value: "Example Bank" },
  { id: "f3", category: "role", subjectId: "job", field: "summary", value: "Private health note" },
];
const topic = {
  kind: "role-gap",
  reason: "Your record names Analyst at Example Bank but not what changed thanks to your work.",
  factIds: ["f1", "f2", "f3", "missing"],
} as const;

const model: ModelSelection = {
  company: "anthropic",
  modelId: careerInterviewDefaultModelId,
  role: "author",
  promptTemplateVersion: careerInterviewPromptVersion,
};
const dataPolicy = {
  allowTransmission: true,
  allowedCompanies: ["anthropic"],
  sensitiveData: true,
  sensitiveDataAcknowledged: true,
} as const;

function executor(outputs: readonly JsonValue[]) {
  const requests: ModelRequest<JsonValue>[] = [];
  return {
    requests,
    execute: async (request: ModelRequest<JsonValue>): Promise<ModelResponse<JsonValue>> => {
      requests.push(request);
      return {
        output: outputs[requests.length - 1] ?? { text: "", summary: "" },
        contextSnapshotId: request.contextSnapshotId,
        provider: "anthropic",
        company: "anthropic",
        route: "anthropic-api",
        modelId: careerInterviewDefaultModelId,
        providerRequestId: null,
        structuredOutputSha256: "0".repeat(64),
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        cost: { estimatedUsd: 0 },
      };
    },
  };
}

describe("careerInterviewTopicContext", () => {
  it("sends only the facts the topic read that the host's rules let through", () => {
    const context = careerInterviewTopicContext(topic, facts, (fact) => fact.id !== "f3");
    expect(context).toEqual({
      kind: "role-gap",
      reason: topic.reason,
      context: ["role title: Analyst", "employer name: Example Bank"],
    });
  });
});

describe("createModelCareerInterviewer", () => {
  it("phrases a turn through the executor with the method and the bounded topic only", async () => {
    const fake = executor([{ text: "What did a typical week look like?", summary: "" }]);
    const port = createModelCareerInterviewer({
      executor: fake,
      model,
      dataPolicy,
      sessionId: "cis_fixture0001",
    });
    const conversationTopic = careerInterviewTopicContext(topic, facts, (fact) => fact.id !== "f3");
    const next = await nextCareerInterviewTurn(port, {
      topic: conversationTopic,
      turns: [{ role: "candidate", text: "", mark: "unknown" }],
    });
    expect(next).toEqual({
      text: "What did a typical week look like?",
      fallback: false,
      refusals: [],
      model: { provider: "anthropic", model: careerInterviewDefaultModelId },
    });
    const request = fake.requests[0];
    expect(request?.contextSnapshotId).toBe("cis_fixture0001");
    expect(request?.systemPrompt).toContain("professional career consultant");
    expect(JSON.stringify(request?.input)).not.toContain("Private health note");
    expect(request?.input).toMatchObject({
      conversation: [{ role: "candidate", text: "(I don't remember)" }],
      closing: false,
      refused_rules: [],
    });
  });

  it("returns the summary when the model closes the topic", async () => {
    const fake = executor([{ text: "Is this right?", summary: " You analysed loan data. " }]);
    const port = createModelCareerInterviewer({
      executor: fake,
      model,
      dataPolicy,
      sessionId: "cis_fixture0002",
    });
    const reply = await port.reply({
      instructions: [],
      topic: { kind: "role-gap", reason: "r", context: [] },
      targetThemes: [],
      turns: [],
      closing: true,
      refusedRules: [],
    });
    expect(reply.summary).toBe("You analysed loan data.");
  });
});
