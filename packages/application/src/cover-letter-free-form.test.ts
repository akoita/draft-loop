import type { ModelSelection } from "@draft-loop/domain";
import type { JsonValue, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import type { ApplicationMaterialFact } from "./application-material.js";
import type { CoverLetterClaimCheckPort, CoverLetterClaimLink } from "./cover-letter-claims.js";
import {
  draftFreeFormCoverLetter,
  type FreeFormCoverLetterRequest,
  type FreeFormCoverLetterWriterPort,
} from "./cover-letter-free-form.js";
import {
  createModelFreeFormCoverLetterWriter,
  freeFormCoverLetterPromptVersion,
} from "./cover-letter-free-form-model.js";

// An invented career record and job post.
const facts: ApplicationMaterialFact[] = [
  {
    id: "f1",
    category: "achievement",
    field: "outcome",
    value: "Cut report time by 40%",
    subjectId: "r1",
  },
  { id: "f2", category: "skill", field: "name", value: "SQL", subjectId: "r1" },
  { id: "f3", category: "contact", field: "email", value: "candidate@example.test" },
  { id: "f4", category: "health", field: "note", value: "Private note" },
];
const input = {
  kind: "cover-letter" as const,
  facts,
  requirements: [{ id: "q1", text: "Strong SQL reporting", priority: "critical" as const }],
  mayTransmit: (fact: ApplicationMaterialFact) => fact.category !== "health",
};

const link = (
  sentenceId: string,
  kind: CoverLetterClaimLink["kind"],
  factIds: string[] = [],
): CoverLetterClaimLink => ({ sentenceId, kind, factIds, companyFactIds: [] });

function scriptedWriter(letters: string[]) {
  const requests: FreeFormCoverLetterRequest[] = [];
  const writer: FreeFormCoverLetterWriterPort = {
    write: async (request) => {
      requests.push(request);
      return {
        letter: letters[requests.length - 1] ?? "",
        model: { provider: "anthropic", model: `scripted-${requests.length}` },
      };
    },
  };
  return { writer, requests };
}

function scriptedChecker(answers: CoverLetterClaimLink[][]) {
  let calls = 0;
  const checker: CoverLetterClaimCheckPort = {
    link: async () => ({ links: answers[calls++] ?? [] }),
  };
  return { checker, calls: () => calls };
}

describe("draftFreeFormCoverLetter", () => {
  it("returns a supported letter as paragraphs citing their facts, without revising", async () => {
    const { writer, requests } = scriptedWriter([
      "I cut report time by 40%. I did it in SQL.\n\nI would like to talk.",
    ]);
    const { checker } = scriptedChecker([
      [
        link("p0.s0", "candidate", ["f1"]),
        link("p0.s1", "candidate", ["f2"]),
        link("p1.s0", "courtesy"),
      ],
    ]);
    const draft = await draftFreeFormCoverLetter(writer, checker, input);
    expect(draft).toEqual({
      kind: "cover-letter",
      items: [
        { question: "", text: "I cut report time by 40%. I did it in SQL.", factIds: ["f1", "f2"] },
        { question: "", text: "I would like to talk.", factIds: [] },
      ],
      model: { provider: "anthropic", model: "scripted-1" },
      droppedSentences: [],
    });
    expect(requests).toHaveLength(1);
    // Only the facts the host lets reach a model are picked.
    expect(requests[0]?.facts.map((fact) => fact.id)).toEqual(["f2", "f1"]);
  });

  it("revises the failing sentences once, then drops what still fails", async () => {
    const { writer, requests } = scriptedWriter([
      "I cut report time by 45%. I did it in SQL.",
      "I cut report time by 45% again. I did it in SQL.",
    ]);
    const { checker, calls } = scriptedChecker([
      [link("p0.s0", "candidate", ["f1"]), link("p0.s1", "candidate", ["f2"])],
      [link("p0.s0", "candidate", ["f1"]), link("p0.s1", "candidate", ["f2"])],
    ]);
    const draft = await draftFreeFormCoverLetter(writer, checker, input);
    expect(calls()).toBe(2);
    expect(requests[1]?.revision).toEqual({
      letter: "I cut report time by 45%. I did it in SQL.",
      sentences: [{ text: "I cut report time by 45%.", problems: ["unsupported_number"] }],
    });
    expect(draft.items).toEqual([{ question: "", text: "I did it in SQL.", factIds: ["f2"] }]);
    expect(draft.droppedSentences).toEqual(["I cut report time by 45% again."]);
    expect(draft.model).toEqual({ provider: "anthropic", model: "scripted-2" });
  });

  it("refuses a letter that keeps no supported claim about the candidate", async () => {
    const { writer } = scriptedWriter(["I am great.", "I am great."]);
    const { checker } = scriptedChecker([[], []]);
    await expect(draftFreeFormCoverLetter(writer, checker, input)).rejects.toMatchObject({
      code: "invalid_draft",
    });
  });

  it("refuses to call a model when no fact may be cited", async () => {
    const { writer, requests } = scriptedWriter([]);
    const { checker } = scriptedChecker([]);
    await expect(
      draftFreeFormCoverLetter(writer, checker, { ...input, facts: [facts[2], facts[3]] as never }),
    ).rejects.toMatchObject({ code: "no_facts" });
    expect(requests).toHaveLength(0);
  });
});

describe("createModelFreeFormCoverLetterWriter", () => {
  const model: ModelSelection = {
    company: "anthropic",
    modelId: "claude-sonnet-5-5",
    role: "author",
    promptTemplateVersion: freeFormCoverLetterPromptVersion,
  };

  it("sends the picked facts and the revision, and reads the letter", async () => {
    const requests: ModelRequest<JsonValue>[] = [];
    const writer = createModelFreeFormCoverLetterWriter({
      executor: {
        execute: async (request: ModelRequest<JsonValue>): Promise<ModelResponse<JsonValue>> => {
          requests.push(request);
          return {
            output: { letter: "I did it in SQL." },
            contextSnapshotId: request.contextSnapshotId,
            provider: "anthropic",
            company: "anthropic",
            route: "anthropic-api",
            modelId: "claude-sonnet-5-5",
            providerRequestId: null,
            structuredOutputSha256: "0".repeat(64),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            cost: { estimatedUsd: 0 },
          };
        },
      },
      model,
      dataPolicy: {
        allowTransmission: true,
        allowedCompanies: ["anthropic"],
        sensitiveData: true,
        sensitiveDataAcknowledged: true,
      },
      applicationId: "app_fixture",
    });
    const reply = await writer.write({
      facts: [{ id: "f2", brief: "skill name: SQL", group: "r1", score: 4 }],
      companyFacts: [],
      requirements: [{ id: "q1", text: "SQL", priority: "critical" }],
      revision: { letter: "Old.", sentences: [{ text: "Old.", problems: ["no_fact"] }] },
    });
    expect(reply).toEqual({
      letter: "I did it in SQL.",
      model: { provider: "anthropic", model: "claude-sonnet-5-5" },
    });
    // Room for the whole letter: a cut-off answer is refused by the provider adapter.
    expect(requests[0]?.maxOutputTokens).toBe(8_192);
    expect(requests[0]?.input).toMatchObject({
      facts: [{ id: "f2", text: "skill name: SQL", group: "r1" }],
      revision: { letter: "Old.", sentences: [{ text: "Old.", problems: ["no_fact"] }] },
    });
  });
});
