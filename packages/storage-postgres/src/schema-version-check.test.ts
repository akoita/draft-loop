import { describe, expect, it } from "vitest";
import { postgresMigrations } from "./migrations.js";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;
const latest = Math.max(...postgresMigrations.map((migration) => migration.version));

describe.runIf(connectionString !== undefined)("Postgres storage schema version", () => {
  const url = connectionString ?? "";

  // A rollback runs the previous release's image on the newer release's schema.
  it("opens on a schema migrated past this release", async () => {
    const { admin, open, drop } = await createTestSchema(url, "newer_schema");
    try {
      await admin.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [
        latest + 1,
        "from-a-newer-release",
      ]);
      const storage = await open("tenant-a");
      await storage.close();
    } finally {
      await drop();
    }
  });

  it("refuses a schema behind this release", async () => {
    const { admin, open, drop } = await createTestSchema(url, "older_schema");
    try {
      await admin.query("DELETE FROM schema_migrations WHERE version = $1", [latest]);
      await expect(open("tenant-a")).rejects.toThrow("not migrated to the current version");
    } finally {
      await drop();
    }
  });
});
