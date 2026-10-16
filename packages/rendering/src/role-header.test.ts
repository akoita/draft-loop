import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  blockHeightPt,
  estimateDocumentLength,
  layoutBlocks,
  layoutMetrics,
  roleHeaderLines,
  textWidthPt,
} from "./document-layout.js";
import {
  buildRenderingQaReport,
  extractTextFromRenderedDocument,
  inspectControlledDocument,
  renderArtifact,
  renderHtml,
  renderingLayoutProfiles,
} from "./index.js";
import { decodePdfLiteralEscapes } from "./pdf-document.js";
import { isDateRange, splitRoleHeader } from "./role-header.js";
import {
  fixtureGeneratedAt as generatedAt,
  roleLine,
  sectionOf,
  syntheticCv,
  wordCount,
} from "./synthetic-cv.fixture.js";

const standard = renderingLayoutProfiles["standard-two-page"];
const compact = renderingLayoutProfiles["compact-one-page"];

function cvWithRole(roleText: string): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-role",
    version: 1,
    parentVersionId: null,
    createdAt: generatedAt,
    language: "en",
    sections: [
      sectionOf("summary", "summary", 0, [{ type: "paragraph", text: "A short summary." }]),
      sectionOf("experience", "experience", 1, [
        { type: "paragraph", text: roleText },
        { type: "bullet", text: "Delivered the first milestone." },
        { type: "paragraph", text: "Example Employer 2 | Engineer | 2015 - 2018" },
        { type: "bullet", text: "Delivered the second milestone." },
      ]),
    ],
    claims: [],
    decisions: [],
  };
}

const pdfText = (content: Uint8Array): string => Buffer.from(content).toString("latin1");

interface PdfRun {
  readonly font: string;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

function pdfRuns(content: Uint8Array): readonly PdfRun[] {
  return [
    ...pdfText(content).matchAll(
      /BT \/(F\d) ([\d.]+) Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(((?:\\.|[^()])*)\) Tj ET/gu,
    ),
  ].map((match) => ({
    font: match[1] ?? "",
    size: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
    text: decodePdfLiteralEscapes(match[5] ?? ""),
  }));
}

function qaPasses(artifact: DraftArtifact, format: "pdf" | "docx") {
  const rendered = renderArtifact(artifact, format, { generatedAt });
  const report = buildRenderingQaReport({
    artifact,
    rendered,
    createdAt: generatedAt,
    viewerObservation: inspectControlledDocument(rendered),
  });
  return { rendered, report };
}

function docxDocumentXml(content: Uint8Array): string {
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

describe("role header splitting", () => {
  it("splits a trailing date range from the rest of the line", () => {
    expect(splitRoleHeader("Employer | Title | Jun 2024 to present")).toEqual({
      left: "Employer | Title",
      date: "Jun 2024 to present",
    });
    expect(splitRoleHeader("Employer | Title | 2019 - 2022")?.date).toBe("2019 - 2022");
    expect(splitRoleHeader("Employer | Title | Jan 2020 to Mar 2021, Paris")).toEqual({
      left: "Employer | Title",
      date: "Jan 2020 to Mar 2021, Paris",
    });
    expect(splitRoleHeader("Employer | 2016 – 2019")?.left).toBe("Employer");
  });

  it("does not split when the last segment is not a date range", () => {
    expect(splitRoleHeader("Employer | Title")).toBeNull();
    expect(splitRoleHeader("Employer | Title | Paris")).toBeNull();
    expect(splitRoleHeader("Employer Title 2019 - 2022")).toBeNull();
    expect(splitRoleHeader("Employer | Title | 2022")).toBeNull();
    expect(splitRoleHeader("Employer | Title | Team of 5 to 12 engineers")).toBeNull();
    expect(isDateRange("Version 3 to 4")).toBe(false);
  });

  it("lays a date line out with the date on the same line as the left part", () => {
    const block = {
      kind: "role" as const,
      text: "Example Employer | Senior Engineer | Jun 2024 to present",
    };
    expect(roleHeaderLines(block, standard)).toEqual({
      lines: ["Example Employer | Senior Engineer"],
      date: "Jun 2024 to present",
    });
  });

  it("keeps the whole line bold and unsplit when there is no date range", () => {
    const block = { kind: "role" as const, text: "Example Employer | Senior Engineer" };
    expect(roleHeaderLines(block, standard)).toEqual({
      lines: ["Example Employer | Senior Engineer"],
      date: null,
    });
  });

  it("wraps an over-long left part and keeps the date on its last line", () => {
    const left = Array.from({ length: 40 }, (_, index) => `Division${index}`).join(" ");
    const layout = roleHeaderLines(
      { kind: "role", text: `${left} | Jan 2020 to Mar 2021, Paris` },
      standard,
    );
    expect(layout.date).toBe("Jan 2020 to Mar 2021, Paris");
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.join(" ")).toBe(left);
  });

  it("falls back to plain bold wrapping when a word cannot share a line with the date", () => {
    const unbreakable = "x".repeat(150);
    const layout = roleHeaderLines(
      { kind: "role", text: `${unbreakable} | Jun 2024 to present` },
      standard,
    );
    expect(layout.date).toBeNull();
    expect(layout.lines.join(" ")).toBe(`${unbreakable} | Jun 2024 to present`);
  });
});

describe("role header blocks", () => {
  it("marks a paragraph directly followed by bullets in experience and projects only", () => {
    const blocks = layoutBlocks(cvWithRole("Example Employer 1 | Lead | 2018 - 2020"));
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "role",
      "bullet",
      "role",
      "bullet",
    ]);
    const summaryOnly = layoutBlocks({
      ...cvWithRole("x"),
      sections: [
        sectionOf("summary", "summary", 0, [{ type: "paragraph", text: "A | 2019 - 2020" }]),
      ],
    });
    expect(summaryOnly.map((block) => block.kind)).toEqual(["heading", "paragraph"]);
  });

