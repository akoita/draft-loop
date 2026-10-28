import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  findCvShapeIssues,
  MISSING_CV_HEADER_CODE,
  UNLABELLED_SKILLS_LINE_CODE,
} from "./cv-shape.js";
import { validateDraftArtifact } from "./index.js";

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

  it("names the placeholders a header still shows", () => {
    const header = section("header", "header", [
      "[Your name]",
      "Alex Example · [Email] · [Phone] · [Email]",
    ]);
    expect(findCvShapeIssues({ sections: [header, experience] })).toEqual([
      {
        code: MISSING_CV_HEADER_CODE,
        message:
          "the CV header still shows [Your name]; replace it with the candidate's details before sending the CV",
        sectionId: "header",
        blockId: "header-block-0",
        blocksApproval: true,
      },
      {
        code: MISSING_CV_HEADER_CODE,
        message:
          "the CV header still shows [Email], [Phone]; replace them with the candidate's details before sending the CV",
        sectionId: "header",
        blockId: "header-block-1",
        blocksApproval: true,
      },
    ]);
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

describe("a placeholder header at the approval gate", () => {
  const artifact = {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt: "2026-10-28T10:00:00.000Z",
    language: "en",
    sections: [section("header", "header", ["[Your name] | [Email]"]), experience],
    claims: [],
    decisions: [],
  } as unknown as DraftArtifact;
  const context = { requirements: [], outputConstraints: { requiredSections: [] } };
  const headerSeverity = (approvalGate: boolean) =>
    validateDraftArtifact(artifact, context, { approvalGate }).issues.find(
      ({ code }) => code === MISSING_CV_HEADER_CODE,
    )?.severity;

  it("blocks approval, and only warns while the loop runs", () => {
    expect(headerSeverity(true)).toBe("error");
    expect(headerSeverity(false)).toBe("warning");
    expect(
      validateDraftArtifact(artifact, context).issues.find(
        ({ code }) => code === MISSING_CV_HEADER_CODE,
      )?.severity,
    ).toBe("warning");
  });

  it("still only warns about a CV with no header at all", () => {
    const noHeader = { ...artifact, sections: [experience] } as unknown as DraftArtifact;
    expect(
      validateDraftArtifact(noHeader, context, { approvalGate: true }).issues.find(
        ({ code }) => code === MISSING_CV_HEADER_CODE,
      )?.severity,
    ).toBe("warning");
  });
});
