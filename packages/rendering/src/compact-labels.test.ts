import { inflateRawSync } from "node:zlib";

import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { findCompactRuns, minCompactListItems, splitCompactText } from "./compact-list.js";
import { blockLines, layoutBlocks } from "./document-layout.js";
import {
  buildRenderingQaReport,
  inspectControlledDocument,
  type OutputFormat,
  readPdfTextRuns,
  renderArtifact,
  renderHtml,
  renderingLayoutProfiles,
} from "./index.js";
import { splitInlineLabel } from "./inline-label.js";
import {
  fixtureGeneratedAt as generatedAt,
  sectionOf,
  syntheticCv,
} from "./synthetic-cv.fixture.js";

const standard = renderingLayoutProfiles["standard-two-page"];
type Blocks = readonly { type: "paragraph" | "bullet"; text: string }[];

function cv(experience: Blocks, certifications: Blocks = []): DraftArtifact {
  return {
    ...syntheticCv(1),
    id: "artifact-compact",
    sections: [
      sectionOf("header", "header", 0, [
        { type: "paragraph", text: "Alex Example, Senior Platform Engineer" },
        { type: "paragraph", text: "Sample City | alex@example.test" },
      ]),
      sectionOf("summary", "summary", 1, [{ type: "paragraph", text: "A short summary." }]),
      sectionOf("experience", "experience", 2, experience),
      ...(certifications.length === 0
        ? []
        : [sectionOf("certifications", "certifications", 3, certifications)]),
    ],
  };
}

const bullets = (...texts: string[]): Blocks => texts.map((text) => ({ type: "bullet", text }));
const certs = (count: number): Blocks =>
  bullets(...Array.from({ length: count }, (_, index) => `Example Certificate ${index + 1}`));
/** The block kinds under one section heading, which is "Experience" unless given. */
function kindsOf(artifact: DraftArtifact, title = "Experience"): string[] {
  const blocks = layoutBlocks(artifact, standard);
  const start = blocks.findIndex((block) => block.kind === "heading" && block.text === title);
  const rest = blocks.slice(start + 1);
  const end = rest.findIndex((block) => block.kind === "heading");
  return (end < 0 ? rest : rest.slice(0, end)).map((block) => block.kind);
}

interface PdfRun {
  readonly font: string;
  readonly text: string;
  readonly marked: string | null;
}

function pdfRuns(content: Uint8Array): PdfRun[] {
  return readPdfTextRuns(content).map((run) => ({
    marked: run.marked,
    font: run.font,
    text: run.text,
  }));
}

function documentXml(content: Uint8Array): string {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(content.subarray(nameStart, nameStart + nameLength));
    const data = content.subarray(dataStart, dataStart + size);
    if (name === "word/document.xml") {
      return new TextDecoder().decode(method === 8 ? new Uint8Array(inflateRawSync(data)) : data);
    }
    offset = dataStart + size;
  }
  throw new Error("word/document.xml not found");
}

function qa(artifact: DraftArtifact, format: "pdf" | "docx", rendered = artifact) {
  const original = renderArtifact(artifact, format as OutputFormat, { generatedAt });
  const swapped = renderArtifact(rendered, format as OutputFormat, { generatedAt });
  // A document rendered from other content, claiming the artifact's own source checksum.
  const document = {
    ...swapped,
    metadata: {
      ...swapped.metadata,
      sourceContentChecksum: original.metadata.sourceContentChecksum,
    },
  };
  const observation = inspectControlledDocument(document);
  const report = buildRenderingQaReport({
    artifact,
    rendered: document,
    createdAt: generatedAt,
    viewerObservation: observation,
  });
  return { document, observation, report };
}

describe("role detection with a context paragraph", () => {
  const roleText = "Example Employer | Senior Engineer | Jun 2024 to present";
  const context = "Led a small platform group for an invented payments product.";

  it("treats a pipe line followed by a plain paragraph as a role and that paragraph as context", () => {
    const withContext = cv([
      { type: "paragraph", text: roleText },
      { type: "paragraph", text: context },
      { type: "bullet", text: "Delivered the first milestone." },
      { type: "bullet", text: "Delivered the second milestone." },
    ]);
    expect(kindsOf(withContext)).toEqual(["role", "paragraph", "bullet", "bullet"]);
  });

  it("keeps a role with no context paragraph, and the pipe-less fallback", () => {
    const withoutContext = cv([
      { type: "paragraph", text: roleText },
      { type: "bullet", text: "Delivered the first milestone." },
    ]);
    expect(kindsOf(withoutContext)).toEqual(["role", "bullet"]);
    const pipeless = cv([
      { type: "paragraph", text: "Senior Engineer at Example Employer, 2020 to 2022" },
      { type: "bullet", text: "Delivered the first milestone." },
    ]);
    expect(kindsOf(pipeless)).toEqual(["role", "bullet"]);
  });

  it("does not make a pipe line a role without a following paragraph or bullet", () => {
    const lonely = cv([{ type: "paragraph", text: roleText }]);
    expect(kindsOf(lonely)).toEqual(["paragraph"]);
    const consecutive = cv([
      { type: "paragraph", text: roleText },
      { type: "paragraph", text: "Other Employer | Engineer | 2019 - 2021" },
      { type: "bullet", text: "Delivered the first milestone." },
    ]);
    expect(kindsOf(consecutive)).toEqual(["paragraph", "role", "bullet"]);
  });

  it("draws the role bold and the context paragraph regular, and passes QA in PDF and DOCX", () => {
    const artifact = cv([
      { type: "paragraph", text: roleText },
      { type: "paragraph", text: context },
      { type: "bullet", text: "Delivered the first milestone." },
      { type: "bullet", text: "Delivered the second milestone." },
    ]);
    const pdf = qa(artifact, "pdf");
    const runs = pdfRuns(pdf.document.content);
    expect(runs.find((run) => run.text === "Example Employer | Senior Engineer")?.font).toBe("F3");
    expect(runs.find((run) => run.text === context)?.font).toBe("F1");
    expect(pdf.report.passed).toBe(true);
    const xml = documentXml(qa(artifact, "docx").document.content);
    expect(xml).toMatch(/<w:pStyle w:val="Normal"\/><\/w:pPr><w:r><w:t[^>]*>Led a small/u);
    expect(qa(artifact, "docx").report.passed).toBe(true);
  });
});

