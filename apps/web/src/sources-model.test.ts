import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api-client.js";
import {
  formatBytes,
  selectionRequest,
  sourceFileProblem,
  sourceMediaType,
  uploadErrorMessage,
} from "./sources-model.js";

describe("source files", () => {
  it.each([
    ["career.PDF", "application/pdf"],
    ["notes.md", "text/markdown"],
    ["notes.markdown", "text/markdown"],
    ["cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["plain.txt", "text/plain"],
    ["slides.pptx", undefined],
    ["no-extension", undefined],
  ])("uploads %s as %s", (name, type) => {
    expect(sourceMediaType(name)).toBe(type);
  });

  it("refuses files the API would refuse before sending them", () => {
    expect(sourceFileProblem({ name: "notes.md", size: 10 })).toBeUndefined();
    expect(sourceFileProblem({ name: "slides.pptx", size: 10 })).toBe(
      "slides.pptx: DraftLoop takes PDF, DOCX, Markdown and text files.",
    );
    expect(sourceFileProblem({ name: "empty.txt", size: 0 })).toBe("empty.txt is empty.");
    expect(sourceFileProblem({ name: `${"a".repeat(200)}.md`, size: 1 })).toMatch(/200 characters/);
  });

  it("explains a refused upload", () => {
    expect(uploadErrorMessage("big.pdf", new ApiRequestError(413, "too_large", "Too large."))).toBe(
      "big.pdf is larger than this service accepts.",
    );
    expect(
      uploadErrorMessage(
        "fake.pdf",
        new ApiRequestError(415, "unsupported_media_type", "The bytes are not a PDF."),
      ),
    ).toBe(
      "fake.pdf: DraftLoop takes PDF, DOCX, Markdown and text files. The bytes are not a PDF.",
    );
    expect(uploadErrorMessage("a.md", new ApiRequestError(404, "not_found", "No such base."))).toBe(
      "a.md: No such base.",
    );
    expect(
      uploadErrorMessage(
        "a.md",
        new ApiRequestError(409, "storage_consent_required", "Storage consent is required."),
      ),
    ).toContain("a.md: The candidate's material cannot be stored yet. Record the basis");
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(12_800)).toBe("13 KB");
    expect(formatBytes(1_468_006)).toBe("1.4 MB");
  });
});

describe("knowledge selection", () => {
  it("needs one base, and approval to combine several", () => {
    expect(selectionRequest([], false)).toEqual({ problem: "Choose at least one knowledge base." });
    expect(selectionRequest(["kb-1"], false)).toEqual({ body: { knowledgeBaseIds: ["kb-1"] } });
    expect(selectionRequest(["kb-1", "kb-2"], false)).toEqual({
      problem: "Confirm that runs may combine these knowledge bases.",
    });
    expect(selectionRequest(["kb-1", "kb-2"], true)).toEqual({
      body: { knowledgeBaseIds: ["kb-1", "kb-2"], combinationApproved: true },
    });
  });
});
