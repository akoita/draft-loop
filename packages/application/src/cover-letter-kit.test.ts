import type { JsonValue, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { coverLetterKitSchema } from "@draft-loop/schemas/cover-letter-kit";
import { describe, expect, it } from "vitest";

import type { ApplicationMaterialFact } from "./application-material.js";
import {
  type CoverLetterKitAnswer,
  CoverLetterKitError,
  type CoverLetterKitPort,
  type CoverLetterKitRequest,
  coverLetterKitAvoidList,
  coverLetterKitContext,
  draftCoverLetterKit,
} from "./cover-letter-kit.js";
import {
  coverLetterKitModelId,
  coverLetterKitPromptVersion,
  createModelCoverLetterKitWriter,
} from "./cover-letter-kit-model.js";

// An invented career record, job and employer.
const facts: ApplicationMaterialFact[] = [
  { id: "f1", category: "role", field: "title", value: "Data Analyst", subjectId: "r1" },
  { id: "f2", category: "role", field: "employer", value: "Northwind Clinics", subjectId: "r1" },
  {
    id: "f3",
    category: "achievement",
    field: "outcome",
    value: "Cut weekly SQL report time by 40%",
    subjectId: "r1",
  },
  { id: "f4", category: "skill", field: "skill", value: "Python dashboards" },
  { id: "f5", category: "skill", field: "skill", value: "Stakeholder workshops" },
  { id: "f6", category: "contact", field: "email", value: "ada@example.test" },
];
const requirements = [
  { id: "req_1", text: "Strong SQL reporting", priority: "critical" as const },
  { id: "req_2", text: "Python dashboards for clinicians", priority: "high" as const },
  { id: "req_3", text: "Run stakeholder workshops", priority: "medium" as const },
  { id: "req_4", text: "Spanish", priority: "low" as const },
];
const companyFacts = [
  { id: "fnd_1", text: "Example Health opened 3 clinics in 2026.", publishedOn: "2026-10-15" },
  { id: "fnd_2", text: "Example Health builds tools for clinics." },
];
const input = { facts, requirements, companyFacts, language: "en" };

const valid: CoverLetterKitAnswer = {
  requirements: [
    { requirementId: "req_1", factIds: ["f3", "f1"] },
    { requirementId: "req_2", factIds: ["f4"] },
    { requirementId: "req_3", factIds: ["f5"] },
  ],
  angles: [
    { note: "Lead with the 40% faster SQL reports", factIds: ["f3"], findingIds: [] },
    { note: "Open on their 3 new clinics in 2026", factIds: [], findingIds: ["fnd_1"] },
  ],
  employerFindingIds: ["fnd_1"],
  outline: [
    {
      paragraph: 1,
      purpose: "Name the role and the clinic growth that drew you",
      requirementIds: [],
      factIds: [],
      findingIds: ["fnd_1"],
    },
    {
      paragraph: 2,
      purpose: "Prove SQL reporting with the Northwind report rebuild",
      requirementIds: ["req_1"],
      factIds: ["f3", "f1"],
      findingIds: [],
    },
    {
      paragraph: 3,
      purpose: "Show dashboards and workshops for clinicians",
      requirementIds: ["req_2", "req_3"],
      factIds: ["f4", "f5"],
      findingIds: [],
    },
    {
      paragraph: 4,
      purpose: "Close with a plain ask for an interview",
      requirementIds: [],
      factIds: [],
      findingIds: [],
    },
  ],
};

function scripted(...answers: CoverLetterKitAnswer[]) {
  const requests: CoverLetterKitRequest[] = [];
  const port: CoverLetterKitPort = {
    draft: async (request) => {
      requests.push(request);
      const answer = answers[Math.min(requests.length - 1, answers.length - 1)] as never;
      return { answer, model: { provider: "anthropic", model: coverLetterKitModelId } };
    },
  };
  return { port, requests };
}

describe("cover letter writing kit", () => {
  it("offers picked facts without contact details, and dated employer facts only", () => {
    const context = coverLetterKitContext(input);
    expect(context.facts.map((fact) => fact.id)).not.toContain("f6");
    expect(context.facts.map((fact) => fact.id)).toEqual(expect.arrayContaining(["f3", "f4"]));
    expect(context.company.map((fact) => fact.id)).toEqual(["fnd_1"]);
    expect(context.requirements.map((entry) => entry.id)).toEqual([
      "req_1",
      "req_2",
      "req_3",
      "req_4",
    ]);
  });

  it("returns a kit whose citations carry the record's own text", async () => {
    const { port, requests } = scripted(valid);
    const draft = await draftCoverLetterKit(port, input);
    expect(requests).toHaveLength(1);
    expect(coverLetterKitSchema.parse(draft.kit)).toEqual(draft.kit);
    expect(draft.kit.requirements[0]).toEqual({
      requirement_id: "req_1",
      text: "Strong SQL reporting",
      facts: [
        { fact_id: "f3", text: "achievement outcome: Cut weekly SQL report time by 40%" },
        { fact_id: "f1", text: "role title: Data Analyst" },
      ],
    });
    expect(draft.kit.employer_facts).toEqual([
      {
        finding_id: "fnd_1",
        text: "Example Health opened 3 clinics in 2026.",
        published_on: "2026-10-15",
      },
    ]);
    expect(draft.kit.outline.map((entry) => entry.paragraph)).toEqual([1, 2, 3, 4]);
    expect(draft.kit.avoid).toContain("proven track record");
    expect(draft.kit.avoid).not.toContain("tirer parti");
    expect(draft.model).toEqual({ provider: "anthropic", model: coverLetterKitModelId });
  });

  it("refuses a kit citing an unknown fact id after its retry", async () => {
    const unknown = {
      ...valid,
      requirements: [{ requirementId: "req_1", factIds: ["f99"] }, ...valid.requirements.slice(1)],
    };
    const { port, requests } = scripted(unknown);
    const refusal = await draftCoverLetterKit(port, input).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(CoverLetterKitError);
    expect((refusal as CoverLetterKitError).code).toBe("invalid_kit");
    expect((refusal as CoverLetterKitError).violations.map((each) => each.code)).toContain(
      "unknown_fact",
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]?.refusedRules.join(" ")).toContain("f99");
  });

  it("names a withheld fact apart from an unknown one, and accepts the corrected retry", async () => {
    const withheld = {
      ...valid,
      requirements: [{ requirementId: "req_1", factIds: ["f6"] }, ...valid.requirements.slice(1)],
    };
    const { port, requests } = scripted(withheld, valid);
    const draft = await draftCoverLetterKit(port, input);
    expect(requests[1]?.refusedRules.join(" ")).toContain("f6, which may not be used");
    expect(draft.kit.requirements).toHaveLength(3);
  });

  it("refuses letter prose, an unsourced number and the wrong shape", async () => {
    const prose: CoverLetterKitAnswer = {
      ...valid,
      requirements: valid.requirements.slice(0, 2),
      angles: [
        { note: "I cut report time by 40% at Northwind.", factIds: ["f3"], findingIds: [] },
        { note: "Mention the 12 dashboards", factIds: ["f4"], findingIds: [] },
        { note: "Open on clinics", factIds: [], findingIds: [] },
        { note: "Open on Python", factIds: ["f4"], findingIds: [] },
      ],
      employerFindingIds: ["fnd_2"],
      outline: valid.outline.slice(0, 3),
    };
    const refusal = (await draftCoverLetterKit(scripted(prose).port, {
      ...input,
      maximumAttempts: 1,
    }).catch((error: unknown) => error)) as CoverLetterKitError;
    expect(refusal.violations.map((each) => each.code)).toEqual(
      expect.arrayContaining([
        "requirement_count",
        "unknown_finding",
        "angle_count",
        "uncited_angle",
        "letter_prose",
        "unsupported_number",
        "outline_shape",
      ]),
    );
    expect(refusal.violations.map((each) => each.detail)).toContain(
      "Angle 1 ends a sentence; write a short note, not a sentence of the letter.",
    );
  });

  it("refuses an angle citing a fact no requirement lists", async () => {
    const stray = {
      ...valid,
      angles: [valid.angles[0], { note: "Open on Northwind", factIds: ["f2"], findingIds: [] }],
    } as CoverLetterKitAnswer;
    const refusal = (await draftCoverLetterKit(scripted(stray).port, {
      ...input,
      maximumAttempts: 1,
    }).catch((error: unknown) => error)) as CoverLetterKitError;
    expect(refusal.violations.map((each) => each.detail)).toEqual([
      "Angle 2 cites fact f2; cite only facts a requirement lists.",
    ]);
  });

  it("answers every requirement when the job lists fewer than three", async () => {
    const one = {
      ...valid,
      requirements: [valid.requirements[0]],
      outline: valid.outline.map((entry) => ({
        ...entry,
        requirementIds: entry.requirementIds.filter((id) => id === "req_1"),
        factIds: entry.factIds.filter((id) => id === "f3" || id === "f1"),
      })),
    } as CoverLetterKitAnswer;
    const draft = await draftCoverLetterKit(scripted(one).port, {
      ...input,
      requirements: requirements.slice(0, 1),
    });
    expect(draft.kit.requirements.map((entry) => entry.requirement_id)).toEqual(["req_1"]);
  });

  it("refuses to start without a fact or a requirement", async () => {
    const { port, requests } = scripted(valid);
    await expect(
      draftCoverLetterKit(port, { ...input, facts: facts.slice(5) }),
    ).rejects.toMatchObject({ code: "no_facts" });
    await expect(draftCoverLetterKit(port, { ...input, requirements: [] })).rejects.toMatchObject({
      code: "no_requirements",
    });
    expect(requests).toHaveLength(0);
  });

  it("puts the candidate's forbidden terms first and uses French tells for a French letter", () => {
    const avoid = coverLetterKitAvoidList("fr-FR", ["synergie"]);
    expect(avoid[0]).toBe("synergie");
    expect(avoid).toContain("tirer parti");
    expect(avoid).not.toContain("leverage");
  });

  it("sends the bounded context to Haiku and reads the answer back", async () => {
    const seen: ModelRequest<JsonValue>[] = [];
    const executor = {
      execute: async (request: ModelRequest<JsonValue>) => {
        seen.push(request);
        return {
          output: {
            requirements: [{ requirement_id: "req_1", fact_ids: ["f3"] }],
            angles: [{ note: "Lead with reports", fact_ids: ["f3"], finding_ids: [] }],
            employer_finding_ids: ["fnd_1"],
            outline: [
              {
                paragraph: 1,
                purpose: "Open",
                requirement_ids: [],
                fact_ids: [],
                finding_ids: [],
              },
            ],
          },
          company: "anthropic",
          modelId: coverLetterKitModelId,
        } as unknown as ModelResponse<JsonValue>;
      },
    };
    const writer = createModelCoverLetterKitWriter({
      executor,
      model: {
        company: "anthropic",
        modelId: coverLetterKitModelId,
        role: "author",
        promptTemplateVersion: coverLetterKitPromptVersion,
      },
      dataPolicy: {
        allowTransmission: true,
        allowedCompanies: ["anthropic"],
        sensitiveData: true,
        sensitiveDataAcknowledged: true,
      },
      applicationId: "app_1",
    });
    const reply = await writer.draft({ context: coverLetterKitContext(input), refusedRules: [] });
    expect(coverLetterKitModelId).toMatch(/haiku/u);
    const sent = seen[0]?.input as { facts: { id: string }[]; company_facts: unknown[] };
    expect(sent.facts.map((fact) => fact.id)).not.toContain("f6");
    expect(sent.company_facts).toEqual([
      {
        id: "fnd_1",
        text: "Example Health opened 3 clinics in 2026.",
        published_on: "2026-10-15",
      },
    ]);
    expect(reply.answer.requirements).toEqual([{ requirementId: "req_1", factIds: ["f3"] }]);
    expect(reply.answer.employerFindingIds).toEqual(["fnd_1"]);
    expect(reply.model).toEqual({ provider: "anthropic", model: coverLetterKitModelId });
  });
});
