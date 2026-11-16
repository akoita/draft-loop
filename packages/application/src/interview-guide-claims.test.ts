import { describe, expect, it } from "vitest";

import { checkCoverLetterClaims } from "./cover-letter-claims.js";
import {
  interviewGuideClaimSources,
  interviewGuideSentenceProblems,
} from "./interview-guide-claims.js";

// An invented candidate, employer and interview.
const sources = interviewGuideClaimSources({
  interview: {
    stage: "screen",
    depth: "essential",
    length_minutes: 30,
    format: "video",
    topics: ["motivation"],
    notes: "Recruiter screen first.",
    scheduled_at: "2026-11-20T10:00",
  } as never,
  facts: [
    { id: "f1", text: "Led a team of four", group: "acme" },
    { id: "f2", text: "Wrote contract tests", group: "acme" },
  ],
  gaps: [{ id: "gap_1", requirement: "Kafka" }],
  matrix: [{ requirement: "Improve deployment workflows" }],
  findings: [{ id: "fnd_1", text: "The employer ships weekly." }],
  unsourcedTopics: ["company"],
});

const check = (
  text: string,
  link: {
    kind: "candidate" | "employer" | "courtesy";
    factIds?: string[];
    companyFactIds?: string[];
    requirementIds?: string[];
  },
) => {
  const sentence = { id: "s", paragraph: 0, text };
  const [checked] = checkCoverLetterClaims({ sentences: [sentence], ...sources }, [
    {
      sentenceId: "s",
      kind: link.kind,
      factIds: link.factIds ?? [],
      companyFactIds: link.companyFactIds ?? [],
      ...(link.requirementIds === undefined ? {} : { requirementIds: link.requirementIds }),
    },
  ]).sentences;
  return interviewGuideSentenceProblems(checked as never, sources.facts);
};

describe("interview guide claim sources (#2807)", () => {
  it("lists the interview, the unsourced topics and the job's requirements as sources", () => {
    expect(sources.companyFacts.map((fact) => fact.id)).toEqual([
      "fnd_1",
      "interview_shape",
      "interview_topics",
      "interview_notes",
      "unsourced_0",
    ]);
    expect(sources.companyFacts[1]?.text).toBe(
      "The interview is the screen stage, on 2026-11-20 at 10:00, 30 minutes long, by video.",
    );
    expect(sources.requirements).toEqual([{ id: "req_0", text: "Improve deployment workflows" }]);
  });

  it("keeps a sentence about the interview, the job or a missing source", () => {
    expect(
      check("It is a 30-minute video screen.", {
        kind: "employer",
        companyFactIds: ["interview_shape"],
      }),
    ).toEqual([]);
    expect(
      check("They want someone to improve deployment workflows.", {
        kind: "employer",
        requirementIds: ["req_0"],
      }),
    ).toEqual([]);
    expect(
      check("Research found no recent source about this employer.", {
        kind: "employer",
        companyFactIds: ["unsourced_0"],
      }),
    ).toEqual([]);
  });

  it("keeps long advice with a time plan, but not an uncited number", () => {
    const advice =
      "Spend the first 10 minutes on your pitch, then 15 minutes on questions, and keep 5 minutes at the end for your own questions about the team, the roadmap and how they ship.";
    expect(check(advice, { kind: "courtesy" })).toEqual([]);
    expect(check("You cut costs by 40% last year.", { kind: "courtesy" })).toContain(
      "unsupported_number",
    );
  });

  it("keeps a gap admitted beside a fact, but not facts from two employers", () => {
    expect(
      check("You led a team of four, but you have not stated any Kafka work.", {
        kind: "candidate",
        factIds: ["f1", "gap_1"],
      }),
    ).toEqual([]);
  });

  it("keeps the interview's date and time (walk #5)", () => {
    expect(
      check("It is a video screen on 2026-11-20 at 10:00, lasting 30 minutes.", {
        kind: "employer",
        companyFactIds: ["interview_shape"],
      }),
    ).toEqual([]);
  });

  it("keeps a time plan and counts of advice beside the interview, never in a claim", () => {
    const plan = "Split the 30 minutes as 3/6/5/6/5/5-minute blocks.";
    expect(check(plan, { kind: "employer", companyFactIds: ["interview_shape"] })).toEqual([]);
    expect(check("Rehearse it to about 90 seconds.", { kind: "courtesy" })).toEqual([]);
    expect(check("Answer in three sentences, with two examples.", { kind: "courtesy" })).toEqual(
      [],
    );
    expect(
      check("You shipped 12 releases in three hours.", { kind: "candidate", factIds: ["f1"] }),
    ).toContain("unsupported_number");
    expect(check("Revenue grew 3/6 points in 40% of teams.", { kind: "courtesy" })).toContain(
      "unsupported_number",
    );
  });

  it("keeps a gap admitted beside the job's requirement", () => {
    expect(
      check("Kafka is listed, and it is the clearest item you have not shown.", {
        kind: "employer",
        factIds: ["gap_1"],
        requirementIds: ["req_0"],
      }),
    ).toEqual([]);
    expect(
      check("They value the team of four you led.", {
        kind: "employer",
        factIds: ["f1"],
        requirementIds: ["req_0"],
      }),
    ).toContain("career_fact_for_employer");
  });
});
