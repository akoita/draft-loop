import { describe, expect, it } from "vitest";

import {
  applicationMaterialArtifact,
  applicationMaterialDocumentFormats,
  renderApplicationMaterialDocument,
} from "./application-material-document.js";
import { extractTextFromRenderedDocument } from "./index.js";
import { builtInRenderingTemplates } from "./templates.js";

const letter = {
  id: "amd_letterfixture01",
  kind: "cover-letter" as const,
  title: "Data Analyst at Example Co",
  language: "en",
  createdAt: "2026-11-08T03:00:00.000Z",
  items: [
    { question: "", text: "As a data analyst I cut report time by 40% for the finance team." },
    { question: "", text: "I would like to bring the same care to your reporting." },
  ],
};

describe("application material document", () => {
  it.each(
    Object.keys(builtInRenderingTemplates).flatMap((templateId) =>
      applicationMaterialDocumentFormats.map((format) => [templateId, format] as const),
    ),
  )("draws a cover letter with the %s template as %s", (templateId, format) => {
    const rendered = renderApplicationMaterialDocument(letter, format, {
      templateId,
      generatedAt: "2026-11-08T03:00:00.000Z",
    });
    expect(rendered.metadata.renderingTemplate.id).toBe(templateId);
    expect(rendered.extension).toBe(format === "pdf" ? ".pdf" : ".docx");
    const text = extractTextFromRenderedDocument(rendered);
    expect(text).toContain("Data Analyst at Example Co");
    expect(text).toContain("cut report time by 40%");
    expect(text).toContain("same care to your reporting");
  });

  it("uses Modern by default and lays interview questions out one per section", () => {
    expect(renderApplicationMaterialDocument(letter, "docx").metadata.renderingTemplate.id).toBe(
      "modern",
    );
    const questions = {
      ...letter,
      kind: "interview-questions" as const,
      items: [{ question: "Why SQL?", text: "It answers the finance team's questions fast." }],
    };
    const artifact = applicationMaterialArtifact(questions);
    expect(artifact.kind).toBe("application-qa");
    expect(artifact.sections.map((section) => section.title)).toEqual(["Why SQL?"]);
    expect(artifact.claims).toEqual([]);
    const text = extractTextFromRenderedDocument(
      renderApplicationMaterialDocument(questions, "pdf"),
    );
    expect(text).toContain("Why SQL?");
    expect(text).toContain("finance team");
  });

  it("refuses an unknown template", () => {
    expect(() => renderApplicationMaterialDocument(letter, "pdf", { templateId: "neon" })).toThrow(
      RangeError,
    );
  });
});
