import { describe, expect, it } from "vitest";

import { interviewDetailsSchema, suggestedInterviewGuideDepth } from "./interview-details.js";

describe("interview details", () => {
  it("needs only the stage and depth, and keeps every optional field", () => {
    expect(interviewDetailsSchema.parse({ stage: "screen", depth: "essential" })).toEqual({
      stage: "screen",
      depth: "essential",
    });
    const full = {
      stage: "combined",
      depth: "extensive",
      scheduled_at: "2026-11-12T14:00",
      length_minutes: 90,
      format: "video",
      interviewer_role: "Engineering manager",
      language: "fr",
      topics: ["salary", "career-gap"],
      other_topics: ["Why consulting now"],
      notes: "Fictional note.",
    };
    expect(interviewDetailsSchema.parse(full)).toEqual(full);
  });

  it("refuses repeated topics, a bad date and an unknown stage", () => {
    const refused = (extra: Record<string, unknown>) =>
      interviewDetailsSchema.safeParse({ stage: "screen", depth: "essential", ...extra }).success;
    expect(refused({ topics: ["salary", "salary"] })).toBe(false);
    expect(refused({ scheduled_at: "next Tuesday" })).toBe(false);
    expect(refused({ stage: "coffee" })).toBe(false);
    expect(refused({ interviewer_name: "Someone" })).toBe(false);
  });

  it("suggests essential for short screens and extensive for long or final rounds", () => {
    expect(suggestedInterviewGuideDepth({ stage: "screen" })).toBe("essential");
    expect(suggestedInterviewGuideDepth({ stage: "technical", length_minutes: 15 })).toBe(
      "essential",
    );
    expect(suggestedInterviewGuideDepth({ stage: "screen", length_minutes: 60 })).toBe("extensive");
    expect(suggestedInterviewGuideDepth({ stage: "final", length_minutes: 20 })).toBe("extensive");
    expect(suggestedInterviewGuideDepth({ stage: "technical" })).toBe("extensive");
  });
});
