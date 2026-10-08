import { describe, expect, it } from "vitest";
import { applicationJobSourceSchema, applicationSchema } from "./application.js";

const base = {
  schemaVersion: 1,
  id: "app-1",
  name: "Acme — Staff Engineer",
  jobSource: { kind: "local-file", path: "/jobs/acme.md" },
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  status: "drafting",
  isDefault: false,
} as const;

describe("application schema", () => {
  it("accepts a well-formed application and trims its name", () => {
    expect(applicationSchema.parse({ ...base, name: "  Acme  " }).name).toBe("Acme");
  });

  it("rejects blank or over-long names, unknown statuses and extra fields", () => {
    expect(applicationSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...base, name: "x".repeat(121) }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...base, status: "done" }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it("keeps the reserved default id for the default application only", () => {
    expect(applicationSchema.safeParse({ ...base, id: "default" }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...base, id: "default", isDefault: true }).success).toBe(
      true,
    );
  });

  it("requires approval for a URL source and a web scheme", () => {
    expect(
      applicationJobSourceSchema.safeParse({ kind: "approved-url", url: "https://x.test/job" })
        .success,
    ).toBe(false);
    expect(
      applicationJobSourceSchema.safeParse({
        kind: "approved-url",
        url: "file:///etc/passwd",
        approved: true,
      }).success,
    ).toBe(false);
    expect(
      applicationJobSourceSchema.safeParse({
        kind: "approved-url",
        url: "https://x.test/job",
        approved: true,
      }).success,
    ).toBe(true);
  });
});
