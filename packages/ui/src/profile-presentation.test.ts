import { describe, expect, it } from "vitest";

import {
  humanizeProfileCategory,
  humanizeProfileFieldLabel,
  profileIssueCodeLabel,
  sourceCountLabel,
  truncateProfileText,
} from "./profile-presentation.js";

describe("profile presentation helpers", () => {
  it("humanizes camelCase, snake_case, and kebab-case field names", () => {
    expect(humanizeProfileFieldLabel("skillName")).toBe("Skill name");
    expect(humanizeProfileFieldLabel("name")).toBe("Name");
    expect(humanizeProfileFieldLabel("employment_end_date")).toBe("Employment end date");
    expect(humanizeProfileFieldLabel("approved-link")).toBe("Approved link");
    expect(humanizeProfileFieldLabel("githubURL")).toBe("Github URL");
    expect(humanizeProfileFieldLabel("CV")).toBe("CV");
    expect(humanizeProfileFieldLabel("URLValue")).toBe("URL value");
    expect(humanizeProfileFieldLabel("  double__sep  ")).toBe("Double sep");
  });

  it("returns the original text when nothing readable remains", () => {
    expect(humanizeProfileFieldLabel("")).toBe("");
    expect(humanizeProfileFieldLabel("--")).toBe("--");
  });

  it("humanizes categories", () => {
    expect(humanizeProfileCategory("approved-link")).toBe("Approved link");
    expect(humanizeProfileCategory("skill")).toBe("Skill");
  });

  it("labels known issue codes and falls back to a humanized code", () => {
    expect(profileIssueCodeLabel("conflict-date")).toBe("Conflicting dates");
    expect(profileIssueCodeLabel("conflict-title")).toBe("Conflicting titles");
    expect(profileIssueCodeLabel("conflict-duration")).toBe("Conflicting durations");
    expect(profileIssueCodeLabel("conflict-metric")).toBe("Conflicting metrics");
    expect(profileIssueCodeLabel("conflict-value")).toBe("Conflicting values");
    expect(profileIssueCodeLabel("duplicate")).toBe("Possible duplicate");
    expect(profileIssueCodeLabel("omission")).toBe("Omission");
    expect(profileIssueCodeLabel("new-code")).toBe("New code");
  });

  it("pluralizes source counts", () => {
    expect(sourceCountLabel(1)).toBe("1 source");
    expect(sourceCountLabel(0)).toBe("0 sources");
    expect(sourceCountLabel(3)).toBe("3 sources");
  });

  it("truncates long text with an ellipsis", () => {
    expect(truncateProfileText("short")).toBe("short");
    expect(truncateProfileText("a".repeat(61))).toBe(`${"a".repeat(59)}…`);
    expect(truncateProfileText("a".repeat(60))).toBe("a".repeat(60));
  });
});
