import { expect, it } from "vitest";
import { localJobRequirements } from "./local-requirements.js";

it("joins wrapped list items and paragraphs and omits structural headings", () => {
  expect(
    localJobRequirements(
      "# Engineer\n\n## Responsibilities\n- Build stable APIs with\n  versioning and migrations.\n- Maintain integrations.\n\nRequired profile\n---\nExperience delivering\nreliable services.\n\n1. Profile concurrent systems.\n2) Write clear documentation.",
    ),
  ).toEqual([
    {
      id: "requirement-1",
      text: "Build stable APIs with versioning and migrations.",
      priority: "medium",
    },
    { id: "requirement-2", text: "Maintain integrations.", priority: "medium" },
    { id: "requirement-3", text: "Experience delivering reliable services.", priority: "medium" },
    { id: "requirement-4", text: "Profile concurrent systems.", priority: "medium" },
    { id: "requirement-5", text: "Write clear documentation.", priority: "medium" },
  ]);
});
it("retains later criteria and assigns no priority based on position", () => {
  const result = localJobRequirements(
    Array.from({ length: 20 }, (_, i) => `- Criterion ${i + 1}`).join("\n"),
  );
  expect(result).toHaveLength(20);
  expect(result[19]).toEqual({ id: "requirement-20", text: "Criterion 20", priority: "medium" });
});
it.each([
  "# Only a heading",
  "| Requirement | Priority |",
  "Requirement | Priority\n--- | ---",
  "```text\nRequirements\n```",
  "x".repeat(2001),
  "x".repeat(65537),
  Array.from({ length: 101 }, () => "- An explicit criterion").join("\n"),
])("fails visibly rather than truncating or interpreting unsupported input", (text) => {
  expect(() => localJobRequirements(text)).toThrow(/reviewed opportunity brief/);
});
it("preserves source wording and handles CRLF without merging separate items", () => {
  expect(
    localJobRequirements("- Python\r\n- TypeScript\r\n\r\nRemote work\r\nfrom Europe.").map(
      (r) => r.text,
    ),
  ).toEqual(["Python", "TypeScript", "Remote work from Europe."]);
});
