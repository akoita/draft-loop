import type { JsonValue, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import {
  type CoverLetterClaimLink,
  checkCoverLetter,
  checkCoverLetterClaims,
  coverLetterSentences,
} from "./cover-letter-claims.js";
import {
  coverLetterClaimLinksOf,
  createModelCoverLetterClaimChecker,
} from "./cover-letter-claims-model.js";
import type { PickedCoverLetterFact } from "./cover-letter-facts.js";

// An invented record and employer.
const facts: PickedCoverLetterFact[] = [
  { id: "f1", brief: "achievement outcome: Cut settlement breaks by 40%", group: "bank", score: 4 },
  { id: "f2", brief: "skill name: Hyperledger Fabric", group: "bank", score: 4 },
  { id: "f3", brief: "achievement: Wrote a threat model", group: "lab", score: 3 },
];
const companyFacts = [{ id: "c1", text: "The employer plans 24/7 digital asset trading." }];

const letter = [
  "Thank you for reading this.",
  "At the bank I cut settlement breaks by 40% on Hyperledger Fabric. I also wrote a threat model there.",
  "Your plan for 24/7 trading is why I applied.",
].join("\n\n");

const link = (
  sentenceId: string,
  kind: CoverLetterClaimLink["kind"],
  factIds: string[] = [],
  companyFactIds: string[] = [],
): CoverLetterClaimLink => ({ sentenceId, kind, factIds, companyFactIds });

describe("coverLetterSentences", () => {
  it("splits paragraphs on blank lines and sentences on end marks", () => {
    expect(coverLetterSentences(letter).map((sentence) => sentence.id)).toEqual([
      "p0.s0",
      "p1.s0",
      "p1.s1",
      "p2.s0",
    ]);
  });
});

describe("checkCoverLetterClaims", () => {
  const request = { sentences: coverLetterSentences(letter), facts, companyFacts };

  it("passes a letter whose every sentence holds", () => {
    const check = checkCoverLetterClaims(request, [
      link("p0.s0", "courtesy"),
      link("p1.s0", "candidate", ["f1", "f2"]),
      link("p1.s1", "candidate", ["f1"]),
      link("p2.s0", "employer", [], ["c1"]),
    ]);
    expect(check.supported).toBe(true);
  });

  it("names what each failing sentence breaks", () => {
    const check = checkCoverLetterClaims(request, [
      link("p0.s0", "courtesy"),
      link("p1.s0", "candidate", ["f2"]),
      link("p1.s1", "candidate", ["f1", "f3"]),
      link("p2.s0", "employer", ["f1"], ["c9"]),
    ]);
    expect(check.supported).toBe(false);
    expect(Object.fromEntries(check.sentences.map((s) => [s.id, s.problems]))).toEqual({
      "p0.s0": [],
      "p1.s0": ["unsupported_number"],
      "p1.s1": ["cross_group"],
      "p2.s0": ["unknown_company_fact", "career_fact_for_employer", "unsupported_number"],
    });
    expect(check.sentences[1]?.numbers).toEqual(["40"]);
  });

  it("treats a sentence the model skipped, or cited nothing for, as unsupported", () => {
    const check = checkCoverLetterClaims(request, [link("p1.s0", "candidate")]);
    expect(check.sentences.map((s) => s.problems[0])).toEqual([
      "unlinked",
      "no_fact",
      "unlinked",
      "unlinked",
    ]);
  });

  it("refuses talk about the record and a company fact used for the candidate", () => {
    const check = checkCoverLetterClaims(
      {
        sentences: coverLetterSentences("Hyperledger Fabric is on my record."),
        facts,
        companyFacts,
      },
      [link("p0.s0", "candidate", ["f2"], ["c1"])],
    );
    expect(check.sentences[0]?.problems).toEqual(["company_fact_for_candidate", "record_language"]);
  });
});

describe("the model adapter", () => {
  it("sends only sentences and facts, and keeps well-formed links", async () => {
    const requests: ModelRequest<JsonValue>[] = [];
    const port = createModelCoverLetterClaimChecker({
      executor: {
        execute: async (request) => {
          requests.push(request);
          return {
            output: {
              links: [
                { sentence_id: "p0.s0", kind: "courtesy", fact_ids: [], company_fact_ids: [] },
                { sentence_id: "p1.s0", kind: "boast", fact_ids: [], company_fact_ids: [] },
              ],
            },
          } as unknown as ModelResponse<JsonValue>;
        },
      },
      model: { company: "anthropic", modelId: "scripted" } as never,
      dataPolicy: {} as never,
      applicationId: "app-1",
    });
    const check = await checkCoverLetter(letter, facts, companyFacts, port);
    expect(JSON.stringify(requests[0]?.input)).toContain("Cut settlement breaks");
    expect(check.sentences.filter((s) => s.problems.length === 0).map((s) => s.id)).toEqual([
      "p0.s0",
    ]);
    expect(coverLetterClaimLinksOf(null)).toEqual([]);
  });
});
