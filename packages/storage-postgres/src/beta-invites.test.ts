import { describe, expect, it } from "vitest";
import { newBetaInviteCode, normalizeBetaInviteCode } from "./beta-invites.js";
import { createPostgresTenantDirectory, type PostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const issuer = "https://identity.example.test/realms/draft-loop";
const now = new Date("2026-11-08T10:00:00.000Z");

describe("beta invite codes", () => {
  it("are 16 unambiguous characters and match without case, spaces or dashes", () => {
    const code = newBetaInviteCode();
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{16}$/u);
    expect(normalizeBetaInviteCode(` ${code.slice(0, 8).toLowerCase()}-${code.slice(8)} `)).toBe(
      code,
    );
  });
});

describe.runIf(connectionString !== undefined)("Postgres beta invites", () => {
  const url = connectionString ?? "";

  async function withDirectory(
    work: (directory: PostgresTenantDirectory, schema: TestSchema) => Promise<void>,
  ): Promise<void> {
    const schema = await createTestSchema(url, "beta_invites");
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

  const redeem = (
    directory: PostgresTenantDirectory,
    code: string,
    verifiedEmail: string,
    cap = 25,
  ) =>
    directory.betaInvites.redeem({
      code,
      verifiedEmail,
      cap,
      organisationName: "My applications",
      now,
    });

  it("redeems a valid code once into an organisation the sign-in then joins as owner", async () => {
    await withDirectory(async (directory, schema) => {
      const { invite, code } = await directory.betaInvites.create({
        email: " Ada@Example.Test ",
        now,
      });
      expect(invite).toMatchObject({ email: "ada@example.test", state: "open" });
      const stored = await schema.admin.query("SELECT code_hash FROM beta_invites");
      expect(JSON.stringify(stored)).not.toContain(code);

      const result = await redeem(directory, code.toLowerCase(), "ada@example.test");
      if (!result.redeemed) throw new Error(`refused: ${result.refusal}`);
      const member = await directory.resolveSignIn({
        issuer,
        subject: "ada",
        email: "ada@example.test",
        emailVerified: true,
      });
      expect(member).toEqual({
        tenantId: result.organisationId,
        memberId: result.memberId,
        role: "owner",
      });

      await expect(redeem(directory, code, "ada@example.test")).resolves.toEqual({
        redeemed: false,
        refusal: "invite_used",
      });
      const [listed] = await directory.betaInvites.list();
      expect(listed).toMatchObject({ state: "redeemed", organisationId: result.organisationId });
      await expect(directory.betaInvites.redeemedCount()).resolves.toBe(1);
    });
  });

  it("refuses an unknown code, another email and a revoked code, creating nothing", async () => {
    await withDirectory(async (directory, schema) => {
      const { invite, code } = await directory.betaInvites.create({
        email: "ada@example.test",
        now,
      });
      await expect(redeem(directory, newBetaInviteCode(), "ada@example.test")).resolves.toEqual({
        redeemed: false,
        refusal: "invite_unknown",
      });
      await expect(redeem(directory, code, "eve@example.test")).resolves.toEqual({
        redeemed: false,
        refusal: "invite_email_mismatch",
      });
      await expect(directory.betaInvites.revoke({ inviteId: invite.inviteId, now })).resolves.toBe(
        true,
      );
      await expect(directory.betaInvites.revoke({ inviteId: invite.inviteId, now })).resolves.toBe(
        false,
      );
      await expect(redeem(directory, code, "ada@example.test")).resolves.toEqual({
        redeemed: false,
        refusal: "invite_revoked",
      });
      await expect(schema.admin.query("SELECT id FROM organisations")).resolves.toEqual([]);
    });
  });

  it("refuses past the cap, and a cap of 0 closes sign-up", async () => {
    await withDirectory(async (directory) => {
      const first = await directory.betaInvites.create({ email: "ada@example.test", now });
      const second = await directory.betaInvites.create({ email: "bob@example.test", now });
      await expect(redeem(directory, first.code, "ada@example.test", 0)).resolves.toEqual({
        redeemed: false,
        refusal: "beta_full",
      });
      await expect(redeem(directory, first.code, "ada@example.test", 1)).resolves.toMatchObject({
        redeemed: true,
      });
      await expect(redeem(directory, second.code, "bob@example.test", 1)).resolves.toEqual({
        redeemed: false,
        refusal: "beta_full",
      });
      await expect(
        directory.betaInvites.redeem({
          code: second.code,
          verifiedEmail: "bob@example.test",
          cap: -1,
          organisationName: "x",
          now,
        }),
      ).rejects.toThrow(/cap/u);
    });
  });

  it("removes the invite with its organisation's erasure, freeing the seat", async () => {
    await withDirectory(async (directory, schema) => {
      const { code } = await directory.betaInvites.create({ email: "ada@example.test", now });
      const result = await redeem(directory, code, "ada@example.test", 1);
      if (!result.redeemed) throw new Error(`refused: ${result.refusal}`);
      const tenancy = await schema.openTenancy();
      try {
        const erasure = tenancy.forTenant(result.organisationId).organisationErasure;
        await erasure.close();
        await erasure.eraseRemainder();
      } finally {
        await tenancy.close();
      }

      await expect(schema.admin.query("SELECT id FROM beta_invites")).resolves.toEqual([]);
      await expect(directory.betaInvites.redeemedCount()).resolves.toBe(0);
    });
  });

  it("gives the last seat to one of two concurrent redemptions", async () => {
    await withDirectory(async (directory, schema) => {
      const first = await directory.betaInvites.create({ email: "ada@example.test", now });
      const second = await directory.betaInvites.create({ email: "bob@example.test", now });

      const results = await Promise.all([
        redeem(directory, first.code, "ada@example.test", 1),
        redeem(directory, second.code, "bob@example.test", 1),
      ]);

      expect(results.filter((result) => result.redeemed)).toHaveLength(1);
      expect(results.filter((result) => !result.redeemed)).toEqual([
        { redeemed: false, refusal: "beta_full" },
      ]);
      await expect(schema.admin.query("SELECT id FROM organisations")).resolves.toHaveLength(1);
    });
  });
});
