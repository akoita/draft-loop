import { describe, expect, it } from "vitest";
import { normaliseRecordName, RecordNameError } from "./record-names.js";
import { createTestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe("record name", () => {
  it("keeps a plain name or a short sentence, tidying its spaces", () => {
    expect(normaliseRecordName("  Recherche d’emploi   2026 ")).toBe("Recherche d’emploi 2026");
    expect(normaliseRecordName("Ada, product roles (Paris & remote)")).toBe(
      "Ada, product roles (Paris & remote)",
    );
  });

  it("refuses an empty name, one past 80 characters, and control characters", () => {
    expect(() => normaliseRecordName("   ")).toThrow(RecordNameError);
    expect(() => normaliseRecordName("x".repeat(81))).toThrow(RecordNameError);
    expect(normaliseRecordName("x".repeat(80))).toHaveLength(80);
    expect(() => normaliseRecordName("a\u0000b")).toThrow(RecordNameError);
  });
});

describe.runIf(connectionString !== undefined)("Postgres record names", () => {
  const url = connectionString ?? "";

  it("names and renames a record inside its tenant only", async () => {
    const schema = await createTestSchema(url, "record_names");
    const tenancy = await schema.openTenancy();
    try {
      await schema.admin.query(
        "INSERT INTO organisations (id, name) VALUES ('org-north', 'North'), ('org-south', 'South')",
      );
      const north = tenancy.forTenant("org-north").recordNames;
      const south = tenancy.forTenant("org-south").recordNames;
      const now = new Date("2026-11-15T08:00:00.000Z");

      expect(await north.set({ workspaceId: "record-1", name: " Fictional  search ", now })).toBe(
        "Fictional search",
      );
      await north.set({ workspaceId: "record-1", name: "Fictional search 2026", now });
      await south.set({ workspaceId: "record-1", name: "Another fictional search", now });

      expect([...(await north.list())]).toEqual([["record-1", "Fictional search 2026"]]);
      expect([...(await south.list())]).toEqual([["record-1", "Another fictional search"]]);
      await expect(north.set({ workspaceId: "record-2", name: "", now })).rejects.toThrow(
        RecordNameError,
      );
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });
});
