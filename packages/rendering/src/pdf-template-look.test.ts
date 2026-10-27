import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  extractTextFromRenderedDocument,
  inspectControlledDocument,
  readPdfTextRuns,
  renderArtifact,
  validateAtsExtractability,
} from "./index.js";
import { fixtureGeneratedAt, sectionOf } from "./synthetic-cv.fixture.js";

/** A fictional CV whose summary and bullet wrap, so justified lines can be checked. */
const artifact: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-pdf-look",
  version: 1,
  parentVersionId: null,
  createdAt: fixtureGeneratedAt,
  language: "en",
  sections: [
    sectionOf("header", "header", 0, [
      { type: "paragraph", text: "Robin Placeholder, Platform Engineer" },
      { type: "paragraph", text: "Location: Sample City" },
    ]),
    sectionOf("summary", "summary", 1, [
      {
        type: "paragraph",
        text: "Engineer who builds calm, observable delivery pipelines for fictional retailers, with release tooling, on-call practice and platform documentation that teams can follow.",
      },
    ]),
    sectionOf("experience", "experience", 2, [
      {
        type: "paragraph",
        text: "Example Works | Staff Engineer | Jan 2021 to present, Sample City",
      },
      { type: "paragraph", text: "Internal developer platform for a fictional retailer." },
      {
        type: "bullet",
        text: "Cut release lead time from two days to four hours across eleven product teams by replacing manual sign-off with automated checks, staged rollouts and a shared release calendar.",
      },
    ]),
    sectionOf("skills", "skills", 3, [
      { type: "paragraph", text: "Delivery: continuous integration, release automation." },
    ]),
  ],
  claims: [],
  decisions: [],
};

const renderOptions = { generatedAt: fixtureGeneratedAt, allowUnbackedClaims: true };

function pdf(templateId: string) {
  const rendered = renderArtifact(artifact, "pdf", { ...renderOptions, templateId });
  const raw = new TextDecoder("latin1").decode(rendered.content);
  const stream = raw.match(/stream\r?\n([\s\S]*?)\r?\nendstream/gu)?.join("\n") ?? "";
  return { rendered, stream, runs: readPdfTextRuns(rendered.content) };
}

/** The run whose drawn text ends with `text`, as a viewer reads it. */
function runDrawing(drawing: ReturnType<typeof pdf>, text: string) {
  const run = drawing.runs.find((candidate) => candidate.text.endsWith(text));
  if (run === undefined) throw new Error(`no line draws ${text}`);
  return run;
}

/** The content-stream line whose drawn run ends with `text`. */
function lineDrawing(drawing: ReturnType<typeof pdf>, text: string): string {
  return runDrawing(drawing, text).line;
}

function xOf(line: string): number {
  return Number(line.match(/1 0 0 1 ([-0-9.]+) [-0-9.]+ Tm/u)?.[1]);
}

const mmToPt = 72 / 25.4;

describe("built-in PDF template looks", () => {
  const modern = pdf("modern");
  const classic = pdf("classic");

  it("draws Modern's name at the left margin and Classic's centred", () => {
    const name = "Robin Placeholder, Platform Engineer";
    expect(xOf(lineDrawing(modern, name))).toBeCloseTo(13 * mmToPt, 2);
    expect(xOf(lineDrawing(classic, name))).toBeGreaterThan(12 * mmToPt + 50);
  });

  it("draws Modern's headings capitalised in the accent, keeping the written text", () => {
    const heading = lineDrawing(modern, "EXPERIENCE");
    expect(runDrawing(modern, "EXPERIENCE").actualText).toBe("Experience");
    expect(heading).toContain("0.0588 0.4314 0.3608 rg");
    expect(modern.stream).toContain("0.0588 0.4314 0.3608 RG");
    expect(runDrawing(classic, "Experience").actualText).toBeNull();
  });

  it("justifies Modern's wrapped body lines but not their last line", () => {
    // Glyph-id text widens its spaces in a TJ array; word spacing applies to one-byte codes only.
    const spaced = modern.stream.split("\n").filter((line) => /\] TJ ET/u.test(line));
    expect(spaced.length).toBeGreaterThanOrEqual(2);
    expect(lineDrawing(modern, "a shared release calendar.")).not.toContain(" TJ ");
    expect(classic.stream).not.toContain(" TJ ");
  });

  it("slants and greys Modern's context line, and keeps Classic upright", () => {
    const context = lineDrawing(modern, "Internal developer platform for a fictional retailer.");
    expect(context).toMatch(/^q 1 0 0\.2000 1 /u);
    expect(context).toContain("0.2902 0.3333 0.3765 rg");
    expect(
      lineDrawing(classic, "Internal developer platform for a fictional retailer."),
    ).not.toContain(" cm ");
  });

  it("restores the fill colour after every coloured run", () => {
    for (const line of modern.stream.split("\n").filter((candidate) => / rg /u.test(candidate))) {
      expect(line).toMatch(/q [^\n]* rg [^\n]*Q( EMC)?$/u);
    }
  });

  it("keeps a labelled contact line's bold label", () => {
    for (const drawing of [modern, classic]) {
      expect(lineDrawing(drawing, "Location:")).toMatch(/^\/DLLabel BMC .*\/F3 /u);
    }
  });

  it("reads back the same text as Classic and passes the rendering checks", () => {
    const observation = inspectControlledDocument(modern.rendered);
    expect(observation.recoveredVisibleContentChecksum).toBe(
      inspectControlledDocument(classic.rendered).recoveredVisibleContentChecksum,
    );
    expect(observation.clippedText).toBe(false);
    expect(validateAtsExtractability(modern.rendered, artifact).passed).toBe(true);
    // A justified bullet draws its prefix as its own run, which reads back with one more space.
    const words = (rendered: typeof modern.rendered): string =>
      extractTextFromRenderedDocument(rendered).replace(/\s+/gu, " ");
    expect(words(modern.rendered)).toBe(words(classic.rendered));
  });
});
