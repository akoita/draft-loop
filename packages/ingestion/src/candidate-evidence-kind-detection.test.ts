import { describe, expect, it } from "vitest";

import { detectCandidateEvidenceKind } from "./candidate-evidence-kind-detection.js";

const linkedinPdf = [
  "Contact",
  "alex@example.test",
  "www.linkedin.com/in/alex-example (LinkedIn)",
  "Top Skills",
  "Data Engineering",
  "Team Leadership",
  "Python",
  "Languages",
  "English (Native or Bilingual)",
  "French (Full Professional)",
  "Alex Example",
  "Senior Data Engineer at Fictional Works Ltd",
  "Paris, France",
  "Summary",
  "Engineer building data platforms.",
  "Experience",
  "Fictional Works Ltd",
  "Senior Data Engineer",
  "January 2021 - Present (3 years 9 months)",
  "Paris",
  "Example Analytics",
  "Data Engineer",
  "March 2018 - December 2020 (2 years 10 months)",
  "Education",
  "University of Example",
  "Page 1 of 3",
].join("\n");

const transcript = [
  "Interviewer: Thanks for joining. Can you walk me through your last project?",
  "Alex Example: Sure. I led the migration of the billing pipeline.",
  "Interviewer: What was the hardest part?",
  "Alex Example: Coordinating the cutover with three teams.",
  "Interviewer: How did you measure success?",
  "Alex Example: Error rates dropped and the nightly job finished earlier.",
].join("\n");

const timestampedTranscript = [
  "[00:00:05] Sam: Let's start with your background.",
  "[00:00:12] Alex: I studied engineering and then joined a small team.",
  "[00:01:03] Sam: What did you own there?",
  "[00:01:20] Alex: The deployment tooling.",
  "[00:02:31] Sam: Any lessons?",
  "[00:02:40] Alex: Keep releases small.",
].join("\n");

const englishReview = [
  "# Annual Performance Review",
  "Review period: January to December",
  "## Self-assessment",
  "I delivered the reporting migration and mentored two engineers.",
  "## Manager feedback",
  "Alex consistently exceeds expectations on delivery.",
  "## Strengths",
  "Clear communication and ownership.",
  "## Areas for improvement",
  "Delegate more.",
  "Overall rating: 4 out of 5",
].join("\n");

const frenchReview = [
  "Évaluation annuelle",
  "Points forts",
  "Alex pilote bien les projets et partage son expertise.",
  "Axes d'amélioration",
  "Déléguer davantage.",
  "Objectifs pour l'année prochaine",
  "Encadrer deux nouveaux collègues.",
].join("\n");

const markdownCv = [
  "# Alex Example",
  "alex@example.test | Paris",
  "",
  "## Summary",
  "Data engineer with a focus on reliable pipelines.",
  "",
  "## Experience",
  "### Fictional Works Ltd - Senior Data Engineer",
  "Jan 2021 - Present",
  "- Led the billing pipeline migration",
  "- Mentored two engineers",
  "- Reduced nightly job time",
  "### Example Analytics - Data Engineer",
  "2018 - 2020",
  "- Built ingestion jobs",
  "- Wrote the on-call runbook",
  "",
  "## Education",
  "University of Example, 2014 - 2018",
  "",
  "## Skills",
  "Python, SQL, Airflow",
].join("\n");

const docxCv = [
  "# Alex Example",
  "# Expérience professionnelle",
  "Fictional Works Ltd, ingénieur données",
  "depuis janvier 2021",
  "Example Analytics, développeur",
  "2018 - 2020",
  "# Formation",
  "Université d'Exemple, 2014 - 2018",
  "# Compétences",
  "Python, SQL",
].join("\n");

const terseNotes = [
  "- call w/ recruiter tues",
  "- ask about team size",
  "- check remote policy",
  "- prep story about outage",
  "- follow up with Sam",
].join("\n");

const shortEmail = ["Hi Sam,", "", "Can we move our call to Friday?", "", "Thanks,", "Alex"].join(
  "\n",
);

const genericParagraph =
  "The quarterly report describes how the committee met several times over the spring to discuss the budget, and the conclusions were circulated to everyone afterwards.";

