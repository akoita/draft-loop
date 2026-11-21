import { describe, expect, it } from "vitest";

import { seedRecord, seedTenant } from "./erasure-test-seed.js";
import { createPostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("usage funnel reads (#2834)", () => {
  const url = connectionString ?? "";

  it("reads each organisation's first time at each step, inside that organisation only", async () => {
    const schema = await createTestSchema(url, "usage_funnel");
    const directory = await createPostgresTenantDirectory({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    try {
      await seedTenant(schema.admin, "org-north");
      await seedRecord(schema.admin, "org-north", "record-1", { runState: "awaiting-approval" });
      await seedTenant(schema.admin, "org-south");
      await schema.admin.query(
        `UPDATE organisation_members SET status = 'active', activated_at = $2,
           issuer = 'https://id.example.test', subject = 'member-1' WHERE tenant_id = $1`,
        ["org-north", "2026-10-20T09:00:00.000Z"],
      );
      await schema.admin.query(
        `INSERT INTO organisation_activity (organisation_id, last_active_at)
         VALUES ('org-north', now()), ('org-south', now())`,
      );

      await expect(directory.usageFunnel.organisations(10)).resolves.toEqual([
        "org-north",
        "org-south",
      ]);
      const north = await directory.usageFunnel.milestones(
        "org-north",
        new Date("2026-10-01T00:00:00.000Z"),
      );
      expect(north.memberSignIns).toEqual(["2026-10-20T09:00:00.000Z"]);
      expect(north.firsts).toMatchObject({
        signedIn: "2026-10-20T09:00:00.000Z",
        evidence: "2026-10-24T10:00:00.000Z",
        draftFinished: "2026-10-24T10:00:00.000Z",
        exported: "2026-10-24T10:00:00.000Z",
        // The seed's brief is a draft and its run is pending approval.
        briefReviewed: null,
        approved: null,
      });
      expect(north.activity).toEqual(["2026-10-24T00:00:00.000Z"]);

      // Another organisation reads none of north's rows.
      const south = await directory.usageFunnel.milestones(
        "org-south",
        new Date("2026-10-01T00:00:00.000Z"),
      );
      expect(south.memberSignIns).toEqual([]);
      expect(south.firsts).toMatchObject({ signedIn: null, draftFinished: null, exported: null });
      // Activity before the window is left out.
      const later = await directory.usageFunnel.milestones(
        "org-north",
        new Date("2026-11-01T00:00:00.000Z"),
      );
      expect(later.activity).toEqual([]);
      expect(later.memberSignIns).toEqual([]);
    } finally {
      await directory.close();
      await schema.drop();
    }
  });
});
