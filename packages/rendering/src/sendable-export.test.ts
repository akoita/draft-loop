import { inflateRawSync } from "node:zlib";

import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  blockLines,
  bulletPrefixWidthPt,
  contentWidthPt,
  estimateDocumentLength,
  extractTextFromRenderedDocument,
  inspectControlledDocument,
  renderArtifact,
  renderingLayoutProfiles,
  textWidthPt,
} from "./index.js";

const generatedAt = "2026-10-15T09:00:00.000Z";
const profile = renderingLayoutProfiles["standard-two-page"];

function block(id: string, type: "paragraph" | "bullet", text: string) {
  return { id, type, text, claimIds: id === "block-exp-2" ? ["claim-block-exp-2"] : [] } as const;
}

const cv: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-sendable",
  version: 3,
  parentVersionId: null,
  createdAt: "2026-10-15T08:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "section-experience",
      title: "Experience",
      kind: "experience",
      order: 2,
      blocks: [
        block("block-exp-1", "paragraph", "Northwind Analytics | Senior Engineer | 2019 - 2024"),
        block("block-exp-2", "bullet", "Cut report latency by 40% & halved the on-call load."),
        block("block-exp-3", "bullet", "Led a team of 5 <engineers> across two time zones."),
      ],
    },
    {
      id: "section-header",
      title: "Header",
      kind: "header",
      order: 0,
      blocks: [
        block("block-head-1", "paragraph", "Jane Q. Example, Staff Platform Engineer"),
        block("block-head-2", "paragraph", "jane@example.test | +44 20 7946 0000 | London"),
      ],
    },
    {
      id: "section-summary",
      title: "Summary",
      kind: "summary",
      order: 1,
      blocks: [block("block-sum-1", "paragraph", "Platform engineer with José's café roots.")],
    },
    {
      id: "section-skills",
      title: "Skills",
      kind: "skills",
      order: 3,
      blocks: [block("block-skill-1", "bullet", "TypeScript, Postgres, Kubernetes")],
    },
  ],
  claims: [
    {
      id: "claim-block-exp-2",
      text: "Cut report latency by 40%",
      sectionId: "section-experience",
      blockId: "block-exp-2",
      status: "verified",
      substantive: true,
      evidence: [
        {
          sourcePath: "/local/chunk-secret/resume.md",
          sourceChecksum: "a".repeat(64),
          locator: "line:4-5",
          excerpt: "chunk-secret excerpt",
        },
      ],
    },
  ],
  decisions: [],
} as unknown as DraftArtifact;

function unzipStored(content: Uint8Array): ReadonlyMap<string, string> {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const entries = new Map<string, string>();
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
    entries.set(
      name,
      new TextDecoder().decode(method === 8 ? new Uint8Array(inflateRawSync(data)) : data),
    );
    offset = dataStart + size;
  }
  return entries;
}

function wordTextRuns(documentXml: string): string[] {
  return [...documentXml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/gu)].map((paragraph) =>
    [...(paragraph[1] ?? "").matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gu)]
      .map((run) => run[1] ?? "")
      .join("")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
}

describe("sendable DOCX export", () => {
  const docx = renderArtifact(cv, "docx", { generatedAt });
  const parts = unzipStored(docx.content);
  const documentXml = parts.get("word/document.xml") ?? "";

  it("draws the headline and contact header, then the sections in order", () => {
    expect(wordTextRuns(documentXml)).toEqual([
      "Jane Q. Example, Staff Platform Engineer",
      "jane@example.test | +44 20 7946 0000 | London",
      "Summary",
      "Platform engineer with José's café roots.",
      "Experience",
      "Northwind Analytics | Senior Engineer | 2019 - 2024",
      "Cut report latency by 40% & halved the on-call load.",
      "Led a team of 5 <engineers> across two time zones.",
      "Skills",
      "TypeScript, Postgres, Kubernetes",
    ]);
    const styles = [...documentXml.matchAll(/<w:pStyle w:val="([^"]+)"/gu)].map((m) => m[1]);
    expect(styles).toEqual([
      "Title",
      "Contact",
      "Heading1",
      "Normal",
      "Heading1",
      "Normal",
      "ListBullet",
      "ListBullet",
      "Heading1",
      "ListBullet",
    ]);
  });

  it("uses a standard font, A4 margins and a real bullet list without tables or text boxes", () => {
    const styles = parts.get("word/styles.xml") ?? "";
    expect(styles).toContain('w:ascii="Calibri"');
    expect(styles).toContain('w:styleId="Heading1"');
    expect(parts.get("word/numbering.xml")).toContain('w:numFmt w:val="bullet"');
    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(documentXml).toContain("<w:pgMar");
    for (const part of parts.values()) {
      expect(part).not.toMatch(/<w:tbl\b|<w:txbxContent|<w:drawing|<w:pict|<w:comment/u);
    }
    expect([...parts.keys()].some((name) => /comments|header|footer|media/u.test(name))).toBe(
      false,
    );
  });

  it("carries no block ids, claim ids, evidence ids or other internal annotations", () => {
    for (const [name, part] of parts) {
      for (const secret of [
        "block-",
        "claim-",
        "chunk-secret",
        "section-",
        "artifact-sendable",
        "verified",
      ]) {
        expect(part, `${name} contains ${secret}`).not.toContain(secret);
      }
    }
  });

  it("reads back as the artifact text through the controlled inspector and extractor", () => {
    expect(inspectControlledDocument(docx).recoveredVisibleContentOrder).toBe("preserved");
    expect(extractTextFromRenderedDocument(docx)).toBe(
      [
        "Jane Q. Example, Staff Platform Engineer",
        "jane@example.test | +44 20 7946 0000 | London",
        "Summary",
        "Platform engineer with José's café roots.",
        "Experience",
        "Northwind Analytics | Senior Engineer | 2019 - 2024",
        "Cut report latency by 40% & halved the on-call load.",
        "Led a team of 5 <engineers> across two time zones.",
        "Skills",
        "TypeScript, Postgres, Kubernetes",
      ].join(" "),
    );
  });
});

