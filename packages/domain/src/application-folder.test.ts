import { describe, expect, it } from "vitest";
import {
  applicationFolderNameKey,
  applicationFolderNameMaxLength,
  isApplicationFolderId,
  normalizeApplicationFolderName,
} from "./application-folder.js";

describe("application folder name", () => {
  it("trims, collapses inner spaces and accepts 1 to 60 characters", () => {
    expect(normalizeApplicationFolderName("  Fintech   roles ")).toBe("Fintech roles");
    expect(normalizeApplicationFolderName("x".repeat(applicationFolderNameMaxLength))).toHaveLength(
      60,
    );
  });

  it("rejects blank and over-long names", () => {
    expect(() => normalizeApplicationFolderName("  ")).toThrow(RangeError);
    expect(() =>
      normalizeApplicationFolderName("x".repeat(applicationFolderNameMaxLength + 1)),
    ).toThrow(RangeError);
  });

  it("collides names that differ only by case, accents or spacing", () => {
    expect(applicationFolderNameKey("Missions  Freelance")).toBe(
      applicationFolderNameKey("missions freelance"),
    );
    expect(applicationFolderNameKey("Société")).toBe(applicationFolderNameKey("societe"));
    expect(applicationFolderNameKey("Fintech")).not.toBe(applicationFolderNameKey("Fintech 2"));
  });
});

describe("application folder id", () => {
  it("accepts fld_ ids only", () => {
    expect(isApplicationFolderId("fld_a1B2c3D4")).toBe(true);
    expect(isApplicationFolderId("fld_short")).toBe(false);
    expect(isApplicationFolderId("app-12345678")).toBe(false);
  });
});
