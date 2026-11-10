import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const hashA = "a".repeat(64);

describe.runIf(connectionString !== undefined)("Postgres agent tokens", () => {
  const url = connectionString ?? "";

  it("stores only a hash, finds, lists and revokes per tenant", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "agent_tokens");
    const tenancy = await openTenancy();
    try {
      const storeA = tenancy.forTenant("tenant-a").agentTokens;
      const storeB = tenancy.forTenant("tenant-b").agentTokens;

      await storeA.insert({
        id: "dlat_fixture0001",
        workspaceId: "owner",
        label: " Claude Code ",
        createdAt: "2026-11-04T10:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        scopes: ["journal"],
        secretHash: hashA,
      });
      await storeA.insert({
        id: "dlat_fixture0002",
        workspaceId: "owner",
        label: "Codex",
        createdAt: "2026-11-04T11:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        scopes: ["journal", "applications:read", "jobs:write"],
        secretHash: "b".repeat(64),
      });
      await expect(
        storeB.insert({
          id: "dlat_fixture0003",
          workspaceId: "owner",
          label: "Copy",
          createdAt: "2026-11-04T12:00:00.000Z",
          expiresAt: "2027-01-01T00:00:00.000Z",
          scopes: ["journal"],
          secretHash: hashA,
        }),
      ).rejects.toMatchObject({ code: "duplicate_token" });

      expect(await storeA.findByHash(hashA)).toEqual({
        id: "dlat_fixture0001",
        workspaceId: "owner",
        label: "Claude Code",
        createdAt: "2026-11-04T10:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        scopes: ["journal"],
      });
      expect(await storeB.findByHash(hashA)).toBeUndefined();
      expect((await storeA.list("owner")).map((token) => token.id)).toEqual([
        "dlat_fixture0002",
        "dlat_fixture0001",
      ]);
      expect((await storeA.list("owner"))[0]?.scopes).toEqual([
        "journal",
        "applications:read",
        "jobs:write",
      ]);
      expect(await storeB.list("owner")).toEqual([]);

      expect(await storeB.revoke("owner", "dlat_fixture0001", "2026-11-04T13:00:00.000Z")).toBe(
        false,
      );
      expect(await storeA.revoke("owner", "dlat_fixture0001", "2026-11-04T13:00:00.000Z")).toBe(
        true,
      );
      expect(await storeA.revoke("owner", "dlat_fixture0001", "2026-11-04T14:00:00.000Z")).toBe(
        false,
      );
      expect(await storeA.findByHash(hashA)).toMatchObject({
        revokedAt: "2026-11-04T13:00:00.000Z",
      });
    } finally {
      await tenancy.close();
      await drop();
    }
  });

  it("reserves spend once per key within the cap, per month and per tenant", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "agent_token_spend");
    const tenancy = await openTenancy();
    try {
      const storeA = tenancy.forTenant("tenant-a").agentTokens;
      const storeB = tenancy.forTenant("tenant-b").agentTokens;
      await storeA.insert({
        id: "dlat_fixture0010",
        workspaceId: "owner",
        label: "Claude Code",
        createdAt: "2026-11-04T10:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        scopes: ["applications:read", "runs:start"],
        monthlyCapCents: 500,
        secretHash: hashA,
      });
      const at = { workspaceId: "owner", id: "dlat_fixture0010", month: "2026-11", cents: 200 };

      expect(await storeA.findByHash(hashA)).toMatchObject({ monthlyCapCents: 500 });
      expect(await storeB.reserveSpend({ ...at, key: "a" })).toEqual({ outcome: "no_cap" });
      const [first, second] = await Promise.all([
        storeA.reserveSpend({ ...at, key: "a" }),
        storeA.reserveSpend({ ...at, key: "b" }),
      ]);
      expect([first?.outcome, second?.outcome]).toEqual(["reserved", "reserved"]);
      expect(await storeA.reserveSpend({ ...at, key: "a" })).toEqual({
        outcome: "replayed",
        spentCents: 400,
      });
      expect(await storeA.reserveSpend({ ...at, key: "c" })).toEqual({
        outcome: "cap_reached",
        spentCents: 400,
        capCents: 500,
      });
      await storeA.releaseSpend({ ...at, key: "b" });
      await storeA.releaseSpend({ ...at, key: "b" });
      expect(await storeA.findByHash(hashA)).toMatchObject({
        spend: { month: "2026-11", cents: 200 },
      });
      expect(await storeA.reserveSpend({ ...at, month: "2026-12", key: "a" })).toEqual({
        outcome: "reserved",
        spentCents: 200,
      });
    } finally {
      await tenancy.close();
      await drop();
    }
  });
});
