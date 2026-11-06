import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CareerInterviewLiveBar,
  type CareerInterviewLiveVoice,
  careerInterviewLiveRefusal,
  careerInterviewLiveStateLabel,
} from "./career-interview-live.js";
import { CareerInterviewPanel } from "./career-interview-panel.js";

const voice: CareerInterviewLiveVoice = {
  listener: "Google Cloud in the EU",
  start: () => ({ endTurn: () => {}, skipQuestion: () => {}, stop: () => {} }),
  allow: async () => undefined,
};

// Invented topic and turns only.
const session = {
  id: "cis_fixture0001",
  status: "open" as const,
  topics: [
    {
      key: "untold-period:2016-2017",
      kind: "untold-period",
      reason: "Your record says nothing between 2016 and 2017.",
      status: "open" as const,
      turns: [{ role: "interviewer" as const, text: "What happened in that period?" }],
    },
  ],
};

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
  });

  it("opens connecting, with a way back to writing", () => {
    const html = renderToStaticMarkup(
      <CareerInterviewLiveBar
        topicKey="untold-period:2016-2017"
        voice={voice}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Connecting…");
    expect(html).toContain("End live conversation");
  });

  it("names each state and who hears the voice when consent is missing", () => {
    expect(careerInterviewLiveStateLabel("listening")).toContain("Done speaking");
    expect(careerInterviewLiveStateLabel("speaking")).toBe("The interviewer is speaking.");
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
