import { expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import {
  JobRequirementUserError,
  localJobRequirements,
  maxLocalRequirementUnitTokens,
} from "./local-requirements.js";

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

const words = (count: number) => Array.from({ length: count }, (_, i) => `skill${i}`).join(" ");
const pastedPage = [
  "Acme Widgets Careers Home About Us Blog Contact",
  "",
  `Acme builds widgets for logistics teams. ${words(60)}`,
  `Meet the team: our founder started in a garage. ${words(70)}`,
  "Copyright Acme Widgets. All rights reserved.",
].join("\n");

it("refuses a pasted web page whose paragraphs are too long to match against CV lines", () => {
  let thrown: unknown;
  try {
    localJobRequirements(pastedPage);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(JobRequirementUserError);
  expect(thrown).toBeInstanceOf(CliUserError);
  expect((thrown as Error).message).toMatch(
    /^Requirement 2 in the job description has 151 words, too long to match against individual CV lines \("Acme builds widgets for logistics teams. skill0 skill1…"\)\. List each requirement on its own bullet line.*reviewed opportunity brief\.$/u,
  );
});
it("accepts a bulleted job ad", () => {
  expect(
    localJobRequirements(
      "# Engineer\n\n- Build stable APIs with TypeScript.\n- Maintain integrations.\n- Write clear documentation.",
    ),
  ).toHaveLength(3);
});
it("allows a unit at exactly the token limit and refuses one token more", () => {
  expect(localJobRequirements(`- ${words(maxLocalRequirementUnitTokens)}`)).toHaveLength(1);
  expect(() => localJobRequirements(`- ${words(maxLocalRequirementUnitTokens + 1)}`)).toThrow(
    JobRequirementUserError,
  );
});
it("reports existing local requirement limits as user errors", () => {
  expect(() => localJobRequirements("# Only a heading")).toThrow(CliUserError);
});
