import { describe, expect, it } from "vitest";

import {
  type CareerInterviewTopicView,
  careerInterviewOffer,
  careerInterviewTopicReason,
  careerInterviewTopicTitle,
} from "./career-interview-model.js";

/** How the screen words a first conversation's starting topics (#2732). */
const start = (title: string): CareerInterviewTopicView => ({
  key: `career-start:${title.replaceAll(" ", "-")}`,
  kind: "career-start",
  reason: "Your record has no work history yet.",
  title,
  status: "proposed",
  turns: [],
});

describe("career interview starting topics on the screen", () => {
  it("names each starting topic and says what it covers", () => {
    expect(careerInterviewTopicTitle(start("work history"))).toBe("Your work history");
    expect(careerInterviewTopicReason(start("work history"))).toBe(
      "Jobs you held: employer, title, dates and what you did.",
    );
    expect(careerInterviewTopicTitle(start("proud of"))).toBe("Something you are proud of");
  });

  it("falls back to the stored words for a starting topic it does not know", () => {
    expect(careerInterviewTopicTitle(start("languages"))).toBe("languages");
    expect(careerInterviewTopicReason(start("languages"))).toBe(
      "Your record has no work history yet.",
    );
  });

  it("opens with the basics instead of listing two reasons", () => {
    const all = ["work history", "education", "skills", "proud of"].map(start);
    expect(careerInterviewOffer(all)).toBe(
      "Your record is empty, so let's begin with the basics. Which would you like to start with?",
    );
  });

  it("no longer calls the record empty once a starting topic is told or set aside", () => {
    expect(careerInterviewOffer([start("education"), start("skills")])).toBe(
      "Let's go on with the basics. Which would you like to talk about next?",
    );
  });
});
