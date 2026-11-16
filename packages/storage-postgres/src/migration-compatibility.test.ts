import { describe, expect, it } from "vitest";

import { type CheckedMigration, checkMigrationCompatibility } from "./migration-compatibility.js";
import { postgresMigrations } from "./migrations.js";

function rulesOf(sql: string, contract?: string): readonly string[] {
  const migration: CheckedMigration = {
    version: 900,
    sql,
    ...(contract === undefined ? {} : { contract }),
  };
  return checkMigrationCompatibility([migration]).map(({ rule }) => rule);
}

describe("the migration compatibility check (#2831)", () => {
  it.each([
    ["DROP TABLE notes;", "drop-table"],
    ["DROP TABLE IF EXISTS notes CASCADE;", "drop-table"],
    ["ALTER TABLE notes DROP COLUMN body;", "drop-column"],
    ["ALTER TABLE notes DROP body;", "drop-column"],
    ["ALTER TABLE notes RENAME TO journal_notes;", "rename"],
    ["ALTER TABLE notes RENAME COLUMN body TO text;", "rename"],
    ["ALTER TABLE notes ALTER COLUMN body TYPE JSONB USING body::jsonb;", "change-column-type"],
    ["ALTER TABLE notes ALTER body SET DATA TYPE VARCHAR(10);", "change-column-type"],
    ["ALTER TABLE notes ADD COLUMN owner TEXT NOT NULL;", "add-required-column"],
    ["ALTER TABLE notes ALTER COLUMN owner SET NOT NULL;", "set-not-null"],
  ])("refuses %s", (sql, rule) => {
    expect(rulesOf(sql)).toEqual([rule]);
  });

  it("names each refused action of a statement with several", () => {
    expect(
      rulesOf("ALTER TABLE notes ADD COLUMN a TEXT, DROP COLUMN b, ADD COLUMN c INT NOT NULL;"),
    ).toEqual(["drop-column", "add-required-column"]);
  });

  it("passes an additive migration", () => {
    const sql = `
      -- DROP TABLE in a comment is not a change.
      CREATE TABLE feedback (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL CHECK (body <> 'DROP TABLE x')
      );
      ALTER TABLE notes ADD COLUMN category TEXT;
      ALTER TABLE notes ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE notes ADD CONSTRAINT notes_body CHECK (body IS NOT NULL);
      ALTER TABLE notes ALTER COLUMN body DROP NOT NULL, DROP CONSTRAINT old_check;
      ALTER TABLE notes ALTER COLUMN body DROP DEFAULT;
      CREATE INDEX notes_created ON notes (created_at);
      DROP INDEX IF EXISTS notes_old;
      CREATE OR REPLACE FUNCTION erase() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        DROP TABLE IF EXISTS scratch;
      END;
      $$;
    `;
    expect(rulesOf(sql)).toEqual([]);
  });

  it("lets a marked contract step remove what no release uses", () => {
    expect(
      rulesOf(
        "ALTER TABLE notes DROP COLUMN legacy_body;",
        "Drops notes.legacy_body, unread since server-v0.30.0.",
      ),
    ).toEqual([]);
  });

  it("does not take a blank contract marker", () => {
    expect(rulesOf("DROP TABLE notes;", "  ")).toEqual(["drop-table"]);
  });

  it("passes every released migration", () => {
    expect(checkMigrationCompatibility(postgresMigrations)).toEqual([]);
  });
});
