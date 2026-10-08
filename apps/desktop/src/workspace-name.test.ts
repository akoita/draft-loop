import { describe, expect, it } from "vitest";
import {
  maximumWorkspaceNameLength,
  normalizeWorkspaceDisplayName,
  workspaceFolderName,
} from "./workspace-name.js";

describe("normalizeWorkspaceDisplayName", () => {
  it("trims and keeps spaces, accents and dashes", () => {
    expect(normalizeWorkspaceDisplayName("  Mergify — Staff Engineer  ")).toBe(
      "Mergify — Staff Engineer",
    );
    expect(normalizeWorkspaceDisplayName("Équipe Données (2026)")).toBe("Équipe Données (2026)");
  });

  it("enforces the 1 to 80 character bounds after trimming", () => {
    expect(normalizeWorkspaceDisplayName("   ")).toBeUndefined();
    expect(normalizeWorkspaceDisplayName("")).toBeUndefined();
    expect(normalizeWorkspaceDisplayName("a".repeat(maximumWorkspaceNameLength))).toBeDefined();
    expect(
      normalizeWorkspaceDisplayName("a".repeat(maximumWorkspaceNameLength + 1)),
    ).toBeUndefined();
  });

  it("rejects separators, control characters and non-strings", () => {
    for (const bad of ["a/b", "a\\b", "a\nb", "a\u0000b", "a\u007fb", ".", ".."]) {
      expect(normalizeWorkspaceDisplayName(bad)).toBeUndefined();
    }
    expect(normalizeWorkspaceDisplayName(42)).toBeUndefined();
    expect(normalizeWorkspaceDisplayName(undefined)).toBeUndefined();
  });
});

describe("workspaceFolderName", () => {
  it("slugs a display name to lowercase ASCII", () => {
    expect(workspaceFolderName("Mergify — Staff Engineer")).toBe("mergify-staff-engineer");
    expect(workspaceFolderName("Équipe Données")).toBe("equipe-donnees");
  });

  it("keeps a name that is already a safe folder name", () => {
    expect(workspaceFolderName("Draft-Loop_Smoke.1")).toBe("Draft-Loop_Smoke.1");
  });

  it("falls back when nothing safe remains", () => {
    expect(workspaceFolderName("—— ✓")).toBe("draft-loop-workspace");
    expect(workspaceFolderName("...")).toBe("draft-loop-workspace");
  });

  it("never produces a path separator or leading dot", () => {
    expect(workspaceFolderName(".hidden: name?*")).toBe("hidden-name");
  });
});