function withSkills(blocks: Blocks): DraftArtifact {
  const base = cv([]);
  const header = base.sections[0];
  if (header === undefined) throw new Error("missing header");
  return { ...base, sections: [header, sectionOf("skills", "skills", 1, blocks)] };
}

describe("inline labels", () => {
  it("detects a short label before a colon", () => {
    expect(splitInlineLabel("Blockchain: Solidity, tooling and audits")).toEqual({
      label: "Blockchain:",
      rest: " Solidity, tooling and audits",
    });
    expect(splitInlineLabel("Programming languages and tools: one two")?.label).toBe(
      "Programming languages and tools:",
    );
    expect(splitInlineLabel("Cloud 2: three")?.label).toBe("Cloud 2:");
  });

  it("rejects URL schemes, numbers, times, long labels and missing text", () => {
    expect(splitInlineLabel("https: //example.test/path")).toBeNull();
    expect(splitInlineLabel("https://example.test/path")).toBeNull();
    expect(splitInlineLabel("10:30 daily standup")).toBeNull();
    expect(splitInlineLabel("2024: a good year")).toBeNull();
    expect(splitInlineLabel("one two three four five six: too many words")).toBeNull();
    expect(splitInlineLabel(`${"x".repeat(41)}: too long`)).toBeNull();
    expect(splitInlineLabel("No colon here")).toBeNull();
    expect(splitInlineLabel("Label:")).toBeNull();
    expect(splitInlineLabel("Label:no space")).toBeNull();
  });

  const labelled = withSkills([
    {
      type: "paragraph",
      text: "Blockchain: Solidity, audits and protocol tooling for invented ledgers.",
    },
    {
      type: "bullet",
      text: "Domains: payments and settlement, plus a rather long tail of invented tooling notes that wraps onto a second line because it keeps going past the width of the page for this test.",
    },
    { type: "bullet", text: "Plain bullet without any label." },
  ]);

  it("draws the label bold and the rest regular on the same line in the PDF", () => {
    const { document, report, observation } = qa(labelled, "pdf");
    const runs = pdfRuns(document.content);
    const paragraphLabel = runs.find((run) => run.text === "Blockchain:");
    expect(paragraphLabel).toMatchObject({ font: "F3", marked: "DLLabel" });
    expect(runs.find((run) => run.text.startsWith("Solidity, audits"))?.font).toBe("F1");
    expect(runs.find((run) => run.text === "Domains:")).toMatchObject({ font: "F3" });
    expect(runs.filter((run) => run.font === "F2").map((run) => run.text)).toEqual([
      "Alex Example, Senior Platform Engineer",
      "Skills",
    ]);
    expect(observation.clippedText).toBe(false);
    expect(report.passed).toBe(true);
    expect(report.contentIntegrity.visibleContentMatches).toBe(true);
    expect(report.contentIntegrity.blockOrderMatches).toBe(true);
  });

  it("measures the bold label when wrapping", () => {
    const lines = labelled.sections[1]?.blocks.map((block) => block.text) ?? [];
    const block = { kind: "bullet" as const, text: lines[1] ?? "" };
    const wrapped = blockLines(block, standard);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped[0]?.startsWith("Domains: ")).toBe(true);
    expect(wrapped.join(" ")).toBe(block.text);
  });

  it("draws a bold run in the DOCX and a strong element in the HTML", () => {
    const xml = documentXml(qa(labelled, "docx").document.content);
    expect(xml).toContain(
      `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Blockchain:</w:t></w:r><w:r><w:t xml:space="preserve"> Solidity`,
    );
    expect(qa(labelled, "docx").report.passed).toBe(true);
    const html = renderHtml(labelled);
    expect(html).toContain("<p><strong>Blockchain:</strong> Solidity");
    expect(html).toContain("<li><strong>Domains:</strong> payments");
    expect(html).toContain("<li>Plain bullet without any label.</li>");
  });
});