  it("adds space before a role except directly under a section heading", () => {
    const [, , , first, , second] = layoutBlocks(
      cvWithRole("Example Employer 1 | Lead | 2018 - 2020"),
    );
    const metrics = layoutMetrics(standard);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    const afterHeading = blockHeightPt(first, standard, { kind: "heading", text: "Experience" });
    const afterBullet = blockHeightPt(second, standard, { kind: "bullet", text: "x" });
    expect(afterBullet - afterHeading).toBeCloseTo(metrics.roleBeforePt, 5);
    expect(metrics.roleBeforePt).toBeGreaterThanOrEqual(5);
    expect(metrics.roleBeforePt).toBeLessThanOrEqual(6);
    expect(metrics.blockAfterPt).toBeLessThanOrEqual(1);
  });

  it("counts the extra spacing in the length estimate", () => {
    const cv = syntheticCv(1.05, 6);
    const blocks = layoutBlocks(cv);
    const total = (list: typeof blocks): number =>
      list.reduce((sum, block, index) => sum + blockHeightPt(block, standard, list[index - 1]), 0);
    const plain = blocks.map((block) =>
      block.kind === "role" ? { ...block, kind: "paragraph" as const } : block,
    );
    // Six roles, the first of which sits directly under the Experience heading.
    expect(total(blocks) - total(plain)).toBeCloseTo(5 * layoutMetrics(standard).roleBeforePt, 5);
    expect(estimateDocumentLength(cv, standard).estimatedPages).toBeGreaterThan(0);
  });
});

