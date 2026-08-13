import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  extractTextFromRenderedDocument,
  getLocalizedDocumentTitle,
  getLocalizedSectionTitle,
  renderArtifact,
  renderHtml,
  renderMarkdown,
  validateAtsExtractability,
} from "./index.js";

const sampleFrenchCv: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-fr-cv",
  kind: "cv",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-13T10:00:00.000Z",
  language: "fr",
  sections: [
    {
      id: "sec-fr-summary",
      title: "Résumé professionnel",
      kind: "summary",
      order: 0,
      blocks: [
        {
          id: "blk-fr-1",
          type: "paragraph",
          text: "Ingénieur logiciel senior avec 8 ans d'expérience dans les systèmes distribués haute performance et l'architecture locale d'abord.",
          claimIds: ["cl-fr-1"],
        },
      ],
    },
    {
      id: "sec-fr-exp",
      title: "Expérience professionnelle",
      kind: "experience",
      order: 1,
      blocks: [
        {
          id: "blk-fr-2",
          type: "bullet",
          text: "Direction de l'équipe d'infrastructure réduisant la latence globale de 40% sur 500k utilisateurs actifs.",
          claimIds: ["cl-fr-2"],
        },
      ],
    },
  ],
  claims: [
    {
      id: "cl-fr-1",
      text: "Ingénieur logiciel senior avec 8 ans d'expérience dans les systèmes distribués haute performance.",
      sectionId: "sec-fr-summary",
      blockId: "blk-fr-1",
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "/sources/cv_fr.md",
          excerpt: "Ingénieur logiciel senior avec 8 ans d'expérience",
        },
      ],
    },
    {
      id: "cl-fr-2",
      text: "Direction de l'équipe d'infrastructure réduisant la latence globale de 40% sur 500k utilisateurs actifs.",
      sectionId: "sec-fr-exp",
      blockId: "blk-fr-2",
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "/sources/cv_fr.md",
          excerpt: "réduisant la latence globale de 40% sur 500k utilisateurs actifs",
        },
      ],
    },
  ],
  decisions: [],
};

const sampleGermanCoverLetter: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-de-cl",
  kind: "cover-letter",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-13T10:00:00.000Z",
  language: "de",
  sections: [
    {
      id: "sec-de-sal",
      title: "Anrede",
      kind: "salutation",
      order: 0,
      blocks: [
        {
          id: "blk-de-1",
          type: "paragraph",
          text: "Sehr geehrte Damen und Herren,",
          claimIds: [],
        },
      ],
    },
    {
      id: "sec-de-body",
      title: "Qualifikationsabgleich",
      kind: "alignment",
      order: 1,
      blocks: [
        {
          id: "blk-de-2",
          type: "paragraph",
          text: "Mit großem Interesse bewerbe ich mich auf die ausgeschriebene Position als Leitender Systemarchitekt.",
          claimIds: ["cl-de-1"],
        },
      ],
    },
    {
      id: "sec-de-close",
      title: "Schlussformel",
      kind: "closing",
      order: 2,
      blocks: [
        {
          id: "blk-de-3",
          type: "paragraph",
          text: "Mit freundlichen Grüßen, Bewerber",
          claimIds: [],
        },
      ],
    },
  ],
  claims: [
    {
      id: "cl-de-1",
      text: "Mit großem Interesse bewerbe ich mich auf die Position als Leitender Systemarchitekt.",
      sectionId: "sec-de-body",
      blockId: "blk-de-2",
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "/sources/cv_de.md",
          excerpt: "Leitender Systemarchitekt",
        },
      ],
    },
  ],
  decisions: [],
};

describe("Multilingual Templates & Localized Document Exports", () => {
  it("provides canonical localized headings for en, fr, de, es, and ja", () => {
    expect(getLocalizedSectionTitle("summary", "en")).toBe("Professional Summary");
    expect(getLocalizedSectionTitle("summary", "fr")).toBe("Résumé professionnel");
    expect(getLocalizedSectionTitle("summary", "de")).toBe("Beruflicher Werdegang");
    expect(getLocalizedSectionTitle("summary", "es")).toBe("Resumen profesional");
    expect(getLocalizedSectionTitle("summary", "ja")).toBe("職務要約");

    expect(getLocalizedDocumentTitle("cover-letter", "fr")).toBe("Lettre de motivation DraftLoop");
    expect(getLocalizedDocumentTitle("cv", "de")).toBe("DraftLoop Lebenslauf");
    expect(getLocalizedDocumentTitle("application-qa", "es")).toBe(
      "Preguntas y respuestas DraftLoop",
    );
  });

  it("renders localized French CV across all formats with ATS compatibility", () => {
    const html = renderHtml(sampleFrenchCv);
    expect(html).toContain("CV personnalisé DraftLoop");
    expect(html).toContain("Résumé professionnel");

    for (const format of ["markdown", "pdf", "docx"] as const) {
      const rendered = renderArtifact(sampleFrenchCv, format);
      const atsReport = validateAtsExtractability(rendered, sampleFrenchCv);

      expect(atsReport.passed).toBe(true);
      expect(atsReport.tokenRecoveryRate).toBeGreaterThanOrEqual(0.85);
      expect(atsReport.recoveredText.toLowerCase()).toMatch(/exp[eé]rience/u);
    }
  });

  it("renders localized German cover letter across formats", () => {
    const markdown = renderMarkdown(sampleGermanCoverLetter);
    expect(markdown).toContain("Sehr geehrte Damen und Herren,");
    expect(markdown).toContain("## Qualifikationsabgleich");
    expect(markdown).toContain("Mit freundlichen Grüßen");
    expect(markdown).not.toContain("## Anrede");
    expect(markdown).not.toContain("## Schlussformel");

    const html = renderHtml(sampleGermanCoverLetter);
    expect(html).toContain("DraftLoop Anschreiben");

    for (const format of ["markdown", "pdf", "docx"] as const) {
      const rendered = renderArtifact(sampleGermanCoverLetter, format);
      const extracted = extractTextFromRenderedDocument(rendered);
      expect(extracted).toContain("Systemarchitekt");
    }
  });
});
