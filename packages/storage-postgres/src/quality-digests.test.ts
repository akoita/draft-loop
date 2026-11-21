import { describe, expect, it } from "vitest";

import { createPostgresQualityDigests, spanDurationMs } from "./quality-digests.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("Postgres quality digests (#2916)", () => {
  const url = connectionString ?? "";

  it("claims a day once, reads spans per organisation and stores the digest", async () => {
    const schema = await createTestSchema(url, "quality_digests");
    const digests = createPostgresQualityDigests({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    try {
      await schema.admin.query(
        `INSERT INTO organisation_activity (organisation_id, last_active_at) VALUES
           ('org-a', '2026-11-16T09:00:00Z'), ('org-old', '2026-10-01T09:00:00Z')`,
      );
      for (const [tenant, startedAt, span] of [
        ["org-a", "2026-11-16T10:00:00.000Z", "s-1"],
        ["org-a", "2026-11-17T01:00:00.000Z", "s-2"],
        ["org-b", "2026-11-16T10:00:00.000Z", "s-3"],
      ] as const) {
        await schema.admin.query(
          `INSERT INTO run_spans (tenant_id, workspace_id, run_id, span_id, name, started_at, status, attributes)
           VALUES ($1, 'record-1', 'run-1', $2, 'invoke_agent', $3, 'error', '{"error.type":"provider-error"}')`,
          [tenant, span, startedAt],
        );
      }

      const from = new Date("2026-11-16T00:00:00.000Z");
      const to = new Date("2026-11-17T00:00:00.000Z");
      await expect(digests.claimDay("2026-11-16", to)).resolves.toBe(true);
      await expect(digests.claimDay("2026-11-16", to)).resolves.toBe(false);
      await expect(digests.organisationsActiveSince(from, 10)).resolves.toEqual(["org-a"]);
      await expect(digests.spansBetween("org-a", from, to)).resolves.toEqual([
        {
          runId: "run-1",
          name: "invoke_agent",
          status: "error",
          attributes: { "error.type": "provider-error" },
          durationMs: null,
        },
      ]);

      await digests.save("2026-11-16", { runs: 1 });
      const [row] = await schema.admin.query(
        "SELECT digest FROM quality_digests WHERE day = '2026-11-16'",
      );
      expect(row?.digest).toEqual({ runs: 1 });

      const insight = {
        key: "failure:author:economy-author:invalid-response:max_tokens",
        firstSeen: "2026-11-16",
        lastSeen: "2026-11-16",
        daysSeen: 1,
        occurrences: 4,
        runIds: ["run-1"],
        status: "new" as const,
        issue: null,
      };
      await digests.saveInsights([insight]);
      await digests.saveInsights([{ ...insight, status: "dismissed", issue: 2873 }]);
      await expect(digests.listInsights()).resolves.toEqual([
        { ...insight, status: "dismissed", issue: 2873 },
      ]);
    } finally {
      await digests.close();
      await schema.drop();
    }
  });
});

describe("spanDurationMs (#3251)", () => {
  it("reads a finished span's duration and leaves an open or unreadable one out", () => {
    expect(spanDurationMs("2026-11-16T10:00:00.000Z", "2026-11-16T10:00:01.250Z")).toBe(1250);
    expect(spanDurationMs("2026-11-16T10:00:00.000Z", null)).toBeNull();
    expect(spanDurationMs("2026-11-16T10:00:01.000Z", "2026-11-16T10:00:00.000Z")).toBeNull();
    expect(spanDurationMs("bad", "2026-11-16T10:00:00.000Z")).toBeNull();
  });
});
