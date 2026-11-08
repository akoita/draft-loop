import type { JsonValue, ModelRequest, ModelResponse } from "@draft-loop/providers";
import type { ResearchBrief } from "@draft-loop/schemas/research-brief";
import { describe, expect, it } from "vitest";

import {
  type ApplicationMaterialFact,
  type ApplicationMaterialPort,
  type ApplicationMaterialRequest,
  applicationMaterialContext,
  applicationMaterialViolations,
  draftApplicationMaterial,
} from "./application-material.js";
import { researchCompanyFacts } from "./application-material-company.js";
import {
  applicationMaterialDefaultModelId,
  applicationMaterialPromptVersion,
  createModelApplicationMaterialWriter,
} from "./application-material-model.js";

// An invented career record, employer and research brief.
const facts: ApplicationMaterialFact[] = [
  { id: "f1", category: "role", field: "title", value: "Data Analyst" },
  { id: "f2", category: "achievement", field: "outcome", value: "Cut report time by 40%" },
];
const brief = {
  sources: [
    { id: "src_1", published_on: "2026-09-01" },
    { id: "src_2", published_on: "2026-10-15" },
    { id: "src_3" },
  ],
  findings: [
    { id: "fnd_1", text: "Example Corp opened 3 offices in 2026.", source_ids: ["src_1", "src_2"] },
    { id: "fnd_2", text: "Example Corp builds tools for clinics.", source_ids: ["src_3"] },
  ],
} as unknown as ResearchBrief;
const companyFacts = researchCompanyFacts(brief);
const input = { kind: "cover-letter" as const, facts, requirements: [], companyFacts };
const middle = (item: Record<string, unknown>) => [
  { question: "", text: "Hello.", factIds: [] },
  { question: "", text: "I cut report time by 40% as a Data Analyst.", factIds: ["f1", "f2"] },
  { question: "", factIds: ["f1"], ...item },
  { question: "", text: "Thank you.", factIds: [] },
];

describe("company facts in application material", () => {
  it("dates each finding by its newest source and sends them apart from career facts", () => {
    expect(companyFacts).toEqual([
      { id: "fnd_1", text: "Example Corp opened 3 offices in 2026.", publishedOn: "2026-10-15" },
      { id: "fnd_2", text: "Example Corp builds tools for clinics." },
    ]);
    const context = applicationMaterialContext(input);
    expect(context.facts.map((fact) => fact.id)).toEqual(["f1", "f2"]);
    expect(context.company?.map((fact) => fact.id)).toEqual(["fnd_1", "fnd_2"]);
    expect(applicationMaterialContext({ ...input, companyFacts: [] }).company).toBeUndefined();
  });

  it("accepts a company statement whose number a cited finding states", () => {
    const items = middle({
      text: "As a Data Analyst, I would like to support the 3 offices you opened in 2026.",
      companyFactIds: ["fnd_1"],
    });
    expect(applicationMaterialViolations(input, items as never)).toEqual([]);
  });

  it("refuses a finding cited as a career fact, an unknown finding and an uncited company number", () => {
    const asCareer = middle({ text: "I opened offices.", factIds: ["fnd_1"] });
    expect(
      applicationMaterialViolations(input, asCareer as never).map((violation) => violation.code),
    ).toEqual(["company_fact_as_candidate_fact"]);
    const unknown = middle({
      text: "As a Data Analyst, I like clinics.",
      companyFactIds: ["fnd_9"],
    });
    expect(
      applicationMaterialViolations(input, unknown as never).map((violation) => violation.code),
    ).toEqual(["unknown_company_fact"]);
    const uncited = middle({ text: "As a Data Analyst, I like your 3 new offices." });
    expect(
      applicationMaterialViolations(input, uncited as never).map((violation) => violation.code),
    ).toEqual(["unsupported_number"]);
  });

  it("keeps the drafter's company citations on the draft", async () => {
    const requests: ApplicationMaterialRequest[] = [];
    const port: ApplicationMaterialPort = {
      draft: async (request) => {
        requests.push(request);
        return {
          items: middle({
            text: "As a Data Analyst, tools for clinics appeal to me.",
            companyFactIds: ["fnd_2", "fnd_2"],
          }) as never,
        };
      },
    };
    const draft = await draftApplicationMaterial(port, input);
    expect(requests[0]?.context.company).toHaveLength(2);
    expect(draft.items[2]?.companyFactIds).toEqual(["fnd_2"]);
    expect(draft.items[1]).not.toHaveProperty("companyFactIds");
  });

  it("sends company facts to the model and reads its company citations", async () => {
    const requests: ModelRequest<JsonValue>[] = [];
    const writer = createModelApplicationMaterialWriter({
      executor: {
        execute: async (request) => {
          requests.push(request);
          return {
            output: {
              items: [
                {
                  question: "",
                  text: "Tools for clinics appeal to me.",
                  fact_ids: ["f1"],
                  company_fact_ids: ["fnd_2", 3],
                },
              ],
            },
            company: "anthropic",
            modelId: applicationMaterialDefaultModelId,
          } as unknown as ModelResponse<JsonValue>;
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
      applicationId: "app_fixture0001",
    });
    const reply = await writer.draft({
      context: applicationMaterialContext(input),
      refusedRules: [],
    });
    expect(reply.items[0]?.companyFactIds).toEqual(["fnd_2"]);
    const sent = requests[0]?.input as { company_facts?: unknown[] };
    expect(sent.company_facts).toEqual([
      { id: "fnd_1", text: "Example Corp opened 3 offices in 2026.", published_on: "2026-10-15" },
      { id: "fnd_2", text: "Example Corp builds tools for clinics." },
    ]);
  });
});
