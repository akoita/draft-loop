import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { checkDocumentLanguage } from "./document-language.js";
import { validateDraftArtifact } from "./index.js";

// Invented career prose in both languages.
const french =
  "Conception et exploitation des services de paiement pour une équipe de six personnes, avec la mise en place des tests et du suivi des incidents dans les équipes produit.";
const english =
  "Designed and ran the payment services for a team of six, and set up the tests and the incident review with the product teams over two release cycles.";

function artifact(language: string, texts: readonly string[]): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-language",
    version: 1,
    parentVersionId: null,
    createdAt: "2026-11-06T10:00:00.000Z",
    language,
    sections: [
      {
        id: "section-header",
        title: "Header",
        kind: "header",
        order: 0,
        blocks: [{ id: "h", type: "paragraph", text: "Sample Candidate · Lyon", claimIds: [] }],
      },
      ...texts.map((text, index) => ({
        id: `section-${index + 1}`,
        title: `Section ${index + 1}`,
        kind: "experience" as const,
        order: index + 1,
        blocks: [{ id: `b${index + 1}`, type: "paragraph" as const, text, claimIds: [] }],
      })),
    ],
    claims: [],
    decisions: [],
  };
}

const context = { requirements: [], outputConstraints: { requiredSections: [] } };
const languageIssues = (draft: DraftArtifact) =>
  validateDraftArtifact(draft, context).issues.filter(({ code }) => code === "wrong-language");

describe("document language check", () => {
  it("passes a draft written in its own language", () => {
    expect(languageIssues(artifact("fr", [french, french]))).toEqual([]);
    expect(languageIssues(artifact("en", [english]))).toEqual([]);
    expect(languageIssues(artifact("en-GB", [english]))).toEqual([]);
  });

  it("fails a French document written in English", () => {
    const issues = languageIssues(artifact("fr", [english, english]));
    expect(issues[0]).toMatchObject({
      severity: "error",
      message: "the draft reads as English, but the document is in French",
    });
    expect(issues.filter(({ severity }) => severity === "warning")).toHaveLength(2);
  });

  it("warns about one stray section without failing the draft", () => {
    const issues = languageIssues(artifact("fr", [french, french, french, english]));
    expect(issues).toEqual([
      expect.objectContaining({ severity: "warning", sectionId: "section-4" }),
    ]);
  });

  it("leaves short sections, skill lists and the header alone", () => {
    const check = checkDocumentLanguage(artifact("fr", ["TypeScript, React, Node.js, Postgres"]));
    expect(check.sections).toEqual([]);
    expect(check.wholeDraft).toBe(false);
  });
});
