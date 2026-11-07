import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CareerInterviewLiveStage,
  type CareerInterviewLiveVoice,
  careerInterviewHeardTail,
  careerInterviewLiveRefusal,
  careerInterviewLiveStateLabel,
} from "./career-interview-live.js";
import type { CareerInterviewTopicView } from "./career-interview-model.js";
import { CareerInterviewPanel, careerInterviewLatestQuestion } from "./career-interview-panel.js";

const voice: CareerInterviewLiveVoice = {
  listener: "Google Cloud in the EU",
  start: () => ({ endTurn: () => {}, skipQuestion: () => {}, stop: () => {} }),
  allow: async () => undefined,
};

// Invented topic and turns only.
const openTopic: CareerInterviewTopicView = {
  key: "untold-period:2016-2017",
  kind: "untold-period",
  reason: "Your record says nothing between 2016 and 2017.",
  status: "open",
  turns: [{ role: "interviewer", text: "What happened in that period?" }],
};
const session = { id: "cis_fixture0001", status: "open" as const, topics: [openTopic] };

function panel(liveVoiceAvailable: boolean, live: CareerInterviewLiveVoice | undefined) {
  return renderToStaticMarkup(
    <CareerInterviewPanel
      session={{ ...session, liveVoiceAvailable }}
      proposal={undefined}
      knowledgeBases={[]}
      onStart={async () => undefined}
      onAction={async () => undefined}
      loadConflicts={async () => []}
      live={live}
    />,
  );
}

describe("live career interview", () => {
  it("offers to talk live only when both the host and the server can", () => {
    expect(panel(true, voice)).toContain("Talk live");
    expect(panel(false, voice)).not.toContain("Talk live");
    expect(panel(true, undefined)).not.toContain("Talk live");
    expect(panel(true, voice)).toContain('aria-pressed="true">Write</button>');
    expect(panel(true, voice)).toContain(">Speak</button>");
  });

  it("opens a stage with the question, the orb and a way back to writing", () => {
    const html = renderToStaticMarkup(
      <CareerInterviewLiveStage
        topicKey="untold-period:2016-2017"
        voice={voice}
        question="What happened in that period?"
        onClose={() => {}}
      />,
    );
    expect(html).toContain("interview-stage interview-stage-connecting");
    expect(html).toContain("What happened in that period?");
    expect(html).toContain('class="interview-orb"');
    expect(html).toContain("Connecting…");
    expect(html).toContain("Back to writing");
    expect(html).toContain("Your voice goes to Google Cloud in the EU");
  });

  it("shows the latest question and keeps a long answer to its tail", () => {
    expect(
      careerInterviewLatestQuestion({
        ...openTopic,
        turns: [
          { role: "interviewer", text: "First question?" },
          { role: "candidate", text: "An answer." },
          { role: "interviewer", text: "Second question?" },
          { role: "candidate", text: "", mark: "skipped" },
        ],
      }),
    ).toBe("Second question?");
    expect(careerInterviewLatestQuestion({ ...openTopic, turns: [] })).toBeUndefined();
    expect(careerInterviewHeardTail("  short  ")).toBe("short");
    const tail = careerInterviewHeardTail(`${"word ".repeat(80)}end`);
    expect(tail.startsWith("…")).toBe(true);
    expect(tail.endsWith("end")).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(221);
  });

  it("names each state and who hears the voice when consent is missing", () => {
    expect(careerInterviewLiveStateLabel("listening")).toBe("Listening");
    expect(careerInterviewLiveStateLabel("speaking")).toBe("The interviewer is speaking");
    expect(careerInterviewLiveRefusal("consent_required", "", voice.listener)).toContain(
      "sends your voice to Google Cloud in the EU",
    );
    expect(careerInterviewLiveRefusal("live_limit_reached", "", voice.listener)).toContain(
      "time limit",
    );
    expect(careerInterviewLiveRefusal("topic_not_open", "", voice.listener)).toContain(
      "no longer being discussed",
    );
  });
});
