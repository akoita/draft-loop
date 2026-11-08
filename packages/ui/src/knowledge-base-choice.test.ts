import { describe, expect, it } from "vitest";
import { knowledgeBaseChoice } from "./knowledge-base-choice.js";

const bases = [
  { id: "kb-1", name: "Career evidence" },
  { id: "kb-2", name: "Side projects" },
];

describe("knowledge base choice", () => {
  it("has nothing to choose before the host has read the bases", () => {
    expect(knowledgeBaseChoice([], "")).toBe("");
  });

  it("takes the first base, as the select shows it, when the bases arrive after the form", () => {
    expect(knowledgeBaseChoice(bases, "")).toBe("kb-1");
  });

  it("keeps the candidate's choice", () => {
    expect(knowledgeBaseChoice(bases, "kb-2")).toBe("kb-2");
  });

  it("falls back to the first base when the chosen one is no longer offered", () => {
    expect(knowledgeBaseChoice(bases, "kb-gone")).toBe("kb-1");
  });
});
