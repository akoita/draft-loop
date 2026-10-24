import type { ContentScreeningResult } from "@draft-loop/schemas/content-screening";
import {
  type ContentScreeningStore,
  ContentScreeningStoreError,
  type ContentScreeningSubject,
} from "@draft-loop/storage/content-screening";
import { describe, expect, it } from "vitest";
import { seedRecord, seedTenant } from "./erasure-test-seed.js";
import { createSqlPool, type SqlClient } from "./sql-client.js";
import { createTestSchema, runtimeRoleUrl, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const at = "2026-10-24T10:00:00.000Z";
const screeners = [{ id: "rules", version: "1" }];

const flagged: ContentScreeningResult = {
  verdict: "flagged",
  signals: ["instruction-override"],
  screeners,
  screenedAt: at,
};
const clear: ContentScreeningResult = { verdict: "clear", signals: [], screeners, screenedAt: at };
const unscreened: ContentScreeningResult = {
  verdict: "unscreened",
  signals: ["screener-unavailable"],
  screeners: [],
  screenedAt: at,
};

const jobSource: ContentScreeningSubject = {
  kind: "job-source",
  workspaceId: "history-1",
  briefId: "brief-1",
  sourceId: "pasted-1",
};
const upload: ContentScreeningSubject = {
  kind: "knowledge-source-version",
  knowledgeBaseId: "kb-upload",
  sourceId: "source-upload",
  sourceVersionId: "version-upload",
};

/** The tenant's base, source and version that `upload` names. */
async function seedUpload(admin: SqlClient, tenant: string): Promise<void> {
  await admin.query(
    `INSERT INTO candidate_knowledge_bases (tenant_id, id, display_name, description, state, is_default, created_at, updated_at)
     VALUES ($1, 'kb-upload', 'Fictional uploads', '', 'active', 0, $2, $2)`,
    [tenant, at],
  );
  await admin.query(
    `INSERT INTO candidate_knowledge_sources (tenant_id, id, candidate_knowledge_base_id, kind, display_name, created_at)
     VALUES ($1, 'source-upload', 'kb-upload', 'file', 'fictional-notes.md', $2)`,
    [tenant, at],
  );
  await admin.query(
    `INSERT INTO candidate_knowledge_source_versions (tenant_id, id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at)
     VALUES ($1, 'version-upload', 'source-upload', 1, NULL, 'text/markdown', $2, 5, $3)`,
    [tenant, "0".repeat(64), at],
  );
}

function release(resultId: string, reason = "Read it; the posting is ordinary.") {
  return { resultId, memberId: "member-1", reason, historyId: "history-1" };
}

async function refusal(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error) {
    return error instanceof ContentScreeningStoreError ? error.code : String(error);
  }
  return undefined;
}

