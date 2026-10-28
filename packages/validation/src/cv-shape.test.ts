import { describe, expect, it } from "vitest";

import {
  findCvShapeIssues,
  MISSING_CV_HEADER_CODE,
  UNLABELLED_SKILLS_LINE_CODE,
} from "./cv-shape.js";

type Section = Parameters<typeof findCvShapeIssues>[0]["sections"][number];

function section(
  id: string,
  kind: string,
  texts: readonly string[] = ["Fictional text."],
): Section {
  return {
    id,
    title: id,
    kind,
    order: 0,
    blocks: texts.map((text, index) => ({
      id: `${id}-block-${index}`,
      type: "paragraph",
      text,
      claimIds: [],
    })),
  } as unknown as Section;
}

const experience = section("experience", "experience");

describe("CV shape checks", () => {
  it("warns about a CV without a name or contact header", () => {
    const issues = findCvShapeIssues({ sections: [section("summary", "summary"), experience] });
    expect(issues.map(({ code }) => code)).toEqual([MISSING_CV_HEADER_CODE]);
    expect(
      findCvShapeIssues({ sections: [section("header", "header", []), experience] }).map(
        ({ code }) => code,
      ),
    ).toEqual([MISSING_CV_HEADER_CODE]);
  });

  it("accepts a CV with a header, and leaves partial drafts and letters alone", () => {
    expect(
      findCvShapeIssues({
        sections: [section("header", "header", ["Alex Example", "alex@example.com"]), experience],
      }),
    ).toEqual([]);
    expect(findCvShapeIssues({ sections: [section("summary", "summary")] })).toEqual([]);
    expect(
      findCvShapeIssues({ sections: [section("salutation", "salutation"), experience] }),
    ).toEqual([]);
  });

  it("warns about each unlabelled Skills line next to labelled ones", () => {
    const skills = section("skills", "skills", [
      "Coding agents, OpenAPI",
      "Backend: Python, PostgreSQL",
      "Cloud: Cloud Run, Terraform",
    ]);
    const header = section("header", "header", ["Alex Example", "alex@example.com"]);
    expect(findCvShapeIssues({ sections: [header, experience, skills] })).toEqual([
      {
        code: UNLABELLED_SKILLS_LINE_CODE,
        message:
          "a Skills line has no label while the others do; write it as `Label: items` or merge it into a labelled line",
        sectionId: "skills",
        blockId: "skills-block-0",
      },
    ]);
    const allBare = section("skills", "skills", ["Python, PostgreSQL", "Terraform"]);
    expect(findCvShapeIssues({ sections: [header, experience, allBare] })).toEqual([]);
  });
});
