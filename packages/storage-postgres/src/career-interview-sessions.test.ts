import type { CareerInterviewSession } from "@draft-loop/schemas/career-interview";
import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

// Invented topics and answers only.
function session(
  id: string,
  overrides: Partial<CareerInterviewSession> = {},
): CareerInterviewSession {
  return {
    id,
    workspace_id: "owner",
    status: "open",
    topics: [
      {
        key: "untold-theme:volunteering:abcd1234",
        kind: "untold-theme",
        reason: "Your record mentions volunteering but tells no story about it.",
        status: "declined",
        fact_ids: ["fact-1"],
        requirement_ids: [],
        turns: [],
      },
    ],
    created_at: "2026-11-05T09:00:00.000Z",
    updated_at: "2026-11-05T09:00:00.000Z",
    ...overrides,
  };
}

describe.runIf(connectionString !== undefined)("Postgres career interview sessions", () => {
  const url = connectionString ?? "";

  it("keeps the store contract per tenant and survives a reopened pool", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "career_interview");
    let tenancy = await openTenancy();
    try {
      const storeA = tenancy.forTenant("tenant-a").careerInterviewSessions;
      const storeB = tenancy.forTenant("tenant-b").careerInterviewSessions;
      const first = session("cis_fixture0001");
      await storeA.insert(first);
      await expect(storeA.insert(first)).rejects.toMatchObject({ code: "duplicate_session" });
      expect(await storeB.get("owner", first.id)).toBeUndefined();
      expect(await storeA.latestUnfinished("owner")).toEqual(first);

      await storeA.replace({
        ...first,
        status: "paused",
        created_at: "2030-01-01T00:00:00.000Z",
        updated_at: "2030-01-02T00:00:00.000Z",
      });
      await storeA.insert(
        session("cis_fixture0002", {
          status: "closed",
          topics: [],
          created_at: "2026-11-06T09:00:00.000Z",
          updated_at: "2026-11-06T09:00:00.000Z",
        }),
      );
      await expect(storeA.replace({ ...first, workspace_id: "other" })).rejects.toMatchObject({
        code: "session_not_found",
      });

      await tenancy.close();
      tenancy = await openTenancy();
      const reopened = tenancy.forTenant("tenant-a").careerInterviewSessions;
      expect(await reopened.get("owner", first.id)).toMatchObject({
        status: "paused",
        created_at: "2026-11-05T09:00:00.000Z",
      });
      expect((await reopened.list("owner", 10)).map((entry) => entry.id)).toEqual([
        "cis_fixture0002",
        "cis_fixture0001",
      ]);
      expect((await reopened.latestUnfinished("owner"))?.id).toBe("cis_fixture0001");
      expect([...(await reopened.declinedTopicKeys("owner"))]).toEqual([
        "untold-theme:volunteering:abcd1234",
      ]);
      expect([
        ...(await tenancy.forTenant("tenant-b").careerInterviewSessions.declinedTopicKeys("owner")),
      ]).toEqual([]);
    } finally {
      await tenancy.close();
      await drop();
    }
  });
});