describe.runIf(connectionString !== undefined)("Postgres content screening", () => {
  const url = connectionString ?? "";

  async function withStore(
    work: (screening: ContentScreeningStore, schema: TestSchema) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(url, "content_screening");
    const tenancy = await schema.openTenancy();
    try {
      for (const tenant of ["org-north", "org-south"]) {
        await seedTenant(schema.admin, tenant);
        await seedUpload(schema.admin, tenant);
      }
      await work(tenancy.forTenant("org-north").contentScreening, schema);
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  }

  it("quarantines a subject while its latest result is flagged or unscreened", async () => {
    await withStore(async (screening) => {
      await expect(screening.latestFor(jobSource)).resolves.toBeUndefined();
      await expect(screening.quarantined([jobSource, upload])).resolves.toEqual([]);

      const first = await screening.recordResult(jobSource, flagged);
      expect(first).toMatchObject({ subject: jobSource, result: flagged });
      expect(Number.isNaN(Date.parse(first.recordedAt))).toBe(false);
      const second = await screening.recordResult(upload, unscreened);

      const both = await screening.quarantined([upload, jobSource]);
      expect(both.map((status) => [status.id, status.quarantined])).toEqual([
        [first.id, true],
        [second.id, true],
      ]);
      expect(both[0]).toMatchObject({ subject: jobSource, result: flagged });
      expect(both[0]).not.toHaveProperty("release");

      // A newer clear result lifts the quarantine; the earlier ones stay in the history.
      const cleared = await screening.recordResult(jobSource, clear);
      await expect(screening.latestFor(jobSource)).resolves.toMatchObject({
        id: cleared.id,
        quarantined: false,
      });
      await expect(screening.quarantined([jobSource, upload])).resolves.toEqual([
        expect.objectContaining({ id: second.id }),
      ]);

      // A newer flagged result quarantines it again.
      const again = await screening.recordResult(jobSource, flagged);
      await expect(screening.quarantined([jobSource])).resolves.toEqual([
        expect.objectContaining({ id: again.id, quarantined: true }),
      ]);

      // Statuses list the latest result of each subject, not the history.
      await expect(screening.listForRecord("history-1")).resolves.toEqual([
        expect.objectContaining({ id: again.id }),
      ]);
      await expect(screening.listForKnowledgeBase("kb-upload")).resolves.toEqual([
        expect.objectContaining({ id: second.id, quarantined: true }),
      ]);
      await expect(screening.listForRecord("history-2")).resolves.toEqual([]);
    });
  });

  it("finds a result by id, superseded or not, and refuses a malformed id", async () => {
    await withStore(async (screening) => {
      const stale = await screening.recordResult(jobSource, flagged);
      const latest = await screening.recordResult(jobSource, clear);

      await expect(screening.resultById(stale.id)).resolves.toEqual(stale);
      await expect(screening.resultById(latest.id)).resolves.toEqual(latest);
      await expect(screening.resultById("screening-unknown")).resolves.toBeUndefined();
      expect(await refusal(screening.resultById(" "))).toBe("invalid_input");
    });
  });

  it("releases the latest result, audits it without the reason, and re-quarantines a later flag", async () => {
    await withStore(async (screening, schema) => {
      const stale = await screening.recordResult(jobSource, flagged);
      const latest = await screening.recordResult(jobSource, flagged);

      // Only the latest result can be released.
      expect(await refusal(screening.release(release(stale.id)))).toBe("result_superseded");
      expect(await refusal(screening.release(release("screening-unknown")))).toBe(
        "result_not_found",
      );
      expect(
        await refusal(screening.release({ ...release(latest.id), historyId: "history-9" })),
      ).toBe("invalid_input");

      const released = await screening.release(release(latest.id));
      expect(released).toMatchObject({
        resultId: latest.id,
        memberId: "member-1",
        reason: "Read it; the posting is ordinary.",
      });
      await expect(screening.quarantined([jobSource])).resolves.toEqual([]);
      await expect(screening.latestFor(jobSource)).resolves.toMatchObject({
        id: latest.id,
        quarantined: false,
        release: released,
      });

      // Releasing again returns the same release, with no second audit event.
      await expect(screening.release(release(latest.id, "Another reason."))).resolves.toEqual(
        released,
      );
      const tenancy = await schema.openTenancy();
      try {
        const events = await tenancy.forTenant("org-north").listAuditEvents("history-1");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          eventType: "content-screening.released",
          entityType: "content-screening-result",
          entityId: latest.id,
          workspaceId: "history-1",
          payload: { resultId: latest.id, memberId: "member-1" },
          createdAt: released.releasedAt,
        });
        expect(JSON.stringify(events)).not.toContain("posting");
        await expect(
          tenancy.forTenant("org-north").auditEvents.verifyAuditChain("history-1"),
        ).resolves.toMatchObject({ ok: true, eventCount: 1 });
      } finally {
        await tenancy.close();
      }

      // A newer flagged result after a release quarantines the subject again, and only a
      // release of that newer result lifts it.
      const newer = await screening.recordResult(jobSource, unscreened);
      await expect(screening.quarantined([jobSource])).resolves.toEqual([
        expect.objectContaining({ id: newer.id, quarantined: true }),
      ]);
      expect(await refusal(screening.release(release(latest.id)))).toBeUndefined();
      await screening.release(release(newer.id));
      await expect(screening.quarantined([jobSource])).resolves.toEqual([]);

      // A clear result has nothing to release.
      const cleared = await screening.recordResult(jobSource, clear);
      expect(await refusal(screening.release(release(cleared.id)))).toBe("not_releasable");
    });
  });

  it("releases a knowledge source version under the owning record's history", async () => {
    await withStore(async (screening) => {
      const result = await screening.recordResult(upload, flagged);
      await expect(screening.release(release(result.id))).resolves.toMatchObject({
        resultId: result.id,
      });
      await expect(screening.quarantined([upload])).resolves.toEqual([]);
    });
  });

  it("refuses a knowledge subject that does not exist and input outside the rules", async () => {
    await withStore(async (screening) => {
      expect(
        await refusal(
          screening.recordResult({ ...upload, sourceVersionId: "version-none" }, clear),
        ),
      ).toBe("subject_not_found");
      expect(
        await refusal(screening.recordResult({ ...upload, knowledgeBaseId: "kb-none" }, clear)),
      ).toBe("subject_not_found");
      expect(await refusal(screening.recordResult({ ...jobSource, sourceId: " " }, clear))).toBe(
        "invalid_input",
      );
      expect(
        await refusal(screening.recordResult(jobSource, { ...clear, signals: ["role-change"] })),
      ).toBe("invalid_input");
      const result = await screening.recordResult(jobSource, flagged);
      expect(await refusal(screening.release(release(result.id, "   ")))).toBe("invalid_input");
      expect(await refusal(screening.release(release(result.id, "x".repeat(501))))).toBe(
        "invalid_input",
      );
      expect(await refusal(screening.release({ ...release(result.id), memberId: "a b" }))).toBe(
        "invalid_input",
      );
      const many = Array.from({ length: 501 }, () => jobSource);
      expect(await refusal(screening.quarantined(many))).toBe("invalid_input");
    });
  });

  it("keeps each tenant's results and releases to itself", async () => {
    const schema = await createTestSchema(url, "content_screening");
    const tenancy = await schema.openTenancy();
    try {
      for (const tenant of ["org-north", "org-south"]) await seedUpload(schema.admin, tenant);
      const north = tenancy.forTenant("org-north").contentScreening;
      const south = tenancy.forTenant("org-south").contentScreening;
      const result = await north.recordResult(jobSource, flagged);
      await north.recordResult(upload, flagged);

      await expect(south.latestFor(jobSource)).resolves.toBeUndefined();
      await expect(south.quarantined([jobSource, upload])).resolves.toEqual([]);
      await expect(south.listForRecord("history-1")).resolves.toEqual([]);
      await expect(south.listForKnowledgeBase("kb-upload")).resolves.toEqual([]);
      expect(await refusal(south.release(release(result.id)))).toBe("result_not_found");
      await expect(south.resultById(result.id)).resolves.toBeUndefined();

      // The same ids in the other tenant are a separate subject.
      const other = await south.recordResult(jobSource, clear);
      await expect(south.latestFor(jobSource)).resolves.toMatchObject({ id: other.id });
      await expect(north.latestFor(jobSource)).resolves.toMatchObject({ id: result.id });
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });

  it("is append-only for the runtime role", async () => {
    const schema = await createTestSchema(url, "content_screening");
    const tenancy = await schema.openTenancy();
    const pool = createSqlPool({ connectionString: runtimeRoleUrl(url), schema: schema.schema });
    try {
      await seedTenant(schema.admin, "org-north");
      const screening = tenancy.forTenant("org-north").contentScreening;
      const result = await screening.recordResult(jobSource, flagged);
      await screening.release(release(result.id));
      const asTenant = pool.forTenant("org-north");
      for (const statement of [
        "UPDATE content_screening_results SET verdict = 'clear'",
        "DELETE FROM content_screening_results",
        "TRUNCATE content_screening_results",
        "UPDATE content_screening_releases SET reason = 'changed'",
        "DELETE FROM content_screening_releases",
        "TRUNCATE content_screening_releases",
      ]) {
        await expect(asTenant.query(statement)).rejects.toThrow(/permission denied/u);
      }
      // The owning role is refused too, outside the erasure functions.
      await expect(schema.admin.query("DELETE FROM content_screening_releases")).rejects.toThrow(
        /immutable/u,
      );
      await expect(
        schema.admin.query("UPDATE content_screening_results SET verdict = 'clear'"),
      ).rejects.toThrow(/immutable/u);
    } finally {
      await pool.close();
      await tenancy.close();
      await schema.drop();
    }
  });

  it("is erased with its record and leaves another record's results", async () => {
    const schema = await createTestSchema(url, "content_screening");
    const tenancy = await schema.openTenancy();
    try {
      await seedTenant(schema.admin, "org-north");
      await seedRecord(schema.admin, "org-north", "record-gone");
      await seedRecord(schema.admin, "org-north", "record-kept");
      const north = tenancy.forTenant("org-north");
      const screening = north.contentScreening;
      // The seed gives each record a flagged job source and an unscreened upload.
      const gone = await screening.listForRecord("workspace-record-gone");
      expect(gone.map((status) => status.result.verdict)).toEqual(["flagged"]);
      await expect(screening.listForKnowledgeBase("record-gone-kb")).resolves.toHaveLength(1);

      // A release made through the port is audited under the record and goes with it.
      const result = await screening.recordResult(
        {
          kind: "job-source",
          workspaceId: "workspace-record-gone",
          briefId: "brief-2",
          sourceId: "pasted-2",
        },
        flagged,
      );
      await screening.release({
        resultId: result.id,
        memberId: "member-1",
        reason: "Looks fine.",
        historyId: "workspace-record-gone",
      });

      await north.recordErasure.close("record-gone");
      await north.recordErasure.erase("record-gone");

      await expect(screening.listForRecord("workspace-record-gone")).resolves.toEqual([]);
      await expect(screening.listForKnowledgeBase("record-gone-kb")).resolves.toEqual([]);
      await expect(screening.listForRecord("workspace-record-kept")).resolves.toHaveLength(1);
      await expect(screening.listForKnowledgeBase("record-kept-kb")).resolves.toHaveLength(1);
      const [count] = await schema.admin.query(
        "SELECT count(*) AS rows FROM content_screening_releases WHERE result_id LIKE 'record-gone-%' OR result_id = $1",
        [result.id],
      );
      expect(Number(count?.rows)).toBe(0);
    } finally {
      await tenancy.close();
      await schema.drop();
    }
  });
});
