import { describe, expect, it } from "vitest";

import {
  type CareerInterviewRule,
  careerInterviewMethodPrompt,
  checkCareerInterviewTurn,
} from "./career-interview-method.js";

const context = {
  allowedText:
    "Topic: the platform migration at the logistics firm, 2016 to 2018. Candidate: I moved 40 services to the new cluster.",
};

function rules(turn: string): readonly CareerInterviewRule[] {
  return checkCareerInterviewTurn(turn, context).refusals.map((refusal) => refusal.rule);
}

describe("career interview method prompt", () => {
  it("keeps the guide's stance, safeguards and closing summary", () => {
    const prompt = careerInterviewMethodPrompt.join("\n");
    expect(prompt).toContain("empathetic, patient");
    expect(prompt).toContain("exactly one open question per turn");
    expect(prompt).toContain("never ask for the reason");
    expect(prompt).toContain("Never suggest a number");
    expect(prompt).toContain("confirm or correct");
  });
});

describe("checkCareerInterviewTurn", () => {
  it.each([
    "What did a typical week look like during the migration?",
    "So you moved 40 services to the new cluster. What changed for the team afterwards?",
    "Your record has nothing between 2016 and 2018. Would you like to talk about that period?",
    "That sounds demanding. What part of it are you proudest of?",
    "Thank you, that is clear. Shall we stop here for today?",
  ])("accepts a patient, open turn: %s", (turn) => {
    expect(checkCareerInterviewTurn(turn, context)).toEqual({ accepted: true, refusals: [] });
  });

  it.each<[string, CareerInterviewRule]>([
    ["Did that cut deployment time by 30%?", "suggested-number"],
    ["Was the team about 12 people?", "suggested-number"],
    ["You must have led the whole programme. How did that go?", "leading-question"],
    ["Surely you saved the company money there. What happened next?", "leading-question"],
    ["Didn't you improve reliability a lot?", "leading-question"],
    ["What did you do? And who did you report to?", "several-questions"],
    ["Telling this story will get you the job. What happened next?", "hiring-promise"],
    ["I guarantee recruiters notice this. Shall we go on?", "hiring-promise"],
    ["You should sue them for that. Shall we move on?", "out-of-scope-advice"],
    ["That sounds like burnout. Would you like to continue?", "out-of-scope-advice"],
    ["Why did you leave the company in 2018?", "asks-reason-for-break"],
    ["What caused the gap in your record?", "asks-reason-for-break"],
  ])("refuses %s as %s", (turn, rule) => {
    const check = checkCareerInterviewTurn(turn, context);
    expect(check.accepted).toBe(false);
    expect(rules(turn)).toContain(rule);
  });

  it("names the words that triggered a refusal", () => {
    expect(checkCareerInterviewTurn("Was it 25 people?", context).refusals).toEqual([
      { rule: "suggested-number", excerpt: "25" },
    ]);
  });

  it("treats a number written with separators as the candidate's own", () => {
    const check = checkCareerInterviewTurn("You mentioned 1,200 users. Who were they?", {
      allowedText: "Candidate: about 1200 users relied on it.",
    });
    expect(check.accepted).toBe(true);
  });
});
