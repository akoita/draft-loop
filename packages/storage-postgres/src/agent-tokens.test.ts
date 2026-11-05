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
        secretHash: hashA,
      });
      await storeA.insert({
        id: "dlat_fixture0002",
        workspaceId: "owner",
        label: "Codex",
        createdAt: "2026-11-04T11:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        secretHash: "b".repeat(64),
      });
      await expect(
        storeB.insert({
          id: "dlat_fixture0003",
          workspaceId: "owner",
          label: "Copy",
          createdAt: "2026-11-04T12:00:00.000Z",
          expiresAt: "2027-01-01T00:00:00.000Z",
          secretHash: hashA,
        }),
      ).rejects.toMatchObject({ code: "duplicate_token" });

      expect(await storeA.findByHash(hashA)).toEqual({
        id: "dlat_fixture0001",
        workspaceId: "owner",
        label: "Claude Code",
        createdAt: "2026-11-04T10:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
      });
      expect(await storeB.findByHash(hashA)).toBeUndefined();
      expect((await storeA.list("owner")).map((token) => token.id)).toEqual([
        "dlat_fixture0002",
        "dlat_fixture0001",
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
});
