import { describe, expect, it } from "vitest";

import { createPostgresQualityDigests } from "./quality-digests.js";
import { createPostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const from = new Date("2026-11-16T00:00:00.000Z");
const to = new Date("2026-11-17T00:00:00.000Z");

describe.runIf(connectionString !== undefined)("cover letter help for the digest (#3282)", () => {
  const url = connectionString ?? "";

  it("counts a day's kits, full drafts, edited letters and checks, per organisation", async () => {
    const schema = await createTestSchema(url, "cover_letter_digest");
    const directory = await createPostgresTenantDirectory({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    const digests = createPostgresQualityDigests({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    try {
      const edited = { items: [{ text: "Written by me", edited: true }] };
      for (const [tenant, id, application, kind, draft, createdAt] of [
        ["org-a", "amd_kit0000001", "app-1", "cover-letter-kit", {}, "2026-11-16T09:00:00.000Z"],
        // app-1: a full draft, then the candidate's own version.
        ["org-a", "amd_full000001", "app-1", "cover-letter", {}, "2026-11-16T10:00:00.000Z"],
        [
          "org-a",
          "amd_mine000001",
          "app-1",
          "cover-letter",
          { ...edited, based_on: "amd_full000001" },
          "2026-11-16T11:00:00.000Z",
        ],
        // app-2: a full draft, then the critic's revision, which is still the model's.
        ["org-a", "amd_full000002", "app-2", "cover-letter", {}, "2026-11-16T10:00:00.000Z"],
        [
          "org-a",
          "amd_critic0001",
          "app-2",
          "cover-letter",
          { based_on: "amd_full000002", critic_findings: [] },
          "2026-11-16T12:00:00.000Z",
        ],
        // app-4: an annotated draft alone is a reference, not a full draft or a letter (#3281).
        [
          "org-a",
          "amd_annot00001",
          "app-4",
          "cover-letter",
          { drafted_for: "annotated-draft" },
          "2026-11-16T10:00:00.000Z",
        ],
        // app-5: an annotated draft, then the candidate's rewrite beside it.
        [
          "org-a",
          "amd_annot00002",
          "app-5",
          "cover-letter",
          { drafted_for: "annotated-draft" },
          "2026-11-16T10:00:00.000Z",
        ],
        [
          "org-a",
          "amd_mine000005",
          "app-5",
          "cover-letter",
          { ...edited, based_on: "amd_annot00002", written_by: "candidate" },
          "2026-11-16T11:00:00.000Z",
        ],
        // Another day and another organisation stay out.
        ["org-a", "amd_older00001", "app-3", "cover-letter", edited, "2026-11-15T23:00:00.000Z"],
        ["org-b", "amd_kitb000001", "app-9", "cover-letter-kit", {}, "2026-11-16T09:00:00.000Z"],
      ] as const) {
        await schema.admin.query(
          `INSERT INTO application_material_drafts
             (tenant_id, id, workspace_id, application_id, kind, draft, created_at)
           VALUES ($1, $2, 'workspace-1', $3, $4, $5::jsonb, $6)`,
          [tenant, id, application, kind, JSON.stringify(draft), createdAt],
        );
      }

      await expect(digests.coverLetterUseBetween("org-a", from, to)).resolves.toEqual({
        kits: 1,
        fullDrafts: 2,
        letters: 3,
        editedLetters: 2,
      });
      await expect(digests.coverLetterUseBetween("org-b", from, to)).resolves.toEqual({
        kits: 1,
        fullDrafts: 0,
        letters: 0,
        editedLetters: 0,
      });

      // The check route's count: a date and a number, read across the deployment.
      await directory.coverLetterChecks.count(new Date("2026-11-16T08:00:00.000Z"));
      await directory.coverLetterChecks.count(new Date("2026-11-16T23:59:59.000Z"));
      await directory.coverLetterChecks.count(new Date("2026-11-17T00:00:01.000Z"));
      await expect(digests.coverLetterChecksBetween(from, to)).resolves.toBe(2);
      await expect(directory.coverLetterChecks.count(new Date(Number.NaN))).rejects.toThrow(
        /clock/u,
      );
      const columns = await schema.admin.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'cover_letter_check_counts' ORDER BY column_name`,
        [schema.schema],
      );
      expect(columns.map((row) => row.column_name)).toEqual(["checks", "day"]);
    } finally {
      await digests.close();
      await directory.close();
      await schema.drop();
    }
  });
});
