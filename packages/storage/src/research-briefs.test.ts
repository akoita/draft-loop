import type { ResearchBrief } from "@draft-loop/schemas/research-brief";
import { describe, expect, it } from "vitest";

import {
  createMemoryResearchBriefStore,
  ResearchBriefStoreError,
  requireResearchBrief,
} from "./research-briefs.js";

// An invented employer and invented pages only.
function researchBriefFixture(id: string, overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return requireResearchBrief({
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
        excerpt: "Example Corp opened a fictional data team in Lyon.",
        published_on: "2026-10-03",
      },
      {
        id: "src_2",
        kind: "company-page",
        url: "https://example.org/about",
        title: "About Example Corp",
        excerpt: "A fictional maker of ledgers.",
      },
    ],
    findings: [
      { id: "fnd_1", text: "Example Corp is building a data team.", source_ids: ["src_1"] },
    ],
    dropped: { flagged: 1, outdated: 2 },
    search_provider: "scripted",
    model: { provider: "anthropic", model: "claude-haiku-5-5" },
    cost_usd: 0.05,
    created_at: "2026-11-08T09:00:00.000Z",
    ...overrides,
  });
}

describe("research briefs in memory", () => {
  it("keeps each brief, lists an application's newest first and deletes one", async () => {
    const store = createMemoryResearchBriefStore();
    const first = researchBriefFixture("rbr_fixture0001");
    await store.insert(first);
    await expect(store.insert(first)).rejects.toMatchObject({ code: "duplicate_brief" });
    await store.insert(
      researchBriefFixture("rbr_fixture0002", { created_at: "2026-11-08T10:00:00.000Z" }),
    );
    await store.insert(
      researchBriefFixture("rbr_fixture0003", { application_id: "application-2" }),
    );

    expect(await store.get("owner", first.id)).toEqual(first);
    expect(await store.get("other", first.id)).toBeUndefined();
    expect((await store.list("owner", "application-1")).map((brief) => brief.id)).toEqual([
      "rbr_fixture0002",
      "rbr_fixture0001",
    ]);
    expect(await store.list("owner", "application-1", { limit: 1 })).toHaveLength(1);
    expect(await store.delete("other", first.id)).toBe(false);
    expect(await store.delete("owner", first.id)).toBe(true);
    expect(await store.get("owner", first.id)).toBeUndefined();
  });

  it("refuses a finding that cites a source the brief does not keep", () => {
    expect(() =>
      researchBriefFixture("rbr_fixture0004", {
        findings: [{ id: "fnd_1", text: "Unsourced.", source_ids: ["src_9"] }],
      }),
    ).toThrow(ResearchBriefStoreError);
    expect(() =>
      researchBriefFixture("rbr_fixture0005", {
        sources: [
          {
            id: "src_1",
            kind: "web-result",
            url: "javascript:alert(1)",
            title: "Bad",
            excerpt: "",
          },
        ],
        findings: [],
      }),
    ).toThrow(ResearchBriefStoreError);
  });
});
