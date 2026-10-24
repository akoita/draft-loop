import { ConsentLedgerError } from "@draft-loop/storage/consent-ledger";
import { describe, expect, it } from "vitest";
import { createSqlPool } from "./sql-client.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("Postgres consent ledger", () => {
  const url = connectionString ?? "";

  it("appends entries per tenant and takes each kind's latest as current", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "consent");
    const tenancy = await openTenancy();
    try {
      const ledgerA = tenancy.forTenant("tenant-a").consentLedger;
      const ledgerB = tenancy.forTenant("tenant-b").consentLedger;
      const stored = await ledgerA.record({
        workspaceId: "workspace-1",
        kind: "material-storage",
        action: "granted",
        basis: "contract",
        recordedBy: { kind: "member", memberId: "member-1" },
        note: "Placement agreement signed.",
      });
      const shared = await ledgerA.record({
        workspaceId: "workspace-1",
        kind: "provider-transmission",
        action: "granted",
        basis: "candidate-consent",
        recordedBy: { kind: "owner" },
        providers: ["openai", "anthropic"],
      });
      const withdrawn = await ledgerA.record({
        workspaceId: "workspace-1",
        kind: "provider-transmission",
        action: "withdrawn",
        basis: "candidate-consent",
        recordedBy: { kind: "member", memberId: "member-2" },
      });

      expect(stored).toMatchObject({
        workspaceId: "workspace-1",
        kind: "material-storage",
        action: "granted",
        basis: "contract",
        recordedBy: { kind: "member", memberId: "member-1" },
        providers: [],
        note: "Placement agreement signed.",
      });
      expect(stored.id).toMatch(/^consent-/u);
      expect(Number.isNaN(Date.parse(stored.recordedAt))).toBe(false);
      expect(shared).toMatchObject({ providers: ["anthropic", "openai"] });
      expect(shared).not.toHaveProperty("note");

      await expect(ledgerA.history("workspace-1")).resolves.toEqual([stored, shared, withdrawn]);
      await expect(ledgerA.current("workspace-1")).resolves.toEqual({
        "material-storage": stored,
        "provider-transmission": withdrawn,
      });
      await expect(ledgerA.current("workspace-2")).resolves.toEqual({});

      // The other tenant sees none of it, and its own entries under the same id stay its own.
      await expect(ledgerB.history("workspace-1")).resolves.toEqual([]);
      const other = await ledgerB.record({
        workspaceId: "workspace-1",
        kind: "material-storage",
        action: "granted",
        basis: "legitimate-interest",
        recordedBy: { kind: "owner" },
      });
      await expect(ledgerB.history("workspace-1")).resolves.toEqual([other]);
      await expect(ledgerA.history("workspace-1")).resolves.toHaveLength(3);

      await expect(
        ledgerA.record({
          workspaceId: "workspace-1",
          kind: "provider-transmission",
          action: "granted",
          basis: "contract",
          recordedBy: { kind: "owner" },
          providers: ["openai"],
        }),
      ).rejects.toBeInstanceOf(ConsentLedgerError);
    } finally {
      await tenancy.close();
      await drop();
    }
  });

  it("lets the runtime role only read and append, and refuses every update", async () => {
    const { admin, schema, openTenancy, drop } = await createTestSchema(url, "consent");
    const tenancy = await openTenancy();
    const runtime = createSqlPool({ connectionString: runtimeRoleUrl(url), schema });
    try {
      const entry = await tenancy.forTenant("tenant-a").consentLedger.record({
        workspaceId: "workspace-1",
        kind: "material-storage",
        action: "granted",
        basis: "candidate-consent",
        recordedBy: { kind: "owner" },
      });
      const asTenant = runtime.forTenant("tenant-a");
      await expect(
        asTenant.query("UPDATE consent_events SET action = 'withdrawn' WHERE id = $1", [entry.id]),
      ).rejects.toThrow(/permission denied/u);
      await expect(
        asTenant.query("DELETE FROM consent_events WHERE id = $1", [entry.id]),
      ).rejects.toThrow(/permission denied/u);
      // The table's own checks hold for any writer: a provider grant names its providers.
      await expect(
        asTenant.query(
          `INSERT INTO consent_events (id, workspace_id, kind, action, basis, recorded_by)
           VALUES ('consent-x', 'workspace-1', 'provider-transmission', 'granted',
                   'candidate-consent', 'owner')`,
        ),
      ).rejects.toThrow(/check constraint/u);
      // Even the owning role cannot rewrite an entry.
      await expect(
        admin.query("UPDATE consent_events SET action = 'withdrawn' WHERE id = $1", [entry.id]),
      ).rejects.toThrow(/immutable/u);
      await expect(
        tenancy.forTenant("tenant-a").consentLedger.history("workspace-1"),
      ).resolves.toEqual([entry]);
    } finally {
      await runtime.close();
      await tenancy.close();
      await drop();
    }
  });
});
