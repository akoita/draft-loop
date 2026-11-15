import type { ResearchBrief } from "@draft-loop/schemas/research-brief";
import { describe, expect, it } from "vitest";

import type { CoverLetterClaimCheckPort, CoverLetterClaimLink } from "./cover-letter-claims.js";
import {
  draftEssentialInterviewGuide,
  type InterviewGuideWriterPort,
  type InterviewGuideWriterRequest,
} from "./interview-guide.js";
import { interviewGuideMatrix, interviewGuideNeverSay } from "./interview-guide-matrix.js";
import { interviewGuideItemsOf } from "./interview-guide-model.js";

// An invented candidate, employer and pages only.
const facts = [
  {
    id: "f1",
    category: "achievement",
    field: "achievement",
    value: "Migrated a ledger to PostgreSQL",
    subjectId: "role-1",
  },
  { id: "f2", category: "skill", field: "skill", value: "Kubernetes" },
];
const requirements = [
  { id: "r1", text: "PostgreSQL ledger migrations", priority: "critical" as const },
  { id: "r2", text: "People management of a team of eight", priority: "high" as const },
];
const brief = {
  id: "rbr_fixture0001",
  workspace_id: "owner",
  application_id: "app_fixture0001",
  queries: ["Example Corp"],
  from_date: "2025-11-10",
  sources: [
    {
      id: "src_1",
      kind: "web-result",
      url: "https://www.examplecorp.com/about",
      title: "About Example Corp",
      excerpt: "Example Corp runs payments.",
      published_on: "2026-10-01",
      topic: "company",
      reliability: "primary",
    },
  ],
  findings: [{ id: "fnd_1", text: "Example Corp runs payments in Europe.", source_ids: ["src_1"] }],
  dropped: { flagged: 0, outdated: 0 },
  search_provider: "scripted",
  model: { provider: "anthropic", model: "claude-haiku-5-5" },
  cost_usd: 0.01,
  created_at: "2026-11-10T09:00:00.000Z",
} as ResearchBrief;

/** Links by the sentence's words, as a checker model would. */
const checker: CoverLetterClaimCheckPort = {
  link: async ({ sentences }) => ({
    links: sentences.map((sentence): CoverLetterClaimLink => {
      const text = sentence.text;
      const link = (
        kind: CoverLetterClaimLink["kind"],
        factIds: string[],
        companyFactIds: string[] = [],
      ) => ({
        sentenceId: sentence.id,
        kind,
        factIds,
        companyFactIds,
      });
      if (text.includes("ledger")) return link("candidate", ["f1"]);
      if (text.includes("not managed")) return link("candidate", ["gap_1"]);
      if (text.includes("Example Corp")) return link("employer", [], ["fnd_1"]);
      if (text.includes("award")) return link("candidate", []);
      return link("courtesy", []);
    }),
  }),
};

function writer(items: Awaited<ReturnType<InterviewGuideWriterPort["write"]>>["items"]) {
  const requests: InterviewGuideWriterRequest[] = [];
  const port: InterviewGuideWriterPort = {
    write: async (request) => {
      requests.push(request);
      return { items, model: { provider: "anthropic", model: "claude-sonnet-5-5" } };
    },
  };
  return { port, requests };
}

const details = {
  stage: "screen" as const,
  depth: "essential" as const,
  length_minutes: 15,
  topics: ["salary" as const],
  never_say: ["The settlement amount"],
};

function input() {
  return {
    details,
    facts,
    requirements,
    matrix: interviewGuideMatrix(requirements, facts),
    neverSay: interviewGuideNeverSay([], details.never_say),
    brief,
    language: "en",
  };
}

describe("essential interview guide", () => {
  it("keeps supported sentences, drops the rest and adds the server's sections", async () => {
    const { port, requests } = writer([
      {
        section: "read-first",
        heading: "",
        text: "This screen judges your story. Lead with the ledger migration.",
      },
      { section: "company", heading: "", text: "Example Corp runs payments in Europe." },
      {
        section: "pitch",
        heading: "Pitch",
        text: "Open with the ledger migration you led. You won an award.",
      },
      {
        section: "defense",
        heading: "People management",
        text: "You have not managed a team formally. The ledger migration is the closest proof.",
      },
      {
        section: "questions",
        heading: "Why are you leaving?",
        text: "Keep it to one calm sentence.",
        trap: "Mentioning the settlement amount.",
      },
      { section: "matrix", heading: "", text: "A section an essential guide does not write." },
    ]);
    const guide = await draftEssentialInterviewGuide(port, checker, input());

    expect(requests[0]?.interview).not.toHaveProperty("never_say");
    expect(requests[0]?.gaps).toEqual([
      { id: "gap_1", requirement: "People management of a team of eight" },
    ]);
    expect(requests[0]?.unsourcedTopics).toEqual(["role", "field", "salary"]);
    expect(requests[0]?.sections).toContain("topic");
    expect(requests[0]?.findings[0]).toMatchObject({
      id: "fnd_1",
      reliability: "primary",
      publishedOn: "2026-10-01",
    });

    expect(guide.items.map((item) => [item.section, item.text, item.trap])).toEqual([
      ["read-first", "This screen judges your story. Lead with the ledger migration.", undefined],
      ["company", "Example Corp runs payments in Europe.", undefined],
      ["pitch", "Open with the ledger migration you led.", undefined],
      [
        "defense",
        "You have not managed a team formally. The ledger migration is the closest proof.",
        undefined,
      ],
      ["questions", "Keep it to one calm sentence.", undefined],
      ["never-say", "The settlement amount", undefined],
      ["sources", "About Example Corp · 2026-10-01 · https://www.examplecorp.com/about", undefined],
    ]);
    expect(guide.items[3]?.factIds).toEqual(["f1"]);
    expect(guide.items[1]?.findingIds).toEqual(["fnd_1"]);
    expect(guide.droppedSentences).toEqual([
      "You won an award.",
      "Mentioning the settlement amount.",
    ]);
  });

  it("refuses a guide with no supported sentence about the candidate", async () => {
    const { port } = writer([{ section: "pitch", heading: "", text: "You won an award." }]);
    await expect(draftEssentialInterviewGuide(port, checker, input())).rejects.toMatchObject({
      code: "invalid_draft",
    });
  });

  it("refuses to write without a fact", async () => {
    const { port, requests } = writer([]);
    await expect(
      draftEssentialInterviewGuide(port, checker, { ...input(), facts: [] }),
    ).rejects.toMatchObject({ code: "no_facts" });
    expect(requests).toHaveLength(0);
  });

  it("reads only well-formed items from a model's output", () => {
    expect(
      interviewGuideItemsOf({
        items: [
          { section: "pitch", heading: "Pitch", text: "Open well.", trap: "" },
          { section: "questions", text: "Angle.", trap: "Trap." },
          { section: 3, text: "Bad." },
          "nonsense",
        ],
      }),
    ).toEqual([
      { section: "pitch", heading: "Pitch", text: "Open well." },
      { section: "questions", heading: "", text: "Angle.", trap: "Trap." },
    ]);
    expect(interviewGuideItemsOf(null)).toEqual([]);
  });
});
