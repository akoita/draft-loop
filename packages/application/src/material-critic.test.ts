import type { JsonValue, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import type {
  ApplicationMaterialDraft,
  ApplicationMaterialPort,
  ApplicationMaterialRequest,
  DraftApplicationMaterialInput,
} from "./application-material.js";
import { createModelApplicationMaterialWriter } from "./application-material-model.js";
import {
  createModelMaterialCritic,
  type MaterialCriticPort,
  quotedFindings,
  runCriticPass,
} from "./material-critic.js";

const input: DraftApplicationMaterialInput = {
  kind: "cover-letter",
  facts: [
    {
      id: "t",
      category: "role",
      field: "title",
      value: "Data Analyst",
    },
    {
      id: "o",
      category: "achievement",
      field: "outcome",
      value: "Cut report time by 40%",
    },
  ],
  requirements: [{ id: "r1", text: "Reporting with SQL", priority: "high" }],
  language: "en",
};

const letter: ApplicationMaterialDraft = {
  kind: "cover-letter",
  items: [
    {
      question: "",
      text: "I am a passionate Data Analyst. I cut report time by 40%.",
      factIds: ["t", "o"],
    },
    { question: "", text: "Thank you for reading.", factIds: [] },
  ],
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
};

const critic = (findings: unknown[]): MaterialCriticPort => ({
  review: async () => ({
    findings: findings as never,
    model: { provider: "openai", model: "critic-model" },
  }),
});

function author(reply: ApplicationMaterialDraft["items"], seen: ApplicationMaterialRequest[] = []) {
  return {
    seen,
    draft: async (request: ApplicationMaterialRequest) => {
      seen.push(request);
      return { items: reply, model: { provider: "anthropic", model: "claude-sonnet-5-5" } };
    },
  } satisfies ApplicationMaterialPort & { seen: ApplicationMaterialRequest[] };
}

describe("material critic pass", () => {
  it("revises a letter once from the critic's quoted findings", async () => {
    const writer = author([
      { question: "", text: "As a Data Analyst I cut report time by 40%.", factIds: ["t", "o"] },
      { question: "", text: "Thank you for reading.", factIds: [] },
    ]);
    const result = await runCriticPass(
      critic([
        { paragraph: 0, sentence: "I am a passionate Data Analyst.", reason: "stock word" },
        { paragraph: 1, sentence: "A sentence the letter never had.", reason: "made up" },
      ]),
      writer,
      input,
      letter,
    );
    expect(result.revised).toBe(true);
    expect(result.findings).toEqual([
      { paragraph: 0, sentence: "I am a passionate Data Analyst.", reason: "stock word" },
    ]);
    expect(result.criticModel).toEqual({ provider: "openai", model: "critic-model" });
    expect(result.draft.items[0]?.text).toBe("As a Data Analyst I cut report time by 40%.");
    expect(writer.seen).toHaveLength(1);
    expect(writer.seen[0]?.revision?.previous).toEqual(letter.items);
    expect(writer.seen[0]?.revision?.findings).toHaveLength(1);
  });

  it("keeps the first draft when the revision breaks a citation rule", async () => {
    const result = await runCriticPass(
      critic([{ paragraph: 0, sentence: "I am a passionate Data Analyst.", reason: "stock" }]),
      author([{ question: "", text: "I cut report time by 75% for 12 teams.", factIds: ["o"] }]),
      input,
      letter,
    );
    expect(result.revised).toBe(false);
    expect(result.draft).toBe(letter);
    expect(result.findings).toHaveLength(1);
  });

  it("asks the author nothing when the critic finds nothing, and skips interview questions", async () => {
    const writer = author([]);
    const clean = await runCriticPass(critic([]), writer, input, letter);
    expect(clean).toMatchObject({ draft: letter, findings: [], revised: false });
    const questions = { ...letter, kind: "interview-questions" as const };
    const skipped = await runCriticPass(
      critic([{ paragraph: 0, sentence: "I cut report time by 40%.", reason: "x" }]),
      writer,
      input,
      questions,
    );
    expect(skipped).toMatchObject({ draft: questions, findings: [], revised: false });
    expect(writer.seen).toHaveLength(0);
  });

  it("drops duplicate findings, caps them and trims reasons", () => {
    const paragraphs = ["One. Two. Three."];
    const many = Array.from({ length: 12 }, () => ({
      paragraph: 0,
      sentence: "One.",
      reason: "x".repeat(300),
    }));
    const kept = quotedFindings(paragraphs, [
      ...many,
      { paragraph: 0, sentence: " Two. ", reason: "y" },
      { paragraph: 4, sentence: "One.", reason: "z" },
    ]);
    expect(kept.map((finding) => finding.sentence)).toEqual(["One.", "Two."]);
    expect(kept[0]?.reason).toHaveLength(200);
  });

  it("asks the model for quoted findings over the letter's paragraphs only", async () => {
    const requests: ModelRequest<JsonValue>[] = [];
    const port = createModelMaterialCritic({
      executor: {
        execute: async (request) => {
          requests.push(request);
          return {
            company: "openai",
            modelId: "critic-model",
            output: {
              findings: [
                { paragraph: 0, sentence: "One.", reason: "flat" },
                { paragraph: "0", sentence: "Two.", reason: "bad index" },
              ],
            },
          } as unknown as ModelResponse<JsonValue>;
        },
      },
      model: { company: "openai", modelId: "critic-model", role: "critic" } as never,
      dataPolicy: {} as never,
      applicationId: "app_fixture0001",
    });
    const reply = await port.review({ paragraphs: ["One. Two."], language: "en" });
    expect(reply.findings).toEqual([{ paragraph: 0, sentence: "One.", reason: "flat" }]);
    expect(requests[0]?.input).toEqual({ paragraphs: ["One. Two."] });
    expect(requests[0]?.outputName).toBe("machine_writing_findings");
    expect(requests[0]?.contextSnapshotId).toBe("app_fixture0001");
  });

  it("sends the author the previous letter and findings to revise", async () => {
    const requests: ModelRequest<JsonValue>[] = [];
    const writer = createModelApplicationMaterialWriter({
      executor: {
        execute: async (request) => {
          requests.push(request);
          return {
            company: "anthropic",
            modelId: "claude-sonnet-5-5",
            output: { items: [] },
          } as unknown as ModelResponse<JsonValue>;
        },
      },
      model: { company: "anthropic", modelId: "claude-sonnet-5-5", role: "author" } as never,
      dataPolicy: {} as never,
      applicationId: "app_fixture0001",
    });
    await writer.draft({
      context: { kind: "cover-letter", facts: [], requirements: [], language: "en" } as never,
      refusedRules: [],
      revision: {
        previous: letter.items,
        findings: [{ paragraph: 0, sentence: "I am a passionate Data Analyst.", reason: "stock" }],
      },
    });
    expect((requests[0]?.input as Record<string, unknown>).revise_machine_writing).toEqual({
      previous_items: letter.items.map((item) => ({
        question: item.question,
        text: item.text,
        fact_ids: [...item.factIds],
      })),
      findings: [{ paragraph: 0, sentence: "I am a passionate Data Analyst.", reason: "stock" }],
    });
  });
});
