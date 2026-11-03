import type { WorkJournalStoredNote } from "@draft-loop/schemas/work-journal";
import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

// Fictional project, repository and links only.
function stored(id: string, overrides: Partial<WorkJournalStoredNote> = {}): WorkJournalStoredNote {
  return {
    id,
    tenant_id: "tenant-a",
    workspace_id: "owner",
    status: "pending",
    content: {
      title: "Card payments for the Fernhill booking site",
      summary:
        "Added card payments to the booking flow with a hosted checkout page and webhook handling for paid bookings.",
      period: { start: "2026-10-12" },
      project: { name: "Fernhill bookings", visibility: "private" },
      technologies: ["TypeScript", "Stripe"],
      category: "payments",
      candidate_role: ["implemented"],
      links: [],
      metrics: [],
    },
    dedupe_key: `title:${id}`,
    possible_duplicate_of: [],
    screening: { verdict: "clear", signals: [], screened_at: "2026-11-03T10:00:00.000Z" },
    edit_count: 0,
    created_at: "2026-11-03T10:00:00.000Z",
    updated_at: "2026-11-03T10:00:00.000Z",
    ...overrides,
  };
}

describe.runIf(connectionString !== undefined)("Postgres work journal notes", () => {
  const url = connectionString ?? "";

  it("keeps the store contract per tenant: intake, keys, replace, listing and ageing", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "work_journal");
    const tenancy = await openTenancy();
    try {
      const storeA = tenancy.forTenant("tenant-a").workJournalNotes;
      const storeB = tenancy.forTenant("tenant-b").workJournalNotes;

      expect(await storeA.intake("owner")).toEqual({ enabled: false });
      await storeA.setIntake("owner", true, "2026-11-03T09:00:00.000Z");
      expect(await storeA.intake("owner")).toEqual({
        enabled: true,
        changedAt: "2026-11-03T09:00:00.000Z",
      });
      expect(await storeB.intake("owner")).toEqual({ enabled: false });

      const first = stored("wjn_fixture0001", { dedupe_key: "pr:fixture" });
      await storeA.insert(first);
      await expect(
        storeA.insert(stored("wjn_fixture0002", { dedupe_key: "pr:fixture" })),
      ).rejects.toMatchObject({ code: "duplicate_key" });
      expect(await storeB.get("owner", first.id)).toBeUndefined();
      expect(await storeA.holderOfKey("pr:fixture")).toEqual({ kind: "note", note: first });

      await storeA.insert(
        stored("wjn_fixture0003", {
          created_at: "2026-11-03T11:00:00.000Z",
          updated_at: "2026-11-03T11:00:00.000Z",
        }),
      );
      expect((await storeA.list({ workspaceId: "owner", limit: 10 })).map((n) => n.id)).toEqual([
        "wjn_fixture0003",
        "wjn_fixture0001",
      ]);
      expect(
        await storeA.list({ workspaceId: "owner", project: "FERNHILL BOOKINGS", limit: 1 }),
      ).toHaveLength(1);
      expect(await storeA.countCreatedSince("owner", "2026-11-03T10:30:00.000Z")).toBe(1);
      expect(await storeA.countPending()).toBe(2);
      expect(await storeB.countPending()).toBe(0);

      await storeA.replace({
        ...first,
        status: "discarded",
        created_at: "2030-01-01T00:00:00.000Z",
        updated_at: "2026-11-03T12:00:00.000Z",
      });
      const discarded = await storeA.get("owner", first.id);
      expect(discarded).toMatchObject({
        status: "discarded",
        created_at: "2026-11-03T10:00:00.000Z",
      });
      await storeA.insert(stored("wjn_fixture0004", { dedupe_key: "pr:fixture" }));

      expect(await storeA.forgetDiscarded("2026-12-03T12:00:00.000Z")).toBe(1);
      expect(await storeA.get("owner", first.id)).toBeUndefined();
      const fourth = await storeA.get("owner", "wjn_fixture0004");
      if (fourth === undefined) throw new Error("The fourth note is missing.");
      await storeA.replace({ ...fourth, status: "discarded" });
      await storeA.forgetDiscarded("2026-12-03T12:00:00.000Z");
      expect(await storeA.holderOfKey("pr:fixture")).toEqual({
        kind: "forgotten",
        noteId: "wjn_fixture0004",
      });

      expect(await storeA.deletePending("owner")).toBe(1);
      expect(await storeA.list({ workspaceId: "owner", limit: 10 })).toEqual([]);
      await expect(storeA.replace(first)).rejects.toMatchObject({ code: "note_not_found" });
    } finally {
      await tenancy.close();
      await drop();
    }
  });
});
