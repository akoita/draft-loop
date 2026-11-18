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

  it("hides an entry whose email already redeemed an invite, and counts the same way", async () => {
    await withDirectory(async ({ betaWaitlist, betaInvites }) => {
      await betaWaitlist.join({ email: "ada@example.test", consentVersion, now });
      // A minute later, so the oldest-first order does not fall back to the random entry id.
      await betaWaitlist.join({
        email: "bob@example.test",
        consentVersion,
        now: new Date(now.getTime() + 60_000),
      });
      // Invited outside the waitlist, so the entry stays; then the invite is redeemed.
      const { code } = await betaInvites.create({ email: "ada@example.test", now });
      const open = await betaWaitlist.list();
      expect(open.map((entry) => entry.email)).toEqual(["ada@example.test", "bob@example.test"]);

      const result = await betaInvites.redeem({
        code,
        verifiedEmail: "ada@example.test",
        cap: 10,
        organisationName: "My applications",
        termsVersion: "2026-11-17",
        now,
      });
      expect(result.redeemed).toBe(true);

      const entries = await betaWaitlist.list();
      expect(entries.map((entry) => entry.email)).toEqual(["bob@example.test"]);
      await expect(betaWaitlist.count()).resolves.toBe(1);
      await expect(betaWaitlist.count("ada")).resolves.toBe(0);
      const bob = entries[0]?.entryId ?? "";
      await expect(betaWaitlist.invite({ entryId: bob, now })).resolves.toMatchObject({
        invite: { email: "bob@example.test", state: "open" },
      });
    });
  });

  it("pages and searches the entries, oldest first, with literal wildcards", async () => {
    await withDirectory(async ({ betaWaitlist }) => {
      for (const [index, email] of [
        "ada@example.test",
        "bob_1@example.test",
        "ann@other.test",
      ].entries()) {
        await betaWaitlist.join({
          email,
          consentVersion,
          now: new Date(now.getTime() + index * 60_000),
        });
      }

      const second = await betaWaitlist.list({ limit: 1, offset: 1 });
      expect(second.map((entry) => entry.email)).toEqual(["bob_1@example.test"]);
      const searched = await betaWaitlist.list({ query: "EXAMPLE" });
      expect(searched.map((entry) => entry.email)).toEqual([
        "ada@example.test",
        "bob_1@example.test",
      ]);
      await expect(betaWaitlist.count("example")).resolves.toBe(2);
      await expect(betaWaitlist.count()).resolves.toBe(3);
      await expect(betaWaitlist.count("_1")).resolves.toBe(1);
      await expect(betaWaitlist.count("%")).resolves.toBe(0);
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

  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const spacing = { resendAfterMs: 10 * 60_000, maxSends: 3 };
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it("keeps an unconfirmed entry off the list until its link is opened", async () => {
    await withDirectory(async ({ betaWaitlist }) => {
      await expect(
        betaWaitlist.joinUnconfirmed({
          email: "ada@example.test",
          consentVersion,
          locale: "fr",
          tokenHash: hashA,
          now,
          ...spacing,
        }),
      ).resolves.toBe("send");
      await expect(betaWaitlist.list()).resolves.toEqual([]);
      await expect(betaWaitlist.count()).resolves.toBe(0);

      await expect(
        betaWaitlist.confirm({ tokenHash: hashB, now: later(1), validMs: 48 * 3_600_000 }),
      ).resolves.toBe(false);
      await expect(
        betaWaitlist.confirm({ tokenHash: hashA, now: later(1), validMs: 48 * 3_600_000 }),
      ).resolves.toBe(true);
      // A second click on the same link still says it worked.
      await expect(
        betaWaitlist.confirm({ tokenHash: hashA, now: later(2), validMs: 48 * 3_600_000 }),
      ).resolves.toBe(true);
      expect((await betaWaitlist.list()).map((entry) => entry.email)).toEqual(["ada@example.test"]);
    });
  });

  it("refuses an expired link and invites only confirmed entries", async () => {
    await withDirectory(async ({ betaWaitlist }) => {
      await betaWaitlist.joinUnconfirmed({
        email: "ada@example.test",
        consentVersion,
        tokenHash: hashA,
        now,
        ...spacing,
      });
      await expect(
        betaWaitlist.confirm({ tokenHash: hashA, now: later(49 * 60), validMs: 48 * 3_600_000 }),
      ).resolves.toBe(false);
      await expect(betaWaitlist.deleteUnconfirmedBefore(later(48 * 60))).resolves.toBe(1);
      await expect(betaWaitlist.list()).resolves.toEqual([]);
    });
  });

  it("spaces and caps the emails one address receives, and never re-sends a confirmed one", async () => {
    await withDirectory(async ({ betaWaitlist }) => {
      const join = (tokenHash: string, at: Date, email = "ada@example.test") =>
        betaWaitlist.joinUnconfirmed({ email, consentVersion, tokenHash, now: at, ...spacing });

      await expect(join(hashA, now)).resolves.toBe("send");
      await expect(join(hashB, later(5))).resolves.toBe("skip");
      await expect(join(hashB, later(11))).resolves.toBe("send");
      await expect(join("c".repeat(64), later(22))).resolves.toBe("send");
      await expect(join("d".repeat(64), later(33))).resolves.toBe("skip");
      // The newest link is the one that works.
      await expect(
        betaWaitlist.confirm({ tokenHash: hashA, now: later(34), validMs: 48 * 3_600_000 }),
      ).resolves.toBe(false);
      await expect(
        betaWaitlist.confirm({
          tokenHash: "c".repeat(64),
          now: later(34),
          validMs: 48 * 3_600_000,
        }),
      ).resolves.toBe(true);

      // An entry from before confirmation existed counts as confirmed and gets no email.
      await betaWaitlist.join({ email: "bob@example.test", consentVersion, now });
      await expect(join("e".repeat(64), later(60), "bob@example.test")).resolves.toBe("skip");
      await expect(betaWaitlist.count()).resolves.toBe(2);
    });
  });
});
