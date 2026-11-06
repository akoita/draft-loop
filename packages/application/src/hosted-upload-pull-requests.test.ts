import { describe, expect, it } from "vitest";

import { HostedKnowledgeIntakeError, normalizeHostedUpload } from "./hosted-knowledge-intake.js";

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

describe("hosted upload of a pull request list", () => {
  it("stores a CSV pull request list as Markdown citing each link", () => {
    const csv =
      "title,body,closedAt,url,repository\nAdd retry,Retries the export,2026-10-02,https://github.com/sample-user/tools/pull/7,sample-user/tools\n";
    const stored = normalizeHostedUpload({ mediaType: "text/csv", bytes: bytes(csv) });
    expect(stored.mediaType).toBe("text/markdown");
    const markdown = Buffer.from(stored.bytes).toString("utf8");
    expect(markdown).toContain("### Add retry");
    expect(markdown).toContain("- Link: https://github.com/sample-user/tools/pull/7");
  });

  it("refuses a JSON or CSV file that is not a pull request list", () => {
    for (const [mediaType, text] of [
      ["application/json", '{"name":"x"}'],
      ["text/csv", "name,email\nA,a@example.test\n"],
    ] as const) {
      expect(() => normalizeHostedUpload({ mediaType, bytes: bytes(text) })).toThrow(
        HostedKnowledgeIntakeError,
      );
    }
  });

  it("leaves every other upload as it came", () => {
    const markdown = { mediaType: "text/markdown", bytes: bytes("# Notes\n") };
    expect(normalizeHostedUpload(markdown)).toBe(markdown);
  });
});
