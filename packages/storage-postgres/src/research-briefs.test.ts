import type { ResearchBrief } from "@draft-loop/schemas/research-brief";
import { describe, expect, it } from "vitest";
import { createTestSchema } from "./test-schema.js";

/** Set by the Postgres CI job and by developers with a local server; skipped without it. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

// An invented employer and invented pages only.
function brief(id: string, overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    id,
    workspace_id: "owner",
    application_id: "application-1",
    queries: ["Example Corp data analyst"],
    from_date: "2025-11-08",
    sources: [
      {
        id: "src_1",
        kind: "web-result",
        url: "https://example.org/news",
        title: "Example Corp opens a data team",
        excerpt: "A fictional data team.",
        published_on: "2026-10-03",
      },
    ],
    findings: [{ id: "fnd_1", text: "Example Corp is hiring.", source_ids: ["src_1"] }],
    dropped: { flagged: 0, outdated: 1 },
    search_provider: "scripted",
    model: { provider: "anthropic", model: "claude-haiku-5-5" },
    cost_usd: 0.05,
    created_at: "2026-11-08T09:00:00.000Z",
    ...overrides,
  };
}

describe.runIf(connectionString !== undefined)("Postgres research briefs", () => {
  const url = connectionString ?? "";

  it("keeps the store contract per tenant and survives a reopened pool", async () => {
    const { openTenancy, drop } = await createTestSchema(url, "research_briefs");
    let tenancy = await openTenancy();
    try {
      const storeA = tenancy.forTenant("tenant-a").researchBriefs;
      const first = brief("rbr_fixture0001");
      await storeA.insert(first);
      await expect(storeA.insert(first)).rejects.toMatchObject({ code: "duplicate_brief" });
      expect(await tenancy.forTenant("tenant-b").researchBriefs.get("owner", first.id)).toBe(
        undefined,
      );
      await storeA.insert(brief("rbr_fixture0002", { created_at: "2026-11-08T10:00:00.000Z" }));
      await storeA.insert(brief("rbr_fixture0003", { application_id: "application-2" }));

      await tenancy.close();
      tenancy = await openTenancy();
      const reopened = tenancy.forTenant("tenant-a").researchBriefs;
      expect(await reopened.get("owner", first.id)).toEqual(first);
      const ids = async (limit?: number) =>
        (await reopened.list("owner", "application-1", limit === undefined ? {} : { limit })).map(
          (entry) => entry.id,
        );
      expect(await ids()).toEqual(["rbr_fixture0002", "rbr_fixture0001"]);
      expect(await ids(1)).toEqual(["rbr_fixture0002"]);
      expect(await tenancy.forTenant("tenant-b").researchBriefs.delete("owner", first.id)).toBe(
        false,
      );
      expect(await reopened.delete("owner", first.id)).toBe(true);
      expect(await ids()).toEqual(["rbr_fixture0002"]);
    } finally {
      await tenancy.close();
      await drop();
    }
  });
});
