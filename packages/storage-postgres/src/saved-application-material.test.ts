import type { SavedApplicationMaterial } from "@draft-loop/schemas/saved-application-material";
import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

// Invented paragraphs and facts only.
function draft(
  id: string,
  overrides: Partial<SavedApplicationMaterial> = {},
): SavedApplicationMaterial {
  return {
    id,
    workspace_id: "owner",
    application_id: "application-1",
    kind: "cover-letter",
    items: [
      {
        question: "",
        text: "I led the fictional migration of a ledger service.",
        citations: [{ fact_id: "fact-1", text: "experience outcome: Fictional migration" }],
      },
    ],
    model: { provider: "anthropic", model: "claude-sonnet-5-5" },
    prompt_version: "application-material-v4",
    cost_usd: 0.04,
    created_at: "2026-11-07T09:00:00.000Z",
    ...overrides,
  };
}

describe.runIf(connectionString !== undefined)("Postgres saved application material", () => {
  const url = connectionString ?? "";

  it("keeps the store contract per tenant and survives a reopened pool", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "saved_material");
    let tenancy = await openTenancy();
    try {
      const storeA = tenancy.forTenant("tenant-a").savedApplicationMaterial;
      const storeB = tenancy.forTenant("tenant-b").savedApplicationMaterial;
      const first = draft("amd_fixture0001");
      await storeA.insert(first);
      await expect(storeA.insert(first)).rejects.toMatchObject({ code: "duplicate_material" });
      expect(await storeB.get("owner", first.id)).toBeUndefined();
      await storeA.insert(draft("amd_fixture0002", { created_at: "2026-11-07T10:00:00.000Z" }));
      await storeA.insert(
        draft("amd_fixture0003", {
          kind: "interview-questions",
          items: [{ question: "Why this role?", text: "Fictional answer.", citations: [] }],
        }),
      );
      await storeA.insert(draft("amd_fixture0004", { application_id: "application-2" }));
      const guide = draft("amd_fixture0005", {
        application_id: "application-3",
        kind: "interview-guide",
        items: [
          { section: "read-first", question: "", text: "Fictional takeaway.", citations: [] },
          {
            section: "questions",
            question: "Why this role?",
            text: "Fictional angle.",
            trap: "Fictional trap.",
            citations: [],
          },
        ],
      });
      await storeA.insert(guide);
      expect(await storeA.list("owner", "application-3", { kind: "interview-guide" })).toEqual([
        guide,
      ]);

      await tenancy.close();
      tenancy = await openTenancy();
      const reopened = tenancy.forTenant("tenant-a").savedApplicationMaterial;
      expect(await reopened.get("owner", first.id)).toEqual(first);
      const ids = async (options?: { kind?: SavedApplicationMaterial["kind"]; limit?: number }) =>
        (await reopened.list("owner", "application-1", options)).map((entry) => entry.id);
      expect(await ids()).toEqual(["amd_fixture0002", "amd_fixture0003", "amd_fixture0001"]);
      expect(await ids({ kind: "cover-letter" })).toEqual(["amd_fixture0002", "amd_fixture0001"]);
      expect(await ids({ limit: 1 })).toEqual(["amd_fixture0002"]);
      expect(
        await tenancy.forTenant("tenant-b").savedApplicationMaterial.delete("owner", first.id),
      ).toBe(false);
      expect(await reopened.delete("owner", first.id)).toBe(true);
      expect(await reopened.delete("owner", first.id)).toBe(false);
      expect(await ids({ kind: "cover-letter" })).toEqual(["amd_fixture0002"]);
    } finally {
      await tenancy.close();
      await drop();
    }
  });
});
