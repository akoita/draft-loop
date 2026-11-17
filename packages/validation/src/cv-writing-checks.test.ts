import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { findCvWritingIssues } from "./cv-writing-checks.js";

type Section = DraftArtifact["sections"][number];

function section(id: string, kind: Section["kind"], blocks: [string, "paragraph" | "bullet"][]) {
  return {
    id,
    kind,
    title: id,
    blocks: blocks.map(([text, type], index) => ({
      id: `${id}-${index}`,
      type,
      text,
      claimIds: [],
    })),
  } as unknown as Section;
}

/** A fictional CV whose writing is clean. */
const clean = [
  section("summary", "summary", [
    [
      "Platform engineer who builds and runs TypeScript services for small finance teams. I lead delivery from design review to on-call.",
      "paragraph",
    ],
  ]),
  section("core", "alignment", [
    [
      "Service ownership: design reviews, deployment pipelines and on-call for ledger services",
      "bullet",
    ],
  ]),
  section("experience", "experience", [
    ["Platform Engineer | Example Ledger | 2021 - 2025", "paragraph"],
    ["Example Ledger keeps accounts for small cooperatives.", "paragraph"],
    ["Cut nightly reconciliation time by moving batch jobs to a queue on Kubernetes.", "bullet"],
    ["Wrote the runbooks the support team uses for every ledger incident.", "bullet"],
  ]),
];

const codes = (sections: Section[]) => findCvWritingIssues({ sections }).map(({ code }) => code);

describe("CV writing checks (#2908)", () => {
  it("raises nothing on a clean CV", () => {
    expect(findCvWritingIssues({ sections: clean })).toEqual([]);
  });

  it("flags a status caveat in a role's context line", () => {
    const experience = section("experience", "experience", [
      ["Platform Engineer | Example Ledger | 2021 - 2025", "paragraph"],
      ["Example Ledger's new billing service, which is staging, not production.", "paragraph"],
      ["Cut nightly reconciliation time with a queue.", "bullet"],
    ]);
    const issues = findCvWritingIssues({ sections: [experience] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "editorial-negative-aside",
      blockId: "experience-1",
      location: { line: 1 },
    });
    expect(issues[0]?.message).toContain("staging");
  });

  it("leaves a caveat word alone in a bullet, where it may be the work itself", () => {
    const experience = section("experience", "experience", [
      ["Platform Engineer | Example Ledger | 2021 - 2025", "paragraph"],
      ["Built the staging environment the team tests every release in.", "bullet"],
    ]);
    expect(codes([experience])).toEqual([]);
  });

  it("flags a summary that is a list of phrases joined by semicolons", () => {
    const summary = section("summary", "summary", [
      [
        "Ledger services on Kubernetes; deployment pipelines; on-call ownership; runbooks",
        "paragraph",
      ],
    ]);
    expect(codes([summary])).toEqual(["editorial-fragment"]);
  });

  it("flags a Core areas line that repeats an Experience bullet", () => {
    const core = section("core", "alignment", [
      ["Cut nightly reconciliation time by moving batch jobs to a queue on Kubernetes", "bullet"],
    ]);
    const issues = findCvWritingIssues({ sections: [core, clean[2] as Section] });
    expect(issues.map(({ code, blockId }) => [code, blockId])).toEqual([
      ["duplicate-content", "core-0"],
    ]);
  });
});
