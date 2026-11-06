import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CareerInterviewSessionView } from "./career-interview-model.js";
import {
  careerInterviewActiveTopic,
  careerInterviewProgress,
  careerInterviewRefusal,
  careerInterviewTurnText,
} from "./career-interview-model.js";
import {
  CareerInterviewPanel,
  type CareerInterviewPanelProps,
  careerInterviewSendsOnKey,
  careerInterviewTopicStatusLabel,
} from "./career-interview-panel.js";

// Invented topics and answers only.
const proposedSession: CareerInterviewSessionView = {
  id: "cis_fixture0001",
  status: "open",
  topics: [
    {
      key: "untold-period:2016-2017",
      kind: "untold-period",
      reason: "Your record says nothing between 2016 and 2017.",
      status: "proposed",
      turns: [],
    },
  ],
};

const openSession: CareerInterviewSessionView = {
  ...proposedSession,
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
  topics: [
    {
      key: "untold-period:2016-2017",
      kind: "untold-period",
      reason: "Your record says nothing between 2016 and 2017.",
      status: "open",
      turns: [
        { role: "interviewer", text: "What happened in that period?" },
        { role: "candidate", text: "", mark: "unknown" },
      ],
    },
  ],
};

const summarisedSession: CareerInterviewSessionView = {
  ...openSession,
  topics: [
    {
      key: "untold-period:2016-2017",
      kind: "untold-period",
      reason: "Your record says nothing between 2016 and 2017.",
      status: "summarised",
      turns: [],
      summary: "I retrained in 2016.",
    },
  ],
};

function render(overrides: Partial<CareerInterviewPanelProps>): string {
  const props: CareerInterviewPanelProps = {
    session: undefined,
    proposal: "Your record says nothing between 2016 and 2017. Would you like to talk about it?",
    knowledgeBases: [{ id: "kb-1", name: "Career notes" }],
    onStart: async () => undefined,
    onAction: async () => undefined,
    loadConflicts: async () => [],
    ...overrides,
  };
  return renderToStaticMarkup(<CareerInterviewPanel {...props} />);
}

describe("CareerInterviewPanel", () => {
  it("offers to start a conversation before any session", () => {
    const html = render({});
    expect(html).toContain("Start a conversation");
    expect(html).toContain("You confirm every summary");
  });

  it("says the interviewer is not set up instead of offering topics it cannot discuss", () => {
    const html = render({ session: { ...proposedSession, interviewerAvailable: false } });
    expect(html).toContain("The interviewer is not set up on this server");
    expect(html).not.toContain("Talk about this");
    expect(html).toContain("Pause for now");
  });

  it("still lets the candidate confirm a summary when the interviewer is not set up", () => {
    const html = render({ session: { ...summarisedSession, interviewerAvailable: false } });
    expect(html).toContain("Confirm as evidence");
    expect(html).not.toContain("The interviewer is not set up");
  });

  it("offers a proposed topic, a no, and the candidate's own subject", () => {
    const html = render({ session: proposedSession });
    expect(html).toContain("Would you like to talk about it?");
    expect(html).toContain("Talk about this");
    expect(html).toContain("Not now");
    expect(html).toContain("Or something else you would like to talk about");
    expect(html).toContain("Pause for now");
  });

  it("shows the conversation, its choices and the model that wrote the questions", () => {
    const html = render({ session: openSession });
    expect(html).toContain("What happened in that period?");
    expect(html).toContain("Did not remember.");
    expect(html).toContain("Your answer");
    expect(html).toContain("Skip this question");
    expect(html).toContain("I don&#x27;t remember");
    expect(html).toContain("Set this topic aside");
    expect(html).toContain("Questions written by claude-sonnet-5-5 (anthropic).");
    expect(html).toContain("0 of 1 topics finished");
    expect(html).not.toContain("Answer by voice");
  });

  it("shows the turns as chat bubbles and lists the session's topics with their state", () => {
    const html = render({ session: openSession });
    expect(html).toContain("interview-turn interview-turn-interviewer");
    expect(html).toContain("interview-turn interview-turn-candidate");
    expect(html).toContain('aria-label="Topics in this conversation"');
    expect(html).toContain("Talking now");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Enter sends, Shift+Enter starts a new line.");
  });

  it("sends on Enter but not on Shift+Enter or while composing a character", () => {
    expect(careerInterviewSendsOnKey({ key: "Enter", shiftKey: false })).toBe(true);
    expect(careerInterviewSendsOnKey({ key: "Enter", shiftKey: true })).toBe(false);
    expect(careerInterviewSendsOnKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(
      false,
    );
    expect(careerInterviewSendsOnKey({ key: "a", shiftKey: false })).toBe(false);
  });

  it("words every topic state for the side list", () => {
    expect(careerInterviewTopicStatusLabel("proposed")).toBe("Suggested");
    expect(careerInterviewTopicStatusLabel("summarised")).toBe("Summary to confirm");
    expect(careerInterviewTopicStatusLabel("closed")).toBe("Finished");
  });

  it("offers voice input beside the answer when the host provides it", () => {
    const html = render({
      session: openSession,
      speech: {
        recorder: { start: async () => ({ stop: async () => new Float32Array(0), cancel() {} }) },
        engine: { transcribe: async () => "" },
      },
    });
    expect(html).toContain("Answer by voice");
  });

  it("offers quick replies as chips above the answer box", () => {
    const html = render({ session: openSession });
    expect(html).toContain("Quick replies");
    expect(html.indexOf("interview-chip")).toBeLessThan(html.indexOf("Your answer"));
  });

  it("shows the summary as a card after the conversation it sums up", () => {
    const html = render({
      session: {
        ...summarisedSession,
        topics: summarisedSession.topics.map((topic) => ({
          ...topic,
          turns: [{ role: "interviewer" as const, text: "What did you learn that year?" }],
        })),
      },
    });
    expect(html).toContain("interview-summary-card");
    expect(html.indexOf("What did you learn that year?")).toBeLessThan(
      html.indexOf("Summary of what you said"),
    );
  });

  it("shows the summary to edit, where it goes and who may read it", () => {
    const html = render({ session: summarisedSession });
    expect(html).toContain("I retrained in 2016.");
    expect(html).toContain("Career notes");
    expect(html).toContain("Sensitive: only with your consent");
    expect(html).toContain("Never share with a model");
    expect(html).toContain("Confirm as evidence");
  });

  it("shows a problem the host reports", () => {
    const html = render({ problem: careerInterviewRefusal("consent_required", "fallback") });
    expect(html).toContain('role="alert"');
    expect(html).toContain("permission to send");
  });
});

describe("career interview model", () => {
  it("words turns, progress, the active topic and refusals", () => {
    expect(careerInterviewTurnText({ role: "candidate", text: "", mark: "skipped" })).toEqual({
      speaker: "You",
      text: "Skipped this question.",
    });
    expect(careerInterviewTurnText({ role: "interviewer", text: "Why?" })).toEqual({
      speaker: "Interviewer",
      text: "Why?",
    });
    expect(careerInterviewProgress(summarisedSession)).toEqual({ done: 0, taken: 1 });
    expect(careerInterviewProgress(proposedSession)).toEqual({ done: 0, taken: 0 });
    expect(careerInterviewActiveTopic(proposedSession)).toBeUndefined();
    expect(careerInterviewActiveTopic(openSession)?.status).toBe("open");
    expect(careerInterviewRefusal("something_else", "Server words.")).toBe("Server words.");
    expect(careerInterviewRefusal(undefined, "Server words.")).toBe("Server words.");
  });
});
