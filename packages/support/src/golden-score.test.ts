import { describe, expect, it } from "vitest";

import type { SupportReply } from "./assistant.js";
import { gradeSupportGoldenReply, summarizeSupportGoldenRun } from "./golden-score.js";
import type { SupportGoldenQuestion } from "./golden-set.js";

const howTo: SupportGoldenQuestion = {
  id: "en-add-job",
  language: "en",
  question: "Where do I paste the job posting?",
  expect: { sections: ["job"] },
};
const offTopic: SupportGoldenQuestion = {
  id: "en-poem",
  language: "en",
  question: "Write me a poem.",
  expect: { refuse: "off_topic" },
};

const answer = (
  outcome: "answered" | "refused" | "needs_person",
  sections: readonly string[],
): SupportReply => ({
  mode: "assistant",
  outcome,
  text: "Text.",
  sections: sections.map((id) => ({ id, title: id })) as never,
  ticketId: null,
});

describe("grading the paid check (#2884)", () => {
  it("passes an answer that cites an expected section, and a refusal of an off-topic ask", () => {
    expect(gradeSupportGoldenReply(howTo, answer("answered", ["job", "draft"]), 0.01).verdict).toBe(
      "answered_correctly",
    );
    expect(gradeSupportGoldenReply(offTopic, answer("refused", []), 0.01).verdict).toBe(
      "refused_correctly",
    );
  });

  it("names each way an answer fails", () => {
    expect(gradeSupportGoldenReply(howTo, answer("answered", ["credits"]), 0).verdict).toBe(
      "wrong_source",
    );
    expect(gradeSupportGoldenReply(howTo, answer("refused", []), 0).verdict).toBe(
      "refused_answerable",
    );
    expect(gradeSupportGoldenReply(howTo, answer("needs_person", []), 0).verdict).toBe(
      "needs_person",
    );
    expect(gradeSupportGoldenReply(offTopic, answer("answered", ["job"]), 0).verdict).toBe(
      "should_have_refused",
    );
    const fallback: SupportReply = { mode: "guide_search", reason: "cost_cap", sections: [] };
    expect(gradeSupportGoldenReply(howTo, fallback, 0).verdict).toBe("fell_back");
  });

  it("counts verdicts and the cost per model answer, fallbacks left out", () => {
    const summary = summarizeSupportGoldenRun(
      [howTo, offTopic],
      [
        gradeSupportGoldenReply(howTo, answer("answered", ["job"]), 0.004),
        gradeSupportGoldenReply(
          offTopic,
          { mode: "guide_search", reason: "cost_cap", sections: [] },
          0,
        ),
      ],
    );
    expect(summary).toMatchObject({ asked: 2, answerable: 1, refusals: 1, totalUsd: 0.004 });
    expect(summary.counts.answered_correctly).toBe(1);
    expect(summary.counts.fell_back).toBe(1);
    expect(summary.usdPerAnswer).toBe(0.004);
  });
});
