import { inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import {
  applicationMaterialArtifact,
  renderApplicationMaterialDocument,
} from "./application-material-document.js";
import { readPdfTextRuns, renderPrintHtml } from "./index.js";
import { splitProseInlineLabel, splitSectionInlineLabel } from "./inline-label.js";

/** A guide whose prose opens sentences with "Salary:" and whose sources are long lines (#2850). */
const guide = {
  id: "amd_guidefixture01",
  kind: "interview-guide" as const,
  title: "Data Analyst at Example Co",
  language: "en",
  createdAt: "2026-11-08T03:00:00.000Z",
  items: [
    {
      section: "practical",
      question: "",
      text: "Salary: ask for the band before the second round, and keep the figure to yourself.",
    },
    {
      section: "questions",
      question: "Describe what you did: the reporting rebuild",
      text: "Start from the finance team's deadline.",
      trap: "Do not promise a delivery date.",
    },
    {
      section: "sources",
      question: "",
      text: "Example Co annual report, a very long invented title that wraps onto a second line of the page: https://example.com/reports/annual-report-with-a-long-path",
    },
    {
      section: "sources",
      question: "",
      text: "Example Co engineering blog, another long invented title that also wraps past the width of the page: https://example.com/blog/a-long-invented-post",
    },
  ],
};

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

describe("labels and alignment in letters and guides (#2850)", () => {
  it("keeps only the renderer's own labels in prose", () => {
    expect(splitProseInlineLabel("Salary: ask for the band.")).toBeNull();
    expect(splitProseInlineLabel("Avoid: a promise.")?.label).toBe("Avoid:");
    expect(splitProseInlineLabel("À éviter : une promesse.")?.label).toBe("À éviter :");
    expect(splitSectionInlineLabel("skills", "Cloud: GCP, AWS")?.label).toBe("Cloud:");
    expect(splitSectionInlineLabel("answer", "Cloud: GCP, AWS")).toBeNull();
  });

  it("draws no accidental bold label in the PDF, and keeps the trap's", () => {
    const pdf = renderApplicationMaterialDocument(guide, "pdf", { templateId: "modern" });
    const labels = readPdfTextRuns(pdf.content)
      .filter((run) => run.marked === "DLLabel")
      .map((run) => run.text);
    expect(labels).toEqual(["Avoid:"]);
  });

  it("leaves the sources list left-aligned and unbolded in Word", () => {
    const docx = renderApplicationMaterialDocument(guide, "docx", { templateId: "modern" });
    const xml = documentXml(docx.content);
    expect(xml).not.toContain('<w:t xml:space="preserve">Salary:</w:t>');
    const bullets = xml.split("<w:p>").filter((paragraph) => paragraph.includes("ListBullet"));
    expect(bullets).toHaveLength(2);
    for (const bullet of bullets) expect(bullet).toContain('<w:jc w:val="left"/>');
    expect(xml).toMatch(/<w:b\/>.*Avoid:/u);
  });

  it("marks the sources list plain and bolds only the trap in the print view", () => {
    const html = renderPrintHtml(applicationMaterialArtifact(guide), { templateId: "modern" });
    expect(html).not.toContain("<strong>Salary:</strong>");
    expect(html).not.toContain("<strong>Describe what you did:</strong>");
    expect(html).toContain("<strong>Avoid:</strong>");
    expect(html).toContain('<li class="plain"');
    expect(html).toContain("li:not(.plain){text-align:justify;}");
  });
});
