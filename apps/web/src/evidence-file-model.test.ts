import { describe, expect, it } from "vitest";

import { downloadOffered, fileAddedLine, isInterviewSource } from "./evidence-file-model.js";
import type { ScreeningStatus } from "./screening-model.js";

const status = (quarantined: boolean): ScreeningStatus => ({
  kind: "knowledge-source-version",
  knowledgeBaseId: "kb-1",
  sourceId: "s1",
  sourceVersionId: "v1",
  resultId: "r1",
  verdict: quarantined ? "flagged" : "clear",
  signals: [],
  quarantined,
});

describe("career evidence files", () => {
  it("tells the career interview's files from uploads by their name", () => {
    expect(isInterviewSource({ displayName: "career-interview-cis_example-2.md" })).toBe(true);
    expect(isInterviewSource({ displayName: "career-interview-notes.md" })).toBe(false);
    expect(isInterviewSource({ displayName: "facts.md" })).toBe(false);
  });

  it("says when a file was uploaded or created", () => {
    const createdAt = "2026-11-03T14:12:00.000Z";
    const options = { locale: "en", timeZone: "UTC" };

    expect(fileAddedLine({ displayName: "facts.md", createdAt }, options)).toBe(
      "Uploaded 3 Nov 2026, 14:12",
    );
    expect(
      fileAddedLine({ displayName: "career-interview-cis_example-1.md", createdAt }, options),
    ).toBe("Created 3 Nov 2026, 14:12");
    expect(fileAddedLine({ displayName: "facts.md", createdAt: "not a date" })).toBeUndefined();
  });

  it("offers a quarantined file's download only to those who may release it", () => {
    expect(downloadOffered(status(false), false)).toBe(true);
    expect(downloadOffered(undefined, false)).toBe(true);
    expect(downloadOffered(status(true), false)).toBe(false);
    expect(downloadOffered(status(true), true)).toBe(true);
  });
});
