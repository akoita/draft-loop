import type { CoverLetterKitView } from "./cover-letter-kit-contract.js";

/** An invented kit for the kit screen's tests. */
export const fixtureKit: CoverLetterKitView = {
  id: "amd_fixturekit01",
  createdAt: "2026-11-20T09:00:00.000Z",
  model: "claude-haiku-4-5",
  requirements: [
    {
      requirementId: "r1",
      text: "Builds SQL reporting for finance teams",
      facts: [{ factId: "f1", text: "Cut month-end report time by 40% at Fictional Ltd" }],
    },
    {
      requirementId: "r2",
      text: "Leads a small analytics team",
      facts: [{ factId: "f2", text: "Led three analysts on the pricing review" }],
    },
  ],
  angles: [
    { note: "Lead with the 40% faster month-end reports", factIds: ["f1"], findingIds: [] },
    { note: "Tie the pricing review to their new market", factIds: ["f2"], findingIds: ["e1"] },
  ],
  employerFacts: [
    { findingId: "e1", text: "Opened an office in a fictional city", publishedOn: "2026-10-02" },
  ],
  outline: [
    {
      paragraph: 1,
      purpose: "Why this role, in one line",
      requirementIds: [],
      factIds: [],
      findingIds: ["e1"],
    },
    {
      paragraph: 2,
      purpose: "Proof for SQL reporting",
      requirementIds: ["r1"],
      factIds: ["f1"],
      findingIds: [],
    },
    {
      paragraph: 3,
      purpose: "Proof for team leadership",
      requirementIds: ["r2"],
      factIds: ["f2"],
      findingIds: [],
    },
    {
      paragraph: 4,
      purpose: "Close with availability",
      requirementIds: [],
      factIds: [],
      findingIds: [],
    },
  ],
  avoid: ["passionate about", "fast-paced environment"],
};
