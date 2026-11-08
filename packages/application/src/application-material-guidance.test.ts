import type { JsonValue, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import {
  type ApplicationMaterialFact,
  applicationMaterialContext,
  applicationMaterialViolations,
  boundedApplicationMaterialGuidance,
  draftApplicationMaterial,
} from "./application-material.js";
import {
  applicationMaterialDefaultModelId,
  applicationMaterialPromptVersion,
  createModelApplicationMaterialWriter,
} from "./application-material-model.js";

// An invented career record.
const facts: ApplicationMaterialFact[] = [
  { id: "f1", category: "role", field: "title", value: "Data Analyst" },
  { id: "f2", category: "achievement", field: "outcome", value: "Cut report time by 40%" },
];
const guidance = {
  emphasis: "  Stress my 12 years of leadership.  ",
  tone: "warm" as const,
  length: "short" as const,
  addressee: "Ms Example, Hiring Manager",
};
const coverLetter = { kind: "cover-letter" as const, facts, requirements: [], guidance };

describe("application material guidance (#2478)", () => {
  it("is trimmed, drops empty fields, and keeps the addressee for a cover letter only", () => {
    expect(boundedApplicationMaterialGuidance("cover-letter", guidance)).toEqual({
      ...guidance,
      emphasis: "Stress my 12 years of leadership.",
    });
    expect(boundedApplicationMaterialGuidance("interview-questions", guidance)).not.toHaveProperty(
      "addressee",
    );
    expect(boundedApplicationMaterialGuidance("cover-letter", { emphasis: "  " })).toBeUndefined();
    expect(applicationMaterialContext({ ...coverLetter, guidance: {} })).not.toHaveProperty(
      "guidance",
    );
  });

  it("never supports a claim: a number only the guidance states is still refused", async () => {
    const violations = applicationMaterialViolations(coverLetter, [
      { question: "", text: "I bring 12 years of leadership as a Data Analyst.", factIds: ["f1"] },
    ]);
    expect(violations.map((violation) => violation.code)).toEqual(["unsupported_number"]);
    await expect(
      draftApplicationMaterial(
        {
          draft: async () => ({
            items: [{ question: "", text: "I led for 12 years.", factIds: ["f1"] }],
          }),
        },
        coverLetter,
      ),
    ).rejects.toMatchObject({ code: "invalid_draft" });
  });

  it("reaches the model as the candidate's instruction, apart from the facts", async () => {
    const requests: ModelRequest<JsonValue>[] = [];
    const port = createModelApplicationMaterialWriter({
      executor: {
        execute: async (request): Promise<ModelResponse<JsonValue>> => {
          requests.push(request);
          return {
            output: { items: [] },
            contextSnapshotId: request.contextSnapshotId,
            provider: "anthropic",
            company: "anthropic",
            route: "anthropic-api",
            modelId: applicationMaterialDefaultModelId,
            providerRequestId: null,
            structuredOutputSha256: "0".repeat(64),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            cost: { estimatedUsd: 0 },
          };
        },
      },
      model: {
        company: "anthropic",
        modelId: applicationMaterialDefaultModelId,
        role: "author",
        promptTemplateVersion: applicationMaterialPromptVersion,
      },
      dataPolicy: {
        allowTransmission: true,
        allowedCompanies: ["anthropic"],
        sensitiveData: true,
        sensitiveDataAcknowledged: true,
      },
      applicationId: "app_fixture",
    });
    await port.draft({ context: applicationMaterialContext(coverLetter), refusedRules: [] });
    await port.draft({
      context: applicationMaterialContext({ kind: "cover-letter", facts, requirements: [] }),
      refusedRules: [],
    });
    const [guided, plain] = requests;
    expect(guided?.input).toMatchObject({
      candidate_guidance: {
        emphasis: "Stress my 12 years of leadership.",
        tone: "warm",
        length: "short",
        addressee: "Ms Example, Hiring Manager",
      },
    });
    const sentFacts = JSON.stringify((guided?.input as { facts?: unknown } | undefined)?.facts);
    expect(sentFacts).not.toContain("leadership");
    expect(guided?.systemPrompt).toContain("It is never a fact: never cite it");
    expect(plain?.input).not.toHaveProperty("candidate_guidance");
  });
});