describe("role headers in the PDF", () => {
  const artifact = cvWithRole("Example Employer 1 | Lead Engineer | Jun 2024 to present");

  it("draws the role bold and the date right-aligned to the content edge", () => {
    const { rendered } = qaPasses(artifact, "pdf");
    const runs = pdfRuns(rendered.content);
    const role = runs.find((run) => run.text === "Example Employer 1 | Lead Engineer");
    const date = runs.find((run) => run.text === "Jun 2024 to present");
    expect(role?.font).toBe("F3");
    expect(date?.font).toBe("F1");
    expect(date?.y).toBe(role?.y);
    const rightEdge = 210 * (72 / 25.4) - standard.marginsMm.right * (72 / 25.4);
    const dateWidth = textWidthPt(
      "Jun 2024 to present",
      standard.typography.bodyFontSizePt,
      false,
      "carlito",
    );
    expect(Math.abs((date?.x ?? 0) + dateWidth - rightEdge)).toBeLessThan(1);
    expect(role?.x).toBeCloseTo(standard.marginsMm.left * (72 / 25.4), 3);
  });

  it("keeps the content, the sections and the QA report intact, and embeds the bold font once", () => {
    const { rendered, report } = qaPasses(artifact, "pdf");
    expect(report.passed).toBe(true);
    expect(report.contentIntegrity.visibleContentMatches).toBe(true);
    expect(report.contentIntegrity.sectionOrderMatches).toBe(true);
    expect(report.contentIntegrity.blockOrderMatches).toBe(true);
    expect(extractTextFromRenderedDocument(rendered)).toContain(
      "Example Employer 1 | Lead Engineer | Jun 2024 to present",
    );
    const raw = pdfText(rendered.content);
    expect(raw).toContain("/F3 4 0 R");
    expect([...raw.matchAll(/\/FontFile2 \d+ 0 R/gu)]).toHaveLength(2);
    // Role headers are not headings: only the title-less sections' F2 headings exist.
    const headings = pdfRuns(rendered.content).filter((run) => run.font === "F2");
    expect(headings.map((run) => run.text)).toEqual(["Summary", "Experience"]);
  });

  it("flags a role date that runs past the right margin", () => {
    const { rendered } = qaPasses(artifact, "pdf");
    const raw = pdfText(rendered.content);
    const shifted = raw.replace(/(\/F1 9 Tf 1 0 0 1 )[\d.]+( [\d.]+ Tm \(Jun 2024)/u, "$1560$2");
    expect(shifted).not.toBe(raw);
    const bytes = Uint8Array.from(Buffer.from(shifted, "latin1"));
    const tampered = {
      ...rendered,
      content: bytes,
      metadata: {
        ...rendered.metadata,
        checksum: createHash("sha256").update(bytes).digest("hex"),
      },
    };
    expect(inspectControlledDocument(tampered).clippedText).toBe(true);
  });

  it("wraps an over-long role and passes the QA checks", () => {
    const left = Array.from({ length: 40 }, (_, index) => `Division${index}`).join(" ");
    const long = cvWithRole(`${left} | Jan 2020 to Mar 2021, Paris`);
    const { rendered, report } = qaPasses(long, "pdf");
    expect(report.passed).toBe(true);
    const runs = pdfRuns(rendered.content);
    const date = runs.find((run) => run.text === "Jan 2020 to Mar 2021, Paris");
    const roleRuns = runs.filter((run) => run.font === "F3" && run.y === date?.y);
    expect(roleRuns).toHaveLength(1);
    expect(runs.filter((run) => run.font === "F3").length).toBeGreaterThan(3);
  });

  it("renders the compact one-page profile with role headers", () => {
    const rendered = renderArtifact(artifact, "pdf", {
      generatedAt,
      layoutProfile: "compact-one-page",
    });
    const runs = pdfRuns(rendered.content);
    expect(runs.find((run) => run.text.startsWith("Example Employer 1"))?.font).toBe("F3");
    const report = buildRenderingQaReport({
      artifact,
      rendered,
      createdAt: generatedAt,
      viewerObservation: inspectControlledDocument(rendered),
    });
    expect(report.passed).toBe(true);
    expect(compact.spacingPt.roleBeforePt).toBeGreaterThan(0);
  });
});

describe("role headers in the DOCX and the HTML preview", () => {
  const artifact = cvWithRole("Example Employer 1 | Lead Engineer | Jun 2024 to present");

  it("writes a bold run, a right tab stop and the dates after the tab", () => {
    const { rendered, report } = qaPasses(artifact, "docx");
    expect(report.passed).toBe(true);
    const xml = docxDocumentXml(rendered.content);
    expect(xml).toContain('<w:pStyle w:val="Role"/>');
    expect(xml).toMatch(/<w:tab w:val="right" w:pos="\d+"\/>/u);
    expect(xml).toContain(
      '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Example Employer 1 | Lead Engineer</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">Jun 2024 to present</w:t></w:r>',
    );
    expect(extractTextFromRenderedDocument(rendered)).toContain(
      "Example Employer 1 | Lead Engineer | Jun 2024 to present",
    );
    // The first role under the heading has no extra space; the second one does.
    expect(xml.match(/<w:spacing w:before="0"\/>/gu)).toHaveLength(1);
  });

  it("writes a role line without a date as a single bold run without a tab", () => {
    const { rendered, report } = qaPasses(cvWithRole("Example Employer 1 | Lead Engineer"), "docx");
    expect(report.passed).toBe(true);
    const xml = docxDocumentXml(rendered.content);
    expect(xml).toContain(
      '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Example Employer 1 | Lead Engineer</w:t></w:r>',
    );
  });

  it("marks the role in the HTML preview and right-aligns the date with CSS", () => {
    const html = renderHtml(artifact);
    expect(html).toContain(
      '<p class="role"><span>Example Employer 1 | Lead Engineer</span><span class="separator"> | </span><span class="date">Jun 2024 to present</span></p>',
    );
    expect(html).toContain("p.role { display: flex; justify-content: space-between;");
    expect(html).toContain(`margin-top: ${standard.previewSpacingPt.roleBefore}pt`);
  });
});

describe("the acceptance CV with role headers", () => {
  it.each([
    [6, 1.05],
    [7, 0.94],
  ])("still fits two pages with %i roles and passes QA", (roles, scale) => {
    const cv = syntheticCv(scale, roles);
    expect(wordCount(cv)).toBeGreaterThan(1650);
    expect(wordCount(cv)).toBeLessThan(1900);
    expect(layoutBlocks(cv).filter((block) => block.kind === "role")).toHaveLength(roles);
    expect(layoutBlocks(cv).find((block) => block.kind === "role")?.text).toBe(roleLine(0));
    const { rendered, report } = qaPasses(cv, "pdf");
    const observation = inspectControlledDocument(rendered);
    expect(observation.pageCount).toBe(2);
    expect(observation.clippedText).toBe(false);
    expect(report.passed).toBe(true);
  });
});
