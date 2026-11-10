import { describe, expect, it } from "vitest";

import type { CoverLetterClaimCheckPort } from "./cover-letter-claims.js";
import type { InterviewGuideWriterPort, InterviewGuideWriterRequest } from "./interview-guide.js";
import { draftExtensiveInterviewGuide } from "./interview-guide-extensive.js";
import { interviewGuideMatrix, interviewGuideNeverSay } from "./interview-guide-matrix.js";

// An invented candidate and job only.
const facts = [
  {
    id: "f1",
    category: "achievement",
    field: "achievement",
    value: "Migrated a ledger to PostgreSQL",
    subjectId: "role-1",
  },
];
const requirements = [
  { id: "r1", text: "PostgreSQL ledger migrations", priority: "critical" as const },
  { id: "r2", text: "People management of a team of eight", priority: "high" as const },
];
const details = { stage: "final" as const, depth: "extensive" as const };
const input = {
  details,
  facts,
  requirements,
  matrix: interviewGuideMatrix(requirements, facts),
  neverSay: interviewGuideNeverSay([], []),
  language: "fr",
};

/** Every sentence that names the ledger cites f1; any other is advice. */
const checker: CoverLetterClaimCheckPort = {
  link: async ({ sentences }) => ({
    links: sentences.map((sentence) => ({
      sentenceId: sentence.id,
      kind: sentence.text.includes("ledger") ? "candidate" : "courtesy",
      factIds: sentence.text.includes("ledger") ? ["f1"] : [],
      companyFactIds: [],
    })),
  }),
};

/** Writes one item per requested section, tagged with the call's number. */
function writer() {
  const requests: InterviewGuideWriterRequest[] = [];
  const port: InterviewGuideWriterPort = {
    write: async (request) => {
      requests.push(request);
      const call = ["alpha", "beta", "gamma"][requests.length - 1];
      return {
        items: request.sections.map((section) => ({
          section,
          heading: "",
          text: section === "pitch" ? `Open with the ledger, call ${call}.` : `Advice ${call}.`,
        })),
        model: { provider: "anthropic", model: "claude-sonnet-5-5" },
      };
    },
  };
  return { port, requests };
}

describe("extensive interview guide", () => {
  it("writes three parts, adds the matrix and keeps the reading order", async () => {
    const { port, requests } = writer();
    const guide = await draftExtensiveInterviewGuide(port, checker, input);
    expect(requests.map((request) => request.sections)).toEqual([
      ["interview", "company", "role", "market"],
      ["pitch", "stories", "defense"],
      ["read-first", "questions", "ask", "practical", "checklist"],
    ]);
    expect(requests[0]?.questionCount).toBe(12);
    expect(guide.items.map((item) => item.section)).toEqual([
      "read-first",
      "interview",
      "company",
      "role",
      "market",
      "matrix",
      "matrix",
      "pitch",
      "stories",
      "defense",
      "questions",
      "ask",
      "practical",
      "checklist",
    ]);
    const matrix = guide.items.filter((item) => item.section === "matrix");
    expect(matrix.map((item) => [item.heading, item.factIds])).toEqual([
      ["PostgreSQL ledger migrations", ["f1"]],
      ["People management of a team of eight", []],
    ]);
    expect(matrix[1]?.text).toContain("lignes de défense");
  });

  it("writes one part again and keeps the others", async () => {
    const first = await draftExtensiveInterviewGuide(writer().port, checker, input);
    const again = writer();
    const guide = await draftExtensiveInterviewGuide(again.port, checker, input, {
      parts: ["story"],
      previous: first.items,
    });
    expect(again.requests).toHaveLength(1);
    expect(guide.items.find((item) => item.section === "pitch")?.text).toBe(
      "Open with the ledger, call alpha.",
    );
    expect(guide.items.find((item) => item.section === "company")?.text).toBe("Advice alpha.");
    expect(guide.items.filter((item) => item.section === "matrix")).toHaveLength(2);
  });
});
