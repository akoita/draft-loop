import { describe, expect, it } from "vitest";

import { organisationActivityIntervalMs } from "./organisation-activity.js";
import { createPostgresTenantDirectory, type PostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const start = new Date("2026-11-08T10:00:00.000Z");
const later = (ms: number) => new Date(start.getTime() + ms);

describe.runIf(connectionString !== undefined)("Postgres organisation activity (#2538)", () => {
  const url = connectionString ?? "";

  async function withDirectory(
    work: (directory: PostgresTenantDirectory, schema: TestSchema) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(url, "organisation_activity");
    const directory = await createPostgresTenantDirectory({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    try {
      await work(directory, schema);
    } finally {
      await directory.close();
      await schema.drop();
    }
  }

  it("records activity at most once an interval, and a later write clears a warning", async () => {
    await withDirectory(async ({ organisationActivity: activity }) => {
      await expect(activity.touch("org-a", start)).resolves.toBe(true);
      await expect(activity.touch("org-a", later(60_000))).resolves.toBe(false);
      await expect(activity.read("org-a")).resolves.toEqual({
        organisationId: "org-a",
        lastActiveAt: start.toISOString(),
        warnedAt: null,
      });

      await expect(activity.markWarned("org-a", later(1000))).resolves.toBe(true);
      await expect(activity.markWarned("org-a", later(2000))).resolves.toBe(false);
      await activity.clearWarning("org-a");
      await expect(activity.read("org-a")).resolves.toMatchObject({ warnedAt: null });
      await expect(activity.markWarned("org-a", later(1000))).resolves.toBe(true);
      const next = later(organisationActivityIntervalMs);
      await expect(activity.touch("org-a", next)).resolves.toBe(true);
      await expect(activity.read("org-a")).resolves.toEqual({
        organisationId: "org-a",
        lastActiveAt: next.toISOString(),
        warnedAt: null,
      });
      await expect(activity.read("org-unknown")).resolves.toBeUndefined();
    });
  });

  it("lists organisations inactive since a cutoff, oldest first", async () => {
    await withDirectory(async ({ organisationActivity: activity }) => {
      await activity.touch("org-new", later(10 * organisationActivityIntervalMs));
      await activity.touch("org-old", start);
      await activity.touch("org-mid", later(2 * organisationActivityIntervalMs));
      await activity.markWarned("org-old", later(1000));

      const inactive = await activity.inactiveSince(later(5 * organisationActivityIntervalMs), 10);

      expect(inactive.map((row) => row.organisationId)).toEqual(["org-old", "org-mid"]);
      expect(inactive[0]?.warnedAt).toBe(later(1000).toISOString());
      await expect(activity.inactiveSince(start, 0)).rejects.toThrow(/limit/u);
    });
  });

  it("removes the organisation's row when the organisation is erased", async () => {
    await withDirectory(async (directory, schema) => {
      await schema.admin.query("INSERT INTO organisations (id, name) VALUES ($1, $2)", [
        "org-gone",
        "Fictional organisation",
      ]);
      await directory.organisationActivity.touch("org-gone", start);
      await directory.organisationActivity.touch("org-kept", start);
      const tenancy = await schema.openTenancy();
      try {
        const erasure = tenancy.forTenant("org-gone").organisationErasure;
        await erasure.close();
        await erasure.eraseRemainder();
      } finally {
        await tenancy.close();
      }

      await expect(
        schema.admin.query("SELECT organisation_id FROM organisation_activity"),
      ).resolves.toEqual([{ organisation_id: "org-kept" }]);
    });
  });
});
