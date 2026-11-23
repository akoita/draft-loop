import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { validateDraftArtifact } from "./index.js";
import { findSummaryProjectNames } from "./summary-project-names.js";

type Artifact = Pick<DraftArtifact, "sections" | "claims">;
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

/** Fictional evidence: an employer, a project in a role, an independent project and skills. */
const excerpts = [
  "### Yarrowline Software Studio — Application Engineer — March 2017 to September 2020\nShe implemented the Rust parser adapter named **Mossline Parcel Bridge** for the office.",
  "## Independent project · TernSpindle · Mar 2025 to Aug 2025\nBuilt a fictional ticket router.",
  "**Contact**: `vale@example.invalid` · North Basin",
  "Go, Rust, SQL, PostgreSQL and **Kubernetes** in production.",
];

const claims = excerpts.map((excerpt, index) => ({
  id: `claim-${index}`,
  sectionId: "experience",
  text: excerpt,
  evidence: [{ sourcePath: "/local/profile.md", excerpt }],
})) as unknown as Artifact["claims"];

const body = [
  section("experience", "experience", [
    ["Yarrowline Software Studio | Application Engineer | 2017 - 2020", "paragraph"],
    ["Built the Mossline Parcel Bridge parser adapter in Rust.", "bullet"],
  ]),
  section("projects", "projects", [
    ["TernSpindle | Independent project | 2025", "paragraph"],
    ["Built a fictional ticket router.", "bullet"],
  ]),
  section("skills", "skills", [["Languages: Go, Rust, SQL, Kubernetes", "paragraph"]]),
];

function artifact(summary: string, coreArea: string): Artifact {
  return {
    sections: [
      section("summary", "summary", [[summary, "paragraph"]]),
      section("core", "alignment", [[coreArea, "bullet"]]),
      ...body,
    ],
    claims,
  };
}

describe("internal project names in the summary (#3160)", () => {
  it("raises nothing when the summary names employers and technologies or describes the work", () => {
    const clean = artifact(
      "Application engineer at Yarrowline Software Studio who builds Rust and Kubernetes services for land offices.",
      "Data intake: parser adapters and quarantine for invalid parcel records",
    );
    expect(findSummaryProjectNames(clean)).toEqual([]);
  });

  it("flags a project title in the summary and in Core areas", () => {
    const named = artifact(
      "Application engineer who built Mossline Parcel Bridge and runs Kubernetes services.",
      "Routing: designed TernSpindle, a ticket router",
    );
    const issues = findSummaryProjectNames(named);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      code: "editorial-project-name",
      sectionId: "summary",
      blockId: "summary-0",
      location: { start: 31, end: 53, line: 1, column: 32 },
    });
    expect(issues[0]?.message).toContain('"Mossline Parcel Bridge"');
    expect(issues[1]).toMatchObject({ sectionId: "core", blockId: "core-0" });
    expect(issues[1]?.message).toContain('Core areas names "TernSpindle"');
  });

  it("leaves a name the draft also gives as an employer or a skill", () => {
    const employer = artifact(
      "Engineer at Yarrowline Software Studio with Kubernetes in production.",
      "Delivery: parser adapters for parcel records",
    );
    const withProjectEmployer: Artifact = {
      ...employer,
      claims: [
        ...employer.claims,
        {
          ...employer.claims[0],
          id: "claim-bold-employer",
          evidence: [
            { sourcePath: "/local/profile.md", excerpt: "**Yarrowline Software Studio**" },
          ],
        } as unknown as Artifact["claims"][number],
      ],
    };
    expect(findSummaryProjectNames(withProjectEmployer)).toEqual([]);
  });

  it("is a quality warning of the deterministic validation, never an error", () => {
    const named = artifact(
      "Application engineer who built Mossline Parcel Bridge.",
      "Delivery: parser adapters for parcel records",
    );
    const result = validateDraftArtifact({ ...named, language: "en" } as unknown as DraftArtifact, {
      requirements: [],
      outputConstraints: { requiredSections: [] },
    });
    const finding = result.issues.find(({ code }) => code === "editorial-project-name");
    expect(finding).toMatchObject({ category: "quality", severity: "warning" });
  });
});