describe("compact lists", () => {
  it("compacts a run of the minimum number of one-line bullets, and no fewer", () => {
    expect(minCompactListItems).toBe(3);
    const three = cv([], certs(3));
    expect(kindsOf(three, "Certifications")).toContain("compact");
    expect(kindsOf(three, "Certifications")).not.toContain("bullet");
    const two = cv([], certs(2));
    expect(kindsOf(two, "Certifications")).toContain("bullet");
    expect(kindsOf(two, "Certifications")).not.toContain("compact");
  });

  it("keeps bullets when a multi-line bullet breaks the run", () => {
    const longBullet = `${"A rather long invented achievement ".repeat(8)}ends here.`;
    const split = cv(
      [],
      bullets(
        "Example Certificate 1",
        "Example Certificate 2",
        longBullet,
        "Example Certificate 3",
      ),
    );
    expect(kindsOf(split, "Certifications")).toEqual(["bullet", "bullet", "bullet", "bullet"]);
    const trailing = cv(
      [],
      bullets(
        "Example Certificate 1",
        "Example Certificate 2",
        "Example Certificate 3",
        longBullet,
      ),
    );
    expect(kindsOf(trailing, "Certifications")).toEqual(["compact", "bullet"]);
  });

  it("leaves bullets that already contain the separator alone", () => {
    const runs = findCompactRuns(
      [
        { type: "bullet", text: "One" },
        { type: "bullet", text: "Two · inside" },
        { type: "bullet", text: "Three" },
        { type: "bullet", text: "Four" },
      ],
      () => true,
    );
    expect(runs).toEqual([]);
    expect(splitCompactText("One · Two ·\nThree")).toEqual(["One", "Two", "Three"]);
  });

  it("keeps labelled one-line bullets on their own lines", () => {
    const runs = findCompactRuns(
      [
        { type: "bullet", text: "Blockchain: Solidity, Foundry" },
        { type: "bullet", text: "Cloud: Cloud Run, Cloud SQL" },
        { type: "bullet", text: "Data: dbt, BigQuery" },
      ],
      () => true,
    );
    expect(runs).toEqual([]);
  });

  const twenty = cv([], certs(20));

  it("draws 20 one-line certifications as one paragraph of a few lines in PDF, DOCX and HTML", () => {
    const compactBlock = layoutBlocks(twenty, standard).find((block) => block.kind === "compact");
    expect(compactBlock?.items).toHaveLength(20);
    const lineCount = blockLines(compactBlock ?? { kind: "compact", text: "" }, standard).length;
    expect(lineCount).toBeGreaterThan(1);
    expect(lineCount).toBeLessThanOrEqual(4);

    const pdf = qa(twenty, "pdf");
    const pdfRunsOut = pdfRuns(pdf.document.content);
    expect(pdfRunsOut.filter((run) => run.marked === "DLCompact")).toHaveLength(lineCount);
    expect(pdfRunsOut.some((run) => run.text.includes("•"))).toBe(false);
    expect(pdfRunsOut.some((run) => run.text.includes("Example Certificate 1 · Example"))).toBe(
      true,
    );
    expect(pdf.report.passed).toBe(true);

    const docx = qa(twenty, "docx");
    const xml = documentXml(docx.document.content);
    expect(xml.match(/<w:pStyle w:val="CompactList"\/>/gu)).toHaveLength(1);
    expect(xml).not.toContain("ListBullet");
    expect(docx.report.passed).toBe(true);

    const html = renderHtml(twenty);
    expect(html.match(/<p class="compact">/gu)).toHaveLength(1);
    expect(html).toContain("Example Certificate 19 · Example Certificate 20");
    expect(html).not.toContain("<li>Example Certificate");
  });

  it("recovers every bullet in order, so content, block order and section order pass", () => {
    for (const format of ["pdf", "docx"] as const) {
      const { report } = qa(twenty, format);
      expect(report.contentIntegrity.visibleContentMatches).toBe(true);
      expect(report.contentIntegrity.blockOrderMatches).toBe(true);
      expect(report.contentIntegrity.sectionOrderMatches).toBe(true);
      expect(report.passed).toBe(true);
    }
  });

  it("still detects a dropped item", () => {
    const dropped = cv(
      [],
      certs(20).filter((_, index) => index !== 7),
    );
    for (const format of ["pdf", "docx"] as const) {
      const { report } = qa(twenty, format, dropped);
      expect(report.contentIntegrity.visibleContentMatches).toBe(false);
      expect(report.passed).toBe(false);
    }
  });

  it("saves lines against the bullet stack and keeps the length estimate in step", () => {
    const stackLines = certs(20).length;
    const compactLines = layoutBlocks(twenty, standard)
      .filter((block) => block.kind === "compact")
      .flatMap((block) => blockLines(block, standard)).length;
    expect(compactLines).toBeLessThan(stackLines / 3);
  });
});
