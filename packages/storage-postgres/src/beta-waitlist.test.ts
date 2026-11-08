import { describe, expect, it } from "vitest";
import { createPostgresTenantDirectory, type PostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const now = new Date("2026-11-08T10:00:00.000Z");
const consentVersion = "waitlist-2026-11-08";

describe.runIf(connectionString !== undefined)("Postgres beta waitlist", () => {
  const url = connectionString ?? "";

  async function withDirectory(
    work: (directory: PostgresTenantDirectory) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(url, "beta_waitlist");
    const directory = await createPostgresTenantDirectory({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    try {
      await work(directory);
    } finally {
      await directory.close();
      await schema.drop();
    }
  }

  it("lists an email once, keeping the first consent", async () => {
    await withDirectory(async ({ betaWaitlist }) => {
      await expect(
        betaWaitlist.join({ email: " Ada@Example.Test ", consentVersion, now }),
      ).resolves.toBe(true);
      await expect(
        betaWaitlist.join({ email: "ada@example.test", consentVersion: "later", now }),
      ).resolves.toBe(false);

      const entries = await betaWaitlist.list();
      expect(entries).toEqual([
        {
          entryId: expect.any(String),
          email: "ada@example.test",
          consentVersion,
          joinedAt: now.toISOString(),
        },
      ]);
    });
  });

  it("turns an entry into an open invite and deletes the entry", async () => {
    await withDirectory(async ({ betaWaitlist, betaInvites }) => {
      await betaWaitlist.join({ email: "ada@example.test", consentVersion, now });
      const [entry] = await betaWaitlist.list();

      const created = await betaWaitlist.invite({ entryId: entry?.entryId ?? "", now });

      expect(created?.invite).toMatchObject({ email: "ada@example.test", state: "open" });
      expect(created?.code).toMatch(/^[2-9A-HJKMNP-Z]{16}$/u);
      await expect(betaWaitlist.list()).resolves.toEqual([]);
      await expect(betaInvites.list()).resolves.toHaveLength(1);
      await expect(
        betaWaitlist.invite({ entryId: entry?.entryId ?? "", now }),
      ).resolves.toBeUndefined();
    });
  });

  it("deletes entries that joined before the cutoff", async () => {
    await withDirectory(async ({ betaWaitlist }) => {
      const old = new Date("2026-04-01T00:00:00.000Z");
      await betaWaitlist.join({ email: "old@example.test", consentVersion, now: old });
      await betaWaitlist.join({ email: "new@example.test", consentVersion, now });

      await expect(
        betaWaitlist.deleteJoinedBefore(new Date("2026-05-08T10:00:00.000Z")),
      ).resolves.toBe(1);
      expect((await betaWaitlist.list()).map((entry) => entry.email)).toEqual(["new@example.test"]);
    });
  });
});
