import { describe, expect, it } from "vitest";

import {
  type CoverLetterCheckInput,
  checkCoverLetterText,
  closestCoverLetterFact,
  coverLetterCheckBriefTargets,
  coverLetterWording,
  jobAdEcho,
} from "./cover-letter-check.js";
import type { CoverLetterClaimCheckPort, CoverLetterClaimLink } from "./cover-letter-claims.js";

// An invented career record and job ad.
const facts = [
  { id: "t", category: "role", subjectId: "job", field: "title", value: "Data Analyst" },
  {
    id: "s",
    category: "achievement",
    subjectId: "job",
    field: "outcome",
    value: "Cut SQL report time by 40%",
  },
  { id: "k", category: "skill", field: "tool", value: "Kubernetes operations" },
  { id: "c", category: "contact", field: "email", value: "candidate@example.test" },
];

const jobTexts = [
  "Data Analyst",
  "Build reliable SQL reporting pipelines for our clinical operations team",
  "Kubernetes operations",
];

const letter = [
  "Dear hiring team,",
  "As a Data Analyst I cut SQL report time by 40%. I also led a team of 12 engineers.",
  "I want to build reliable SQL reporting pipelines for our clinical operations team.",
].join("\n\n");

const targets = {
  source: "kit" as const,
  kitId: "amd_kit",
  items: [
    {
      requirement_id: "r1",
      text: "SQL reporting",
      facts: [{ fact_id: "s", text: "achievement outcome: Cut SQL report time by 40%" }],
    },
    {
      requirement_id: "r2",
      text: "Kubernetes operations",
      facts: [{ fact_id: "k", text: "skill tool: Kubernetes operations" }],
    },
  ],
};

const input: CoverLetterCheckInput = { letter, facts, targets, jobTexts };

/** A scripted checker: links by sentence id, and records what it was sent. */
function scripted(links: readonly CoverLetterClaimLink[], seen: unknown[] = []) {
  return {
    link: async (request) => {
      seen.push(request);
      return { links };
    },
  } satisfies CoverLetterClaimCheckPort;
}

describe("Check my letter", () => {
  it("reports an unsupported claim with the closest approved fact, never the contact", async () => {
    const seen: unknown[] = [];
    const result = await checkCoverLetterText(
      input,
      scripted(
        [
          { sentenceId: "p0.s0", kind: "courtesy", factIds: [], companyFactIds: [] },
          { sentenceId: "p1.s0", kind: "candidate", factIds: ["t", "s"], companyFactIds: [] },
          { sentenceId: "p1.s1", kind: "candidate", factIds: [], companyFactIds: [] },
          { sentenceId: "p2.s0", kind: "courtesy", factIds: [], companyFactIds: [] },
        ],
        seen,
      ),
    );

    expect(result.claims.status).toBe("checked");
    expect(result.claims.checked_sentences).toBe(4);
    expect(result.claims.findings).toEqual([
      {
        paragraph: 1,
        sentence: "I also led a team of 12 engineers.",
        about: "candidate",
        reason: "no_supporting_fact",
        closest_fact: null,
      },
    ]);
    expect(JSON.stringify(seen)).not.toContain("candidate@example.test");
    // The linked kit fact answers r1; nothing answers r2.
    expect(result.requirements).toEqual({
      source: "kit",
      kit_id: "amd_kit",
      total: 2,
      unanswered: [targets.items[1]],
    });
  });

  it("names a number no fact states and points to the nearest fact", async () => {
    const result = await checkCoverLetterText(
      { ...input, letter: "As a Data Analyst I cut SQL report time by 60%." },
      scripted([{ sentenceId: "p0.s0", kind: "candidate", factIds: ["s"], companyFactIds: [] }]),
    );

    expect(result.claims.findings).toEqual([
      expect.objectContaining({
        reason: "number_not_in_fact",
        numbers: ["60"],
        closest_fact: { fact_id: "s", text: "achievement outcome: Cut SQL report time by 40%" },
      }),
    ]);
  });

  it("skips the claims without a model and still returns the offline findings", async () => {
    const result = await checkCoverLetterText(input, { skip: "model_calls_paused" });

    expect(result.claims).toEqual({
      status: "skipped",
      reason: "model_calls_paused",
      checked_sentences: 0,
      findings: [],
    });
    // Without links, shared words still answer r1.
    expect(result.requirements.unanswered.map((each) => each.requirement_id)).toEqual(["r2"]);
    expect(result.wording.map((finding) => finding.code)).toContain("job_ad_echo");
  });

  it("skips the claims when no fact is allowed", async () => {
    const seen: unknown[] = [];
    const result = await checkCoverLetterText(
      {
        ...input,
        facts: [{ id: "c", category: "contact", field: "email", value: "candidate@example.test" }],
      },
      scripted([], seen),
    );
    expect(result.claims.reason).toBe("no_facts");
    expect(seen).toEqual([]);
  });

  it("falls back to the brief's top three requirements, most important first", () => {
    expect(
      coverLetterCheckBriefTargets([
        { id: "a", text: "Low", priority: "low" },
        { id: "b", text: "Critical", priority: "critical" },
        { id: "c", text: "High", priority: "high" },
        { id: "d", text: "Medium", priority: "medium" },
      ]).map((target) => target.requirement_id),
    ).toEqual(["b", "c", "d"]);
  });
});

describe("machine-made wording, offline", () => {
  it("finds a job-ad echo of six words or more, and not a shorter one", () => {
    expect(
      jobAdEcho("I want to build reliable SQL reporting pipelines for your team.", jobTexts),
    ).toBe("build reliable sql reporting pipelines for");
    expect(jobAdEcho("I build reliable SQL reporting tools.", jobTexts)).toBeUndefined();
  });

  it("flags empty superlatives, stock phrases and other writing tells", () => {
    const findings = coverLetterWording(
      [
        "I am a highly motivated, results-driven analyst with a proven track record.",
        "I bring speed, rigour and care. I bring calm to every project.",
        "Je suis un candidat idéal.",
      ].join("\n\n"),
      [],
    );
    const codes = findings.map((finding) => `${finding.code}:${finding.match ?? ""}`);
    expect(codes).toContain("empty_superlative:highly motivated");
    expect(codes).toContain("stock_phrase:proven track record");
    expect(codes).toContain("list_of_three:speed, rigour and care");
    expect(codes).toContain("empty_superlative:candidat idéal");
    expect(codes.some((code) => code.startsWith("word_count:"))).toBe(true);
  });

  it("matches superlatives as whole words only", () => {
    const findings = coverLetterWording("The exceptionally quiet release went out.", []);
    expect(findings.filter((finding) => finding.code === "empty_superlative")).toEqual([]);
  });

  it("returns no closest fact when nothing shares a word", () => {
    expect(
      closestCoverLetterFact("Hello there.", [{ id: "x", brief: "skill: SQL", score: 0 }]),
    ).toBe(null);
  });
});
