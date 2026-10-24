import { describe, expect, it } from "vitest";
import {
  normalizeMemberEmail,
  requireMemberRole,
  requireOrganisationId,
  requireOrganisationName,
  TenantDirectoryError,
  verifiedSignInEmail,
} from "./tenant-directory.js";

describe("tenant directory input rules", () => {
  it("normalizes emails and refuses malformed ones", () => {
    expect(normalizeMemberEmail("  Coach@North.Example.Test ")).toBe("coach@north.example.test");
    for (const email of ["", "coach", "coach@", "a b@example.test", `${"a".repeat(320)}@x.test`]) {
      expect(() => normalizeMemberEmail(email)).toThrow(TenantDirectoryError);
    }
  });

  it("claims with an email only when the provider verified it", () => {
    const identity = { issuer: "https://identity.example.test", subject: "subject-1" };
    expect(
      verifiedSignInEmail({ ...identity, email: "Coach@Example.Test", emailVerified: true }),
    ).toBe("coach@example.test");
    expect(
      verifiedSignInEmail({ ...identity, email: "coach@example.test", emailVerified: false }),
    ).toBeUndefined();
    expect(verifiedSignInEmail({ ...identity, emailVerified: true })).toBeUndefined();
    expect(
      verifiedSignInEmail({ ...identity, email: "not-an-email", emailVerified: true }),
    ).toBeUndefined();
  });

  it("accepts only tenant-safe organisation ids, known roles and bounded names", () => {
    expect(requireOrganisationId("org-north.1")).toBe("org-north.1");
    expect(() => requireOrganisationId("../org")).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(requireMemberRole("admin")).toBe("admin");
    expect(() => requireMemberRole("candidate")).toThrow(TenantDirectoryError);
    expect(requireOrganisationName("  North  ")).toBe("North");
    expect(() => requireOrganisationName("   ")).toThrow(TenantDirectoryError);
  });
});