describe("sendable PDF export", () => {
  const pdf = renderArtifact(cv, "pdf", { generatedAt });

  it("keeps accents and punctuation, and carries no internal identifiers", () => {
    const raw = new TextDecoder().decode(pdf.content);
    expect(extractTextFromRenderedDocument(pdf)).toContain("José's café");
    expect(inspectControlledDocument(pdf).pageCount).toBe(1);
    for (const secret of ["block-", "claim-", "chunk-secret", "section-", "artifact-sendable"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("writes cross-reference offsets that point at each object", () => {
    const bytes = pdf.content;
    const text = new TextDecoder("latin1").decode(bytes);
    const xref = text.slice(text.indexOf("xref\n"));
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gmu)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThan(3);
    // The marker comment is two bytes per character when UTF-8 encoded, so check bytewise.
    offsets.forEach((offset, index) => {
      const head = new TextDecoder().decode(bytes.subarray(offset, offset + 12));
      expect(head.startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });
});

describe("line wrapping fills the real content width", () => {
  const sentence =
    "Cut report latency by 40% and halved on-call load by redesigning the ingestion pipeline across three services with a staged rollout and a documented rollback path. ";
  const longText = sentence.repeat(4).trim();

  it.each(["bullet", "paragraph", "contact"] as const)(
    "fills at least 85% of the available width on every wrapped %s line",
    (kind) => {
      const body = profile.typography.bodyFontSizePt;
      const indent = kind === "bullet" ? bulletPrefixWidthPt(profile) : 0;
      const available = contentWidthPt(profile) - indent;
      const lines = blockLines({ kind, text: longText }, profile);
      expect(lines.length).toBeGreaterThan(2);
      for (const line of lines.slice(0, -1)) {
        const width = textWidthPt(line, body, false);
        expect(width).toBeLessThanOrEqual(available);
        expect(width).toBeGreaterThanOrEqual(available * 0.85);
      }
    },
  );

  it("draws the PDF with those lines, and the sample bullet no longer breaks at two-thirds", () => {
    const bullet = artifactWithBullet(longText);
    const pdf = renderArtifact(bullet, "pdf", { generatedAt });
    const raw = new TextDecoder().decode(pdf.content);
    const drawn = [...raw.matchAll(/\(([^)]*)\) Tj/gu)].map((match) => match[1] ?? "");
    const bulletLines = drawn.filter((text) => !/^(Experience)$/u.test(text));
    const widest = Math.max(...bulletLines.map((text) => textWidthPt(text, 10.5, false)));
    expect(widest).toBeGreaterThan(contentWidthPt(profile) * 0.85);
  });
});

function artifactWithBullet(text: string): DraftArtifact {
  return {
    ...cv,
    sections: [
      {
        id: "e",
        title: "Experience",
        kind: "experience",
        order: 0,
        blocks: [{ id: "b", type: "bullet", text, claimIds: [] }],
      },
    ],
    claims: [],
  } as unknown as DraftArtifact;
}

describe("length estimate", () => {
  const longArtifact: DraftArtifact = {
    ...cv,
    sections: [
      {
        id: "long",
        title: "Experience",
        kind: "experience",
        order: 0,
        blocks: Array.from({ length: 70 }, (_, index) =>
          block(
            `long-${index}`,
            "bullet",
            `Delivered outcome ${index} with measurable impact for the team.`,
          ),
        ),
      },
    ],
  } as unknown as DraftArtifact;

  it("stays quiet when there is no page target", () => {
    const estimate = estimateDocumentLength(longArtifact, profile);
    expect(estimate.targetPages).toBeNull();
    expect(estimate.exceedsTarget).toBe(false);
    expect(estimate.warning).toBeUndefined();
    expect(estimate.summary).toContain("estimate");
  });

  it("stays quiet when the content fits the target", () => {
    const estimate = estimateDocumentLength(cv, profile, { pageTarget: "one-page" });
    expect(estimate.estimatedPages).toBeLessThan(1);
    expect(estimate.exceedsTarget).toBe(false);
  });

  it("warns, and says it is an estimate, when content clearly exceeds the target", () => {
    const estimate = estimateDocumentLength(longArtifact, profile, { pageTarget: "one-page" });
    expect(estimate.exceedsTarget).toBe(true);
    expect(estimate.estimatedPages).toBeGreaterThan(1);
    expect(estimate.warning).toContain("estimate");
    expect(estimate.warning).toContain("1-page target");
    const two = estimateDocumentLength(longArtifact, profile, { pageTarget: "two-page" });
    expect(two.exceedsTarget).toBe(false);
  });
});
