import { describe, expect, it } from "vitest";

import {
  type CareerInterviewerPort,
  type CareerInterviewerReply,
  type CareerInterviewerRequest,
  careerInterviewFallbackQuestion,
  careerInterviewPhrases,
  careerInterviewProposal,
  careerInterviewShouldClose,
  careerInterviewSummaryRequest,
  nextCareerInterviewTurn,
} from "./career-interview-conversation.js";

const model = { provider: "anthropic", model: "scripted" };

/** A scripted interviewer: returns the replies in order and records each request. */
function scripted(replies: readonly Omit<CareerInterviewerReply, "model">[]) {
  const requests: CareerInterviewerRequest[] = [];
  const port: CareerInterviewerPort = {
    reply: async (request) => {
      requests.push(request);
      const reply = replies[requests.length - 1];
      if (reply === undefined) throw new Error("no scripted reply left");
      return { ...reply, model };
    },
  };
  return { port, requests };
}

// An invented topic.
const topic = {
  kind: "untold-period",
  reason: "Your record says nothing between 2016 and 2017.",
  context: ["Developer at Example Freight, 2012 to 2015"],
};

describe("careerInterviewProposal", () => {
  it("offers one topic, two topics, or the candidate's own subject, with one question", () => {
    expect(careerInterviewProposal([topic])).toBe(
      "Your record says nothing between 2016 and 2017. Would you like to talk about it, or about something else?",
    );
    const two = careerInterviewProposal([
      topic,
      { reason: "Your record mentions mentoring but tells no story about it." },
      { reason: "A third topic is not offered." },
    ]);
    expect(two).toContain("1. Your record says nothing");
    expect(two).toContain("2. Your record mentions mentoring");
    expect(two).not.toContain("third");
    expect(careerInterviewProposal([])).toContain("anything from your career");
    for (const text of [careerInterviewProposal([topic]), two, careerInterviewProposal([])]) {
      expect(text.match(/\?/gu)).toHaveLength(1);
    }
  });
});

describe("careerInterviewShouldClose", () => {
  it("closes after two skips or unknowns in a row, or when follow-ups run out", () => {
    const skip = { role: "candidate", text: "", mark: "skipped" } as const;
    const unknown = { role: "candidate", text: "", mark: "unknown" } as const;
    const answer = { role: "candidate", text: "I ran the move." } as const;
    expect(careerInterviewShouldClose([answer, skip])).toBe(false);
    expect(careerInterviewShouldClose([answer, skip, unknown])).toBe(true);
    expect(careerInterviewShouldClose(Array.from({ length: 6 }, () => answer))).toBe(true);
  });
});

describe("nextCareerInterviewTurn", () => {
  const turns = [
    { role: "interviewer", text: "What happened in that period?" },
    { role: "candidate", text: "I retrained and built 3 small apps for a food bank." },
  ] as const;

  it("returns an accepted follow-up and gives the port only the bounded topic", async () => {
    const { port, requests } = scripted([{ text: "What did building those apps involve?" }]);
    const next = await nextCareerInterviewTurn(port, {
      topic,
      targetThemes: ["Mobile development"],
      turns,
    });
    expect(next).toEqual({
      text: "What did building those apps involve?",
      fallback: false,
      refusals: [],
      model,
    });
    expect(requests[0]).toMatchObject({
      topic,
      targetThemes: ["Mobile development"],
      closing: false,
      refusedRules: [],
    });
    expect(requests[0]?.instructions.join(" ")).toContain("professional career consultant");
  });

  it("asks again once with the refused rules, then accepts the corrected turn", async () => {
    const { port, requests } = scripted([
      { text: "You must have shipped them to 500 users?" },
      { text: "Who used the apps?" },
    ]);
    const next = await nextCareerInterviewTurn(port, { topic, turns });
    expect(next.text).toBe("Who used the apps?");
    expect(next.fallback).toBe(false);
    expect(next.refusals.map((refusal) => refusal.rule)).toEqual([
      "suggested-number",
      "leading-question",
    ]);
    expect(requests[1]?.refusedRules).toEqual(["suggested-number", "leading-question"]);
  });

  it("falls back to a plain open question after two refused attempts", async () => {
    const { port } = scripted([
      { text: "Why did you leave in 2015?" },
      { text: "Surely you increased adoption? And how?" },
    ]);
    const next = await nextCareerInterviewTurn(port, { topic, turns });
    expect(next).toMatchObject({ text: careerInterviewFallbackQuestion, fallback: true, model });
    expect(next.refusals.length).toBeGreaterThanOrEqual(2);
  });

  it("says its safe turns in the conversation's language", async () => {
    const { port } = scripted([
      { text: "Why did you leave in 2015?" },
      { text: "Surely you increased adoption? And how?" },
    ]);
    const next = await nextCareerInterviewTurn(port, { topic, turns, language: "fr" });
    expect(next).toMatchObject({
      text: careerInterviewPhrases("fr").fallbackQuestion,
      fallback: true,
    });
    expect(next.text).toBe("Que voudriez-vous m’en dire, avec vos propres mots ?");
    expect(careerInterviewPhrases("fr-FR")).toBe(careerInterviewPhrases("fr"));
    expect(careerInterviewPhrases("de").fallbackQuestion).toBe(careerInterviewFallbackQuestion);
  });

  it("closes with the model's summary when it repeats only the candidate's numbers", async () => {
    const closingTurns = [
      ...turns,
      { role: "interviewer", text: "Anything else?" },
      { role: "candidate", text: "", mark: "unknown" },
      { role: "interviewer", text: "Who used them?" },
      { role: "candidate", text: "", mark: "skipped" },
    ] as const;
    const { port, requests } = scripted([
      {
        text: careerInterviewSummaryRequest,
        summary: "Between 2016 and 2017 you retrained and built 3 small apps for a food bank.",
      },
    ]);
    const next = await nextCareerInterviewTurn(port, { topic, turns: closingTurns });
    expect(requests[0]?.closing).toBe(true);
    expect(next.summary).toBe(
      "Between 2016 and 2017 you retrained and built 3 small apps for a food bank.",
    );
    expect(next.fallback).toBe(false);
  });

  it("replaces a summary that adds a number with the candidate's own words", async () => {
    const closingTurns = [
      ...turns,
      { role: "candidate", text: "", mark: "unknown" },
      { role: "candidate", text: "", mark: "unknown" },
    ] as const;
    const invented = {
      text: careerInterviewSummaryRequest,
      summary: "You built 3 apps used by 2,000 families.",
    };
    const { port } = scripted([invented, invented]);
    const next = await nextCareerInterviewTurn(port, { topic, turns: closingTurns });
    expect(next).toMatchObject({
      text: careerInterviewSummaryRequest,
      summary: "I retrained and built 3 small apps for a food bank.",
      fallback: true,
    });
  });

  it("sets the topic aside when the candidate gave no words at all", async () => {
    const silent = [
      { role: "candidate", text: "", mark: "skipped" },
      { role: "candidate", text: "", mark: "unknown" },
    ] as const;
    const { port } = scripted([{ text: "Shall we stop?" }, { text: "Shall we stop?" }]);
    const next = await nextCareerInterviewTurn(port, { topic, turns: silent });
    expect(next.summary).toBeUndefined();
    expect(next.fallback).toBe(true);
    expect(next.text).toContain("leave this topic for now");
  });
});
