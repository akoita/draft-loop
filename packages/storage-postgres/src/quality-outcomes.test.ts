import { describe, expect, it } from "vitest";

import { seedRecord, seedTenant } from "./erasure-test-seed.js";
import { createPostgresQualityDigests } from "./quality-digests.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("member outcomes for the digest (#3245)", () => {
  const url = connectionString ?? "";

  it("reads a day's decided findings, exports and stopped runs with their models, per organisation", async () => {
    const schema = await createTestSchema(url, "quality_outcomes");
    const digests = createPostgresQualityDigests({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    try {
      await seedTenant(schema.admin, "org-a");
      await seedRecord(schema.admin, "org-a", "record-1", { runState: "stopped" });
      await seedTenant(schema.admin, "org-b");
      await schema.admin.query(
        `INSERT INTO decisions (tenant_id, id, workspace_id, run_id, round_id, artifact_id, type, rationale, actor, created_at, payload_json, record_checksum)
         SELECT tenant_id, 'decision-accept', workspace_id, run_id, round_id, artifact_id, 'accept-finding',
                rationale, actor, created_at, payload_json, record_checksum FROM decisions`,
      );
      await schema.admin.query(
        `INSERT INTO run_spans (tenant_id, workspace_id, run_id, span_id, name, started_at, status, attributes)
         VALUES ('org-a', 'workspace-record-1', 'record-1-run', 'eval-1', 'evaluate_run',
                 '2026-10-24T09:00:00.000Z', 'ok',
                 '{"draftloop.quality.author_model":"claude-haiku-5-5","gen_ai.request.model":"gpt-terra"}')`,
      );
      const from = new Date("2026-10-24T00:00:00.000Z");
      const to = new Date("2026-10-25T00:00:00.000Z");

      const outcomes = await digests.outcomesBetween("org-a", from, to);
      expect([...outcomes.events].sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
        { runId: "record-1-run", kind: "exported" },
        { runId: "record-1-run", kind: "finding-accepted" },
        { runId: "record-1-run", kind: "stopped" },
      ]);
      expect(outcomes.runPairs).toEqual([
        { runId: "record-1-run", authorModel: "claude-haiku-5-5", criticModel: "gpt-terra" },
      ]);
      // Another organisation and another day read nothing.
      await expect(digests.outcomesBetween("org-b", from, to)).resolves.toEqual({
        events: [],
        runPairs: [],
      });
      await expect(
        digests.outcomesBetween("org-a", to, new Date("2026-10-26T00:00:00.000Z")),
      ).resolves.toEqual({ events: [], runPairs: [] });
      // Each seeded organisation holds one note sent that day.
      await expect(digests.feedbackNotesBetween(from, to)).resolves.toBe(2);
    } finally {
      await digests.close();
      await schema.drop();
    }
  });
});