describe("detectCandidateEvidenceKind", () => {
  it("detects a LinkedIn PDF export", () => {
    const result = detectCandidateEvidenceKind({
      text: linkedinPdf,
      mediaType: "application/pdf",
      displayName: "Profile.pdf",
    });
    expect(result.kind).toBe("linkedin-export");
    expect(result.signals).toEqual(
      expect.arrayContaining([
        "linkedin-profile-label",
        "linkedin-top-skills-section",
        "linkedin-section-layout",
        "linkedin-duration-lines",
      ]),
    );
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects French LinkedIn durations", () => {
    const text = [
      "Coordonnées",
      "Contact",
      "www.linkedin.com/in/alex-example (LinkedIn)",
      "Top Skills",
      "Python",
      "Experience",
      "Fictional Works Ltd",
      "janvier 2021 - Present (1 an 4 mois)",
      "Example Analytics",
      "mars 2018 - décembre 2020 (2 ans 10 mois)",
      "Education",
      "Languages",
    ].join("\n");
    expect(detectCandidateEvidenceKind({ text, mediaType: "application/pdf" }).kind).toBe(
      "linkedin-export",
    );
  });

  it("detects speaker-labelled and timestamped transcripts", () => {
    const labelled = detectCandidateEvidenceKind({ text: transcript, mediaType: "text/plain" });
    expect(labelled.kind).toBe("transcript");
    expect(labelled.signals).toContain("speaker-turns");

    const stamped = detectCandidateEvidenceKind({
      text: timestampedTranscript,
      mediaType: "text/plain",
    });
    expect(stamped.kind).toBe("transcript");
    expect(stamped.signals).toEqual(expect.arrayContaining(["speaker-turns", "timestamps"]));
  });

  it("detects English and French performance reviews", () => {
    const english = detectCandidateEvidenceKind({
      text: englishReview,
      mediaType: "text/markdown",
    });
    expect(english.kind).toBe("performance-review");
    expect(english.signals).toContain("review-rating-language");

    const french = detectCandidateEvidenceKind({ text: frenchReview, mediaType: "text/plain" });
    expect(french.kind).toBe("performance-review");
  });

  it("detects Markdown and DOCX-normalized CVs", () => {
    const markdown = detectCandidateEvidenceKind({
      text: markdownCv,
      mediaType: "text/markdown",
      displayName: "alex-example-cv.md",
    });
    expect(markdown.kind).toBe("cv");
    expect(markdown.signals).toEqual(
      expect.arrayContaining(["cv-section-headings", "employment-date-ranges"]),
    );

    const docx = detectCandidateEvidenceKind({
      text: docxCv,
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(docx.kind).toBe("cv");
  });

  it("keeps a CV that links to LinkedIn a CV", () => {
    const text = `${markdownCv}\nlinkedin.com/in/alex-example`;
    expect(detectCandidateEvidenceKind({ text, mediaType: "text/markdown" }).kind).toBe("cv");
  });

  it("detects terse notes", () => {
    const result = detectCandidateEvidenceKind({ text: terseNotes, mediaType: "text/markdown" });
    expect(result.kind).toBe("notes");
    expect(result.signals).toContain("fragmentary-lines");
  });

  it("returns other for generic prose and short emails", () => {
    for (const text of [genericParagraph, shortEmail]) {
      const result = detectCandidateEvidenceKind({ text, mediaType: "text/plain" });
      expect(result.kind).toBe("other");
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    }
  });

  it("returns other with zero confidence for empty text", () => {
    for (const text of ["", "  \n\t\n"]) {
      expect(detectCandidateEvidenceKind({ text, mediaType: "text/plain" })).toEqual({
        kind: "other",
        confidence: 0,
        signals: ["empty-text"],
      });
    }
  });

  it("never lets a display name decide alone", () => {
    const result = detectCandidateEvidenceKind({
      text: genericParagraph,
      mediaType: "text/plain",
      displayName: "my-cv-linkedin-transcript-notes.txt",
    });
    expect(result.kind).toBe("other");
  });

  it("emits content-free signals and confidence within 0..1", () => {
    const secret = "Fictional Works Ltd";
    for (const text of [linkedinPdf, transcript, englishReview, markdownCv, terseNotes]) {
      const result = detectCandidateEvidenceKind({ text, mediaType: "text/plain" });
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      for (const signal of result.signals) {
        expect(signal).toMatch(/^[a-z-]+$/);
        expect(signal).not.toContain(secret.toLowerCase());
      }
    }
  });

  it("is deterministic and only analyses the start of long sources", () => {
    const input = { text: markdownCv, mediaType: "text/markdown", displayName: "cv.md" };
    expect(detectCandidateEvidenceKind(input)).toEqual(detectCandidateEvidenceKind(input));

    const padded = `${markdownCv}\n${"filler words here\n".repeat(5_000)}`;
    expect(detectCandidateEvidenceKind({ text: padded, mediaType: "text/markdown" }).kind).toBe(
      "cv",
    );
    const lateEvidence = `${"x".repeat(25_000)}\n${linkedinPdf}`;
    expect(
      detectCandidateEvidenceKind({ text: lateEvidence, mediaType: "application/pdf" }).kind,
    ).toBe("other");
  });
});
