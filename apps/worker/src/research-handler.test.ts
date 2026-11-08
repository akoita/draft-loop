import { createScriptedResearchSearch } from "@draft-loop/application/research-search";
import { createMemoryResearchBriefStore } from "@draft-loop/storage/research-briefs";
import { describe, expect, it } from "vitest";

import { createResearchHandler, type ResearchHandlerOptions } from "./research-handler.js";

const job = { tenantId: "tenant-a", workspaceId: "ws_fixture", applicationId: "app_fixture0001" };

// An invented employer and invented pages only.
const service = (employer: string | null = "Example Corp") =>
  ({
    readWorkspace: async () => ({ fixtureMode: false, language: "en" }),
    getApplication: async ({ applicationId }: { applicationId: string }) =>
      applicationId === job.applicationId
        ? { briefs: [{ briefId: "brief-1" }], language: "fr" }
        : undefined,
    getOpportunity: async () => ({
      brief: {
        employer: employer === null ? null : { value: employer },
        role: { value: "Data Analyst" },
      },
    }),
  }) as never;

function options(
  overrides: Partial<ResearchHandlerOptions> = {},
  store = createMemoryResearchBriefStore(),
) {
  const search = createScriptedResearchSearch(
    [
      [
        {
          url: "https://example.org/a",
          title: "News",
          excerpt: "A data team.",
          publishedOn: "2026-10-01",
        },
      ],
    ],
    { costUsd: 0.01 },
  );
  const languages: (string | undefined)[] = [];
  const base: ResearchHandlerOptions = {
    serviceFor: () => service(),
    briefsFor: () => store,
    workspaceRoot: () => "hosted:tenant-a/ws_fixture",
    allowProviderData: true,
    portsFor: () => ({
      search,
      screen: async () => true,
      findings: {
        write: async (request) => {
          languages.push(request.language);
          return {
            findings: [{ text: "Example Corp builds a data team.", sourceIds: ["src_1"] }],
            model: { provider: "anthropic", model: "claude-haiku-5-5" },
          };
        },
      },
      findingsSpentUsd: () => 0.002,
    }),
    newId: () => "rbr_fixture0001",
    now: () => new Date("2026-11-08T09:00:00.000Z"),
    ...overrides,
  };
  return { options: base, store, search, languages };
}

describe("research job", () => {
  it("saves the brief and logs ids and counts only", async () => {
    const lines: unknown[] = [];
    const setup = options({ onOutcome: (...line) => lines.push(line) });
    const result = await createResearchHandler(setup.options)({ ...job, windowMonths: 6 });
    expect(result).toEqual({ outcome: "researched", briefId: "rbr_fixture0001" });
    const saved = await setup.store.get(job.workspaceId, "rbr_fixture0001");
    expect(saved).toMatchObject({
      application_id: job.applicationId,
      from_date: "2026-05-08",
      findings: [{ source_ids: ["src_1"] }],
    });
    expect(setup.search.requests[0]?.query).toBe("Example Corp Data Analyst");
    expect(setup.languages).toEqual(["fr"]);
    expect(lines).toEqual([
      [
        { ...job, windowMonths: 6 },
        { outcome: "researched", briefId: "rbr_fixture0001" },
        { sources: 1, findings: 1, dropped: 0, costUsd: 0.032 },
      ],
    ]);
    expect(JSON.stringify(lines)).not.toContain("Example Corp");
  });

  it("makes no call when refused before research", async () => {
    const cases: [Partial<ResearchHandlerOptions>, string][] = [
      [{ recordErased: async () => true }, "record-erased"],
      [{ consentFor: async () => false }, "consent-required"],
      [{ serviceFor: () => service(null) }, "no-employer"],
      [{ allowProviderData: false }, "unavailable"],
      [{ portsFor: () => undefined }, "unavailable"],
    ];
    for (const [overrides, outcome] of cases) {
      const setup = options(overrides);
      expect(await createResearchHandler(setup.options)(job)).toEqual({ outcome });
      expect(setup.search.requests).toHaveLength(0);
      expect(await setup.store.list(job.workspaceId, job.applicationId)).toEqual([]);
    }
    const missing = options();
    expect(
      await createResearchHandler(missing.options)({ ...job, applicationId: "app_fixture0009" }),
    ).toEqual({ outcome: "missing" });
  });
});
