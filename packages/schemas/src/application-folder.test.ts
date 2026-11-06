import { describe, expect, it } from "vitest";
import {
  applicationFolderIdSchema,
  applicationFolderNameSchema,
  applicationFolderPlacementSchema,
  applicationFolderSchema,
} from "./application-folder.js";

describe("application folder schemas", () => {
  it("normalizes a typed name and refuses a blank or long one", () => {
    expect(applicationFolderNameSchema.parse("  Long   shots ")).toBe("Long shots");
    expect(applicationFolderNameSchema.safeParse(" ").success).toBe(false);
    expect(applicationFolderNameSchema.safeParse("x".repeat(61)).success).toBe(false);
  });

  it("accepts a stored folder and refuses extra fields", () => {
    const folder = {
      id: "fld_abcd1234",
      name: "Fintech roles",
      createdAt: "2026-11-06T01:00:00.000Z",
      updatedAt: "2026-11-06T01:00:00.000Z",
    };
    expect(applicationFolderSchema.parse(folder)).toEqual(folder);
    expect(applicationFolderSchema.safeParse({ ...folder, color: "red" }).success).toBe(false);
  });

  it("places an application in a folder or in no folder", () => {
    expect(applicationFolderPlacementSchema.parse(null)).toBeNull();
    expect(applicationFolderPlacementSchema.parse("fld_abcd1234")).toBe("fld_abcd1234");
    expect(applicationFolderIdSchema.safeParse("../etc").success).toBe(false);
  });
});
