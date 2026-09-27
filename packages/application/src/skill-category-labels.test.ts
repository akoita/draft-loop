import { describe, expect, it } from "vitest";

import { skillCategoryPresentationPrefixTokenCount } from "./skill-category-labels.js";

describe("Skills category presentation labels", () => {
  it("recognizes the supported normalized label only at block start", () => {
    expect(
      skillCategoryPresentationPrefixTokenCount("skills", "cLoUd and DevOps: Kubernetes"),
    ).toBe(3);
    expect(
      skillCategoryPresentationPrefixTokenCount("skills", "Ｃｌｏｕｄ and DevOps: Kubernetes"),
    ).toBe(3);
    expect(
      skillCategoryPresentationPrefixTokenCount("skills", " Platform: Cloud and DevOps: Java"),
    ).toBeUndefined();
  });

  it.each([
    ["skills", "Cloud and DevOps Kubernetes"],
    ["skills", "Cloud and DevOps:"],
    ["skills", "Expert Cloud and DevOps: Kubernetes"],
    ["skills", "Cloud Security: Kubernetes"],
    ["summary", "Cloud and DevOps: Kubernetes"],
    ["experience", "Cloud and DevOps: Kubernetes"],
  ])("does not exempt other labels or sections: %s / %s", (kind, text) => {
    expect(skillCategoryPresentationPrefixTokenCount(kind, text)).toBeUndefined();
  });
});
