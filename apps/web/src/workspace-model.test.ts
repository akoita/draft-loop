import { describe, expect, it } from "vitest";

import {
  defaultWorkspaceForm,
  samePairWarning,
  sectionList,
  workspaceFormProblems,
  workspaceRequestBody,
} from "./workspace-model.js";

describe("workspace form", () => {
  it("accepts the defaults and leaves models to the service", () => {
    expect(workspaceFormProblems(defaultWorkspaceForm)).toEqual([]);
    expect(workspaceRequestBody(defaultWorkspaceForm)).toEqual({
      language: "en",
      maxRounds: 2,
      fixtureMode: false,
    });
  });

  it("sends chosen models, sections and fixture mode", () => {
    expect(
      workspaceRequestBody({
        ...defaultWorkspaceForm,
        requiredSections: "Summary, Experience\nSkills\n",
        authorModel: " synthetic-author-1 ",
        criticModel: "synthetic-critic-1",
        fixtureMode: true,
      }),
    ).toEqual({
      language: "en",
      maxRounds: 2,
      fixtureMode: true,
      requiredSections: ["Summary", "Experience", "Skills"],
      author: { company: "anthropic", model: "synthetic-author-1" },
      critic: { company: "openai", model: "synthetic-critic-1" },
    });
  });

  it("explains what to fix", () => {
    expect(
      workspaceFormProblems({
        ...defaultWorkspaceForm,
        language: "e",
        maxRounds: "0",
        authorModel: "bad model",
      }),
    ).toEqual([
      "Give the CV's language as a code such as en or fr.",
      "Allow from 1 to 10 rounds.",
      "The author model is a model id, such as the provider names it.",
    ]);
  });

  it("splits sections on commas and lines", () => {
    expect(sectionList(" Summary ,\n\nSkills")).toEqual(["Summary", "Skills"]);
  });
});

describe("model pair", () => {
  it("warns only when both models come from one company", () => {
    expect(samePairWarning("anthropic", "openai")).toBeUndefined();
    expect(samePairWarning("openai", "openai")).toMatch(/same company/);
  });
});
