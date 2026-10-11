import { describe, expect, it } from "vitest";
import { suggestedApplicationName } from "./application-name.js";

describe("suggested application names", () => {
  it("joins the role and employer, or uses whichever one the brief has", () => {
    expect(suggestedApplicationName(" Platform Engineer ", "Example Systems")).toBe(
      "Platform Engineer at Example Systems",
    );
    expect(suggestedApplicationName("Platform Engineer", undefined)).toBe("Platform Engineer");
    expect(suggestedApplicationName(" ", "Example Systems")).toBe("Example Systems");
    expect(suggestedApplicationName(undefined, "  ")).toBeUndefined();
  });

  it("keeps the suggestion within the application name limit", () => {
    expect(suggestedApplicationName("r".repeat(100), "e".repeat(100))?.length).toBe(120);
  });
});
